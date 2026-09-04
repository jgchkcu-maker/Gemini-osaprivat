import crypto from "node:crypto";
import { decryptSecret, encryptSecret } from "./crypto.js";
import {
  addSetMember,
  compareDelete,
  deleteKey,
  getJson,
  getManyJson,
  isRedisConfigured,
  removeSetMember,
  setIfAbsent,
  setJson,
  setMembers
} from "./redis.js";
import { chooseStickyAccount, markAccountFailure, markAccountSuccess } from "./pool.js";

const LEGACY_ACCOUNTS_KEY = "gemini-critic:accounts:v1";
const ACCOUNT_INDEX_KEY = "gemini-critic:accounts:v2:index";
const ACCOUNT_PREFIX = "gemini-critic:account:v2:";
const ROTATION_STATE_KEY = "gemini-critic:rotation:v2";
const SELECTION_LOCK_KEY = "gemini-critic:selection-lock:v2";
const LEASE_PREFIX = "gemini-critic:lease:v2:";
const DEFAULT_MODEL = "gemini-3.8-flash-high";
const STICKY_LIMIT = 3;
const SELECTION_LOCK_MS = 4_000;
const REQUEST_LEASE_MS = 50_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function accountRecordKey(id) {
  return `${ACCOUNT_PREFIX}${String(id)}`;
}

function leaseKey(id) {
  return `${LEASE_PREFIX}${String(id)}`;
}

export function normalizeAccountRecord(account = {}) {
  return {
    ...account,
    id: String(account.id || crypto.randomUUID()),
    email: String(account.email || "Antigravity account").slice(0, 200),
    projectId: String(account.projectId || "").slice(0, 300),
    oauthClientType: account.oauthClientType === "web" ? "web" : "antigravity",
    enabled: account.enabled !== false,
    status: account.status || "ready",
    failures: Number(account.failures ?? 0),
    cooldownUntil: Number(account.cooldownUntil ?? 0),
    modelLocks: account.modelLocks && typeof account.modelLocks === "object" ? account.modelLocks : {},
    createdAt: account.createdAt ?? Date.now(),
    lastUsedAt: account.lastUsedAt ?? null,
    lastErrorAt: account.lastErrorAt ?? null
  };
}

async function writeRecord(record) {
  const normalized = normalizeAccountRecord(record);
  await setJson(accountRecordKey(normalized.id), normalized);
  await addSetMember(ACCOUNT_INDEX_KEY, normalized.id);
  return normalized;
}

async function migrateLegacyAccountsIfNeeded() {
  const ids = await setMembers(ACCOUNT_INDEX_KEY);
  if (ids.length > 0) return ids;

  const legacy = await getJson(LEGACY_ACCOUNTS_KEY);
  if (!Array.isArray(legacy) || legacy.length === 0) return [];

  for (const account of legacy) {
    if (!account?.id) continue;
    await writeRecord(account);
  }
  return setMembers(ACCOUNT_INDEX_KEY);
}

async function readAccounts() {
  if (!isRedisConfigured()) return [];
  const ids = await migrateLegacyAccountsIfNeeded();
  if (ids.length === 0) return [];
  const records = await getManyJson(ids.map(accountRecordKey));
  return records.filter(Boolean).map(normalizeAccountRecord);
}

function effectiveCooldown(account, now = Date.now()) {
  const modelLocks = account?.modelLocks && typeof account.modelLocks === "object" ? account.modelLocks : {};
  const activeModelLocks = Object.values(modelLocks)
    .map(Number)
    .filter((value) => value > now);
  return Math.max(Number(account?.cooldownUntil ?? 0), ...activeModelLocks, 0);
}

function publicAccount(account) {
  const cooldownUntil = effectiveCooldown(account);
  const status = account.status === "needs_login"
    ? "needs_login"
    : account.enabled === false
      ? "disabled"
      : cooldownUntil > Date.now()
        ? "cooldown"
        : "ready";
  return {
    id: account.id,
    email: account.email,
    projectId: account.projectId,
    oauthClientType: account.oauthClientType || "antigravity",
    enabled: account.enabled !== false,
    status,
    failures: Number(account.failures ?? 0),
    cooldownUntil,
    createdAt: account.createdAt ?? null,
    lastUsedAt: account.lastUsedAt ?? null,
    lastErrorAt: account.lastErrorAt ?? null
  };
}

export async function listAccounts() {
  return (await readAccounts()).map(publicAccount);
}

