import crypto from "node:crypto";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { getJson, increment, isRedisConfigured, setJson } from "./redis.js";
import { chooseNextAccount, markAccountFailure, markAccountSuccess } from "./pool.js";

const ACCOUNTS_KEY = "gemini-critic:accounts:v1";
const CURSOR_KEY = "gemini-critic:cursor:v1";

async function readAccounts() {
  if (!isRedisConfigured()) return [];
  const accounts = await getJson(ACCOUNTS_KEY);
  return Array.isArray(accounts) ? accounts : [];
}

async function writeAccounts(accounts) {
  await setJson(ACCOUNTS_KEY, accounts);
  return accounts;
}

function publicAccount(account) {
  return {
    id: account.id,
    email: account.email,
    projectId: account.projectId,
    enabled: account.enabled !== false,
    status: account.status || "ready",
    failures: Number(account.failures ?? 0),
    cooldownUntil: Number(account.cooldownUntil ?? 0),
    createdAt: account.createdAt ?? null,
    lastUsedAt: account.lastUsedAt ?? null,
    lastErrorAt: account.lastErrorAt ?? null
  };
}

export async function listAccounts() {
  return (await readAccounts()).map(publicAccount);
}

export async function addAccount({ email, projectId, refreshToken }) {
  if (!refreshToken?.trim()) throw new Error("Refresh token is required");
  const accounts = await readAccounts();
  const normalizedEmail = String(email || "Antigravity account").trim().slice(0, 200);
  const normalizedProject = String(projectId || "").trim().slice(0, 300);
  const existing = accounts.find((account) => account.email === normalizedEmail && normalizedEmail !== "Antigravity account");
  const now = Date.now();
  const record = {
    id: existing?.id || crypto.randomUUID(),
    email: normalizedEmail,
    projectId: normalizedProject || existing?.projectId || "",
    refreshToken: encryptSecret(refreshToken.trim()),
    enabled: true,
    status: "ready",
    failures: 0,
    cooldownUntil: 0,
    createdAt: existing?.createdAt || now,
    lastUsedAt: existing?.lastUsedAt || null,
    lastErrorAt: null
  };
  const next = existing
    ? accounts.map((account) => (account.id === existing.id ? record : account))
    : [...accounts, record];
  await writeAccounts(next);
  return publicAccount(record);
}

export async function removeAccount(id) {
  const accounts = await readAccounts();
  const next = accounts.filter((account) => account.id !== id);
  if (next.length === accounts.length) throw new Error("Account not found");
  await writeAccounts(next);
  return true;
}

export async function setAccountEnabled(id, enabled) {
  const accounts = await readAccounts();
  let updated = null;
  const next = accounts.map((account) => {
    if (account.id !== id) return account;
    updated = {
      ...account,
      enabled: Boolean(enabled),
      status: enabled && account.status === "disabled" ? "ready" : enabled ? account.status : "disabled"
    };
    return updated;
  });
  if (!updated) throw new Error("Account not found");
  await writeAccounts(next);
  return publicAccount(updated);
}

export async function getAccountForRequest() {
  const accounts = await readAccounts();
  const sequence = await increment(CURSOR_KEY);
  const selected = chooseNextAccount(accounts, Math.max(0, sequence - 1));
  return {
    ...selected.account,
    refreshTokenPlain: decryptSecret(selected.account.refreshToken)
  };
}

async function transformAccount(id, transformer) {
  const accounts = await readAccounts();
  let updated = null;
  const next = accounts.map((account) => {
    if (account.id !== id) return account;
    updated = transformer(account);
    return updated;
  });
  if (!updated) return null;
  await writeAccounts(next);
  return publicAccount(updated);
}

export async function recordAccountSuccess(id) {
  return transformAccount(id, (account) => markAccountSuccess(account));
}

export async function recordAccountFailure(id, status) {
  return transformAccount(id, (account) => markAccountFailure(account, status));
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