export async function addAccount({ email, projectId, refreshToken, oauthClientType = "antigravity" }) {
  if (!refreshToken?.trim()) throw new Error("Refresh token is required");
  const accounts = await readAccounts();
  const normalizedEmail = String(email || "Antigravity account").trim().slice(0, 200);
  const normalizedProject = String(projectId || "").trim().slice(0, 300);
  const existing = accounts.find((account) => account.email === normalizedEmail && normalizedEmail !== "Antigravity account");
  const now = Date.now();
  const record = normalizeAccountRecord({
    ...(existing || {}),
    id: existing?.id || crypto.randomUUID(),
    email: normalizedEmail,
    projectId: normalizedProject || existing?.projectId || "",
    oauthClientType,
    refreshToken: encryptSecret(refreshToken.trim()),
    enabled: true,
    status: "ready",
    failures: 0,
    cooldownUntil: 0,
    modelLocks: {},
    createdAt: existing?.createdAt || now,
    lastUsedAt: existing?.lastUsedAt || null,
    lastErrorAt: null
  });
  await writeRecord(record);
  return publicAccount(record);
}

export async function removeAccount(id) {
  const existing = await getJson(accountRecordKey(id));
  if (!existing) throw new Error("Account not found");
  await deleteKey(accountRecordKey(id));
  await removeSetMember(ACCOUNT_INDEX_KEY, id);
  await deleteKey(leaseKey(id)).catch(() => {});
  return true;
}

export async function setAccountEnabled(id, enabled) {
  const account = await getJson(accountRecordKey(id));
  if (!account) throw new Error("Account not found");
  const updated = normalizeAccountRecord({
    ...account,
    enabled: Boolean(enabled),
    status: enabled ? (account.status === "disabled" ? "ready" : account.status) : "disabled"
  });
  await writeRecord(updated);
  return publicAccount(updated);
}

async function acquireSelectionLock() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const token = crypto.randomUUID();
    if (await setIfAbsent(SELECTION_LOCK_KEY, token, SELECTION_LOCK_MS)) return token;
    await sleep(25 + attempt * 15);
  }
  throw new Error("Antigravity account pool is busy; retry shortly");
}

async function releaseSelectionLock(token) {
  if (!token) return;
  await compareDelete(SELECTION_LOCK_KEY, token).catch(() => {});
}

async function acquireAccountLease(id) {
  const token = crypto.randomUUID();
  const acquired = await setIfAbsent(leaseKey(id), token, REQUEST_LEASE_MS);
  return acquired ? token : null;
}

export async function releaseAccountLease(id, leaseToken) {
  if (!id || !leaseToken) return false;
  return compareDelete(leaseKey(id), leaseToken).catch(() => false);
}

export async function getAccountForRequest(options = {}) {
  const model = options.model || DEFAULT_MODEL;
  const excludedIds = options.excludedIds instanceof Set
    ? new Set(options.excludedIds)
    : new Set(options.excludedIds || []);
  const selectionToken = await acquireSelectionLock();

  try {
    const accounts = await readAccounts();
    if (accounts.length === 0) throw new Error("No Antigravity accounts configured");
    const rotationState = (await getJson(ROTATION_STATE_KEY)) || {};

    for (let attempt = 0; attempt < accounts.length; attempt += 1) {
      const selected = chooseStickyAccount(accounts, rotationState, {
        now: Date.now(),
        stickyLimit: STICKY_LIMIT,
        excludedIds,
        model
      });
      const leaseToken = await acquireAccountLease(selected.account.id);
      if (!leaseToken) {
        excludedIds.add(selected.account.id);
        continue;
      }

      await setJson(ROTATION_STATE_KEY, selected.state);
      return {
        ...selected.account,
        leaseToken,
        refreshTokenPlain: decryptSecret(selected.account.refreshToken)
      };
    }

    throw new Error("No Antigravity accounts are currently available");
  } finally {
    await releaseSelectionLock(selectionToken);
  }
}

async function transformAccount(id, transformer) {
  const account = await getJson(accountRecordKey(id));
  if (!account) return null;
  const updated = normalizeAccountRecord(transformer(normalizeAccountRecord(account)));
  await writeRecord(updated);
  return publicAccount(updated);
}

export async function recordAccountSuccess(id, model = DEFAULT_MODEL) {
  return transformAccount(id, (account) => markAccountSuccess(account, Date.now(), model));
}

export async function recordAccountFailure(id, failure) {
  const detail = typeof failure === "number"
    ? { status: failure, model: DEFAULT_MODEL }
    : { model: DEFAULT_MODEL, ...(failure || {}) };
  return transformAccount(id, (account) => markAccountFailure(account, detail));
}

export async function getPoolStatus() {
  const accounts = await listAccounts();
  const now = Date.now();
  return {
    configured: isRedisConfigured(),
    total: accounts.length,
    enabled: accounts.filter((account) => account.enabled).length,
    available: accounts.filter(
      (account) => account.enabled && account.status !== "needs_login" && account.cooldownUntil <= now
    ).length
  };
}
