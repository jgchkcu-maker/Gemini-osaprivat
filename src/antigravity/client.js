import crypto from "node:crypto";
import { isRedisConfigured } from "../accounts/redis.js";
import {
  ensureAntigravityProjectForToken,
  resolveOAuthCredentials,
  resolveWebOAuthCredentials
} from "../accounts/oauth.js";
import {
  getAccountForRequest,
  getPoolStatus,
  recordAccountFailure,
  recordAccountSuccess,
  releaseAccountLease
} from "../accounts/store.js";

const DEFAULT_ENDPOINTS = [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://cloudcode-pa.googleapis.com"
];
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const QUOTA_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";
export const LOCKED_MODEL = "gemini-3.8-flash-high";
export const UPSTREAM_LOCKED_MODEL = "gemini-3.8-flash-high(high)";
export const ANTIGRAVITY_IDE_VERSION = "2.11.0";
export const ANTIGRAVITY_IDE_USER_AGENT = `antigravity/ide/${ANTIGRAVITY_IDE_VERSION} darwin/arm64`;
const TOKEN_CACHE_MS = 5 * 60 * 1000;
const TOTAL_REQUEST_BUDGET_MS = 45_000;
const MIN_RETRY_BUDGET_MS = 8_000;
const MAX_UPSTREAM_FETCH_MS = 34_000;

const tokenCache = new Map();
const projectCache = new Map();

function endpointCandidates() {
  const configured = process.env.ANTIGRAVITY_API_ENDPOINT?.trim();
  return configured ? [configured.replace(/\/$/, ""), ...DEFAULT_ENDPOINTS] : DEFAULT_ENDPOINTS;
}

export function parseCompositeRefreshToken(value = "") {
  const [refreshToken = "", projectId = "", managedProjectId = ""] = String(value).split("|");
  return {
    refreshToken,
    projectId: projectId || undefined,
    managedProjectId: managedProjectId || undefined
  };
}

function clientMetadata() {
  return JSON.stringify({ ideType: 9, platform: 3, pluginType: 2 });
}

export function buildAntigravityGenerationHeaders(accessToken, accept = "application/json") {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: accept,
    "User-Agent": ANTIGRAVITY_IDE_USER_AGENT
  };
}

function projectHeaders(accessToken, accept = "application/json") {
  return {
    ...buildAntigravityGenerationHeaders(accessToken, accept),
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": clientMetadata(),
    "x-request-source": "local"
  };
}

function statusError(message, status, hints = {}) {
  const error = new Error(message);
  error.status = status;
  if (Number(hints.retryAfterMs) > 0) error.retryAfterMs = Number(hints.retryAfterMs);
  if (Number(hints.resetsAtMs) > Date.now()) error.resetsAtMs = Number(hints.resetsAtMs);
  return error;
}

export function parseUpstreamRetryHints(responseHeaders, bodyText = "", now = Date.now()) {
  const rawRetryAfter = responseHeaders?.get?.("retry-after") ?? responseHeaders?.get?.("Retry-After") ?? null;
  let retryAfterMs = null;
  if (rawRetryAfter != null && String(rawRetryAfter).trim()) {
    const value = String(rawRetryAfter).trim();
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      retryAfterMs = Math.round(seconds * 1000);
    } else {
      const timestamp = Date.parse(value);
      if (Number.isFinite(timestamp) && timestamp > now) retryAfterMs = timestamp - now;
    }
  }

  const body = String(bodyText || "");
  if (!(retryAfterMs > 0)) {
    const delay = body.match(/"(?:retryDelay|retry_delay)"\s*:\s*"([\d.]+)s"/i)
      || body.match(/(?:please\s+)?retry\s+in\s+([\d.]+)\s*s/i);
    if (delay) retryAfterMs = Math.round(Number(delay[1]) * 1000);
  }

  let resetsAtMs = null;
  const reset = body.match(/"(?:resetAt|reset_at|resetTime|reset_time)"\s*:\s*"([^"]+)"/i);
  if (reset) {
    const timestamp = Date.parse(reset[1]);
    if (Number.isFinite(timestamp) && timestamp > now) resetsAtMs = timestamp;
  }

  return {
    retryAfterMs: retryAfterMs > 0 ? retryAfterMs : null,
    resetsAtMs: resetsAtMs > now ? resetsAtMs : null
  };
}

export function parseAntigravityQuotaReset(data, model = LOCKED_MODEL, now = Date.now()) {
  const info = data?.models?.[model]?.quotaInfo;
  if (!info) return null;
  const remaining = Number(info.remainingFraction);
  if (!Number.isFinite(remaining) || remaining > 0) return null;
  const rawReset = info.resetTime ?? info.resetAt;
  const resetAtMs = typeof rawReset === "number" ? rawReset : Date.parse(String(rawReset || ""));
  return Number.isFinite(resetAtMs) && resetAtMs > now ? resetAtMs : null;
}

export function summarizeAntigravityModels(data, lockedModel = LOCKED_MODEL) {
  const models = data?.models && typeof data.models === "object" ? data.models : {};
  const locked = models?.[lockedModel];
  const remaining = Number(locked?.quotaInfo?.remainingFraction);
  const nearbyModelIds = Object.keys(models)
    .filter((modelId) => /^gemini-3\.(?:6|7|8)-flash(?:-|$)/.test(modelId))
    .sort()
    .slice(0, 16);

  return {
    lockedModelPresent: Boolean(locked),
    lockedModelHasQuota: Boolean(locked?.quotaInfo),
    lockedRemainingFraction: Number.isFinite(remaining) ? remaining : null,
    nearbyModelIds
  };
}

export function formatAntigravity404Diagnostic({
  oauthClientType,
  projectPresent,
  modelsStatus,
  modelSummary
} = {}) {
  const summary = modelSummary || summarizeAntigravityModels({});
  const remaining = summary.lockedRemainingFraction == null
    ? "none"
    : String(summary.lockedRemainingFraction);
  const nearby = Array.isArray(summary.nearbyModelIds) && summary.nearbyModelIds.length > 0
    ? summary.nearbyModelIds.join(",")
    : "none";

  return [
    "Antigravity 404 diagnostics:",
    `oauth=${oauthClientType === "web" ? "web" : "antigravity"}`,
    `client=${ANTIGRAVITY_IDE_VERSION}`,
    `project=${projectPresent ? "present" : "missing"}`,
    `modelsStatus=${String(modelsStatus ?? "unavailable")}`,
    `lockedModelPresent=${Boolean(summary.lockedModelPresent)}`,
    `lockedModelHasQuota=${Boolean(summary.lockedModelHasQuota)}`,
    `lockedRemainingFraction=${remaining}`,
    `nearbyModels=${nearby}`
  ].join(" ");
}

export function hasRetryBudget(deadlineAt, now = Date.now(), minimumMs = MIN_RETRY_BUDGET_MS) {
  return Number(deadlineAt) - Number(now) >= Number(minimumMs);
}

function timeoutForDeadline(deadlineAt, maxMs = MAX_UPSTREAM_FETCH_MS) {
  const remaining = Number(deadlineAt) - Date.now() - 1_500;
  if (remaining < 1_000) throw statusError("Antigravity request deadline reached", 504);
  return Math.max(1_000, Math.min(maxMs, remaining));
}

function oauthClient(clientKind = "antigravity") {
  const credentials = clientKind === "web" ? resolveWebOAuthCredentials() : resolveOAuthCredentials();
  if (!credentials.clientId || !credentials.clientSecret) {
    if (clientKind === "web") {
      throw new Error("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are required to refresh this Google web OAuth account");
    }
    throw new Error("ANTIGRAVITY_CLIENT_ID/SECRET are required to refresh this Antigravity account");
  }
  return credentials;
}

async function refreshAccessToken(refreshToken, cacheKey = "legacy", clientKind = "antigravity", deadlineAt = Date.now() + 20_000) {
  const effectiveCacheKey = `${clientKind}:${cacheKey}`;
  const cached = tokenCache.get(effectiveCacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const { clientId, clientSecret } = oauthClient(clientKind);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    }),
    signal: AbortSignal.timeout(timeoutForDeadline(deadlineAt, 12_000))
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw statusError(
      `Antigravity token refresh failed (${response.status}): ${body?.error_description || body?.error || "unknown error"}`,
      response.status
    );
  }
  if (!body.access_token) throw new Error("Antigravity token refresh returned no access_token");

  const ttl = Math.max(30_000, Math.min(((body.expires_in ?? 3600) - 60) * 1000, TOKEN_CACHE_MS));
  tokenCache.set(effectiveCacheKey, { token: body.access_token, expiresAt: Date.now() + ttl });
  return body.access_token;
}

async function discoverProjectId(accessToken, explicitProjectId = "", cacheKey = "legacy", deadlineAt = Date.now() + 20_000) {
  if (explicitProjectId) return explicitProjectId;
  const cached = projectCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.projectId;

  let lastError;
  for (const endpoint of endpointCandidates()) {
    if (!hasRetryBudget(deadlineAt, Date.now(), 3_000)) break;
    try {
      const response = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers: projectHeaders(accessToken),
        body: JSON.stringify({ metadata: { ideType: 9, platform: 3, pluginType: 2 } }),
        signal: AbortSignal.timeout(timeoutForDeadline(deadlineAt, 12_000))
      });
      if (!response.ok) {
        const body = await response.text();
        lastError = statusError(
          `Project discovery failed at ${endpoint} (${response.status})`,
          response.status,
          parseUpstreamRetryHints(response.headers, body)
        );
        continue;
      }
      const data = await response.json();
      const projectId = typeof data.cloudaicompanionProject === "string"
        ? data.cloudaicompanionProject
        : data.cloudaicompanionProject?.id;
      if (projectId) {
        projectCache.set(cacheKey, { projectId, expiresAt: Date.now() + TOKEN_CACHE_MS });
        return projectId;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Could not discover Antigravity project ID");
}

function quotaHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": ANTIGRAVITY_IDE_USER_AGENT,
    "X-Client-Name": "antigravity",
    "X-Client-Version": ANTIGRAVITY_IDE_VERSION
  };
}

async function fetchAntigravityQuotaReset(accessToken, projectId, deadlineAt) {
  if (!accessToken || !hasRetryBudget(deadlineAt, Date.now(), 4_000)) return null;
  try {
    const response = await fetch(QUOTA_ENDPOINT, {
      method: "POST",
      headers: quotaHeaders(accessToken),
      body: JSON.stringify(projectId ? { project: projectId } : {}),
      signal: AbortSignal.timeout(timeoutForDeadline(deadlineAt, 6_000))
    });
    if (!response.ok) return null;
    return parseAntigravityQuotaReset(await response.json(), LOCKED_MODEL);
  } catch {
    return null;
  }
}

async function fetchAntigravity404Diagnostic({ accessToken, projectId, oauthClientType, deadlineAt }) {
  const fallbackSummary = summarizeAntigravityModels({});
  if (!accessToken || !hasRetryBudget(deadlineAt, Date.now(), 4_000)) {
    return formatAntigravity404Diagnostic({
      oauthClientType,
      projectPresent: Boolean(projectId),
      modelsStatus: "skipped",
      modelSummary: fallbackSummary
    });
  }

  try {
    const response = await fetch(QUOTA_ENDPOINT, {
      method: "POST",
      headers: quotaHeaders(accessToken),
      body: JSON.stringify(projectId ? { project: projectId } : {}),
      signal: AbortSignal.timeout(timeoutForDeadline(deadlineAt, 6_000))
    });
    const data = response.ok ? await response.json().catch(() => ({})) : {};
    return formatAntigravity404Diagnostic({
      oauthClientType,
      projectPresent: Boolean(projectId),
      modelsStatus: response.status,
      modelSummary: summarizeAntigravityModels(data)
    });
  } catch {
    return formatAntigravity404Diagnostic({
      oauthClientType,
      projectPresent: Boolean(projectId),
      modelsStatus: "error",
      modelSummary: fallbackSummary
    });
  }
}

export function buildGenerateEnvelope({ projectId, model = LOCKED_MODEL, systemPrompt, userPrompt }) {
  const sessionId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const trajectoryId = crypto.randomUUID();

  return {
    project: projectId,
    // `(high)` is an internal model preset. The Cloud Code wire model is the
    // literal public entity id; High is carried in thinkingConfig instead.
    model: LOCKED_MODEL,
    request: {
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { role: "user", parts: [{ text: systemPrompt }] },
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.2,
        thinkingConfig: {
          thinkingLevel: "high",
          includeThoughts: true
        }
      },
      sessionId
    },
    userAgent: "antigravity",
    requestType: "agent",
    requestId: `agent/${conversationId}/${Date.now()}/${trajectoryId}/1`
  };
}

function appendFinalText(data, chunks) {
  const payload = data?.response ?? data;
  const parts = payload?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part?.thought === true) continue;
    if (typeof part?.text === "string") chunks.push(part.text);
  }
}

export function parseSseText(raw) {
  const chunks = [];
  for (const line of String(raw ?? "").split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const value = line.slice(5).trim();
    if (!value || value === "[DONE]") continue;
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) parsed.forEach((item) => appendFinalText(item, chunks));
      else appendFinalText(parsed, chunks);
    } catch {
      // Ignore malformed SSE events; valid events can still follow.
    }
  }
  return chunks.join("").trim();
}

function parseJsonResponse(data) {
  const chunks = [];
  appendFinalText(data, chunks);
  return chunks.join("").trim();
}

function shouldFailover(status) {
  return [401, 403, 408, 409, 429, 500, 502, 503, 504].includes(Number(status));
}

async function responseError(prefix, response) {
  const body = await response.text();
  return statusError(
    `${prefix} (${response.status}): ${body.slice(0, 2000)}`,
    response.status,
    parseUpstreamRetryHints(response.headers, body)
  );
}

export async function withProjectBindingRetry({ projectId, run, repair }) {
  try {
    return { value: await run(projectId), projectId, repaired: false };
  } catch (error) {
    if (Number(error?.status) !== 404) throw error;
    const repairResult = await repair(error);
    const repairedProjectId = String(repairResult?.projectId ?? "").trim();
    if (!repairedProjectId) throw error;
    return {
      value: await run(repairedProjectId),
      projectId: repairedProjectId,
      repaired: true
    };
  }
}

async function callGenerate({ accessToken, projectId, systemPrompt, userPrompt, deadlineAt }) {
  const envelope = buildGenerateEnvelope({ projectId, systemPrompt, userPrompt });
  let lastError;

  for (const endpoint of endpointCandidates()) {
    if (!hasRetryBudget(deadlineAt, Date.now(), 3_000)) break;
    try {
      const streamResponse = await fetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
        method: "POST",
        headers: buildAntigravityGenerationHeaders(accessToken, "text/event-stream"),
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(timeoutForDeadline(deadlineAt))
      });
      if (streamResponse.ok) {
        const text = parseSseText(await streamResponse.text());
        if (text) return text;
        lastError = new Error(`Antigravity returned an empty response from ${endpoint}`);
        continue;
      }
      const error = await responseError("Antigravity API failed", streamResponse);
      if (!shouldFailover(error.status)) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        lastError = statusError("Antigravity upstream timed out", 504);
      } else if (Number(error?.status) && !shouldFailover(error.status)) {
        throw error;
      }
    }
  }

  for (const endpoint of endpointCandidates()) {
    if (!hasRetryBudget(deadlineAt, Date.now(), 3_000)) break;
    try {
      const response = await fetch(`${endpoint}/v1internal:generateContent`, {
        method: "POST",
        headers: buildAntigravityGenerationHeaders(accessToken),
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(timeoutForDeadline(deadlineAt, 15_000))
      });
      if (!response.ok) {
        lastError = await responseError("Antigravity fallback failed", response);
        if (!shouldFailover(lastError.status)) throw lastError;
        continue;
      }
      const text = parseJsonResponse(await response.json());
      if (text) return text;
    } catch (error) {
      lastError = error;
      if (Number(error?.status) && !shouldFailover(error.status)) throw error;
    }
  }

  throw lastError ?? statusError("Antigravity request deadline reached", 504);
}

async function callGenerateWithProjectRepair({ accessToken, projectId, cacheKey, systemPrompt, userPrompt, deadlineAt }) {
  return withProjectBindingRetry({
    projectId,
    run: (activeProjectId) => callGenerate({
      accessToken,
      projectId: activeProjectId,
      systemPrompt,
      userPrompt,
      deadlineAt
    }),
    repair: async () => {
      if (!hasRetryBudget(deadlineAt, Date.now(), 10_000)) {
        throw statusError("Not enough request budget to repair Antigravity project binding", 504);
      }
      const repaired = await ensureAntigravityProjectForToken(accessToken, {
        maxOnboardAttempts: 3,
        fetchTimeoutMs: 5_000
      });
      if (repaired.projectId && cacheKey) {
        projectCache.set(cacheKey, {
          projectId: repaired.projectId,
          expiresAt: Date.now() + TOKEN_CACHE_MS
        });
      }
      return repaired;
    }
  });
}

async function legacyCredential() {
  const direct = process.env.ANTIGRAVITY_ACCESS_TOKEN?.trim();
  const composite = parseCompositeRefreshToken(process.env.ANTIGRAVITY_REFRESH_TOKEN ?? "");
  if (direct) {
    return {
      id: "legacy-access",
      accessToken: direct,
      oauthClientType: "antigravity",
      projectId: process.env.ANTIGRAVITY_PROJECT_ID?.trim() || composite.managedProjectId || composite.projectId || ""
    };
  }
  if (!composite.refreshToken) return null;
  return {
    id: "legacy-refresh",
    refreshToken: composite.refreshToken,
    oauthClientType: "antigravity",
    projectId: process.env.ANTIGRAVITY_PROJECT_ID?.trim() || composite.managedProjectId || composite.projectId || ""
  };
}

async function resolveCredential(account, deadlineAt) {
  const refreshToken = account?.refreshTokenPlain || account?.refreshToken;
  if (refreshToken) {
    const clientKind = account.oauthClientType === "web" ? "web" : "antigravity";
    const accessToken = await refreshAccessToken(refreshToken, account.id, clientKind, deadlineAt);
    const projectId = await discoverProjectId(accessToken, account.projectId || "", account.id, deadlineAt);
    return { accessToken, projectId };
  }
  if (account?.accessToken) {
    const projectId = await discoverProjectId(account.accessToken, account.projectId || "", account.id, deadlineAt);
    return { accessToken: account.accessToken, projectId };
  }
  throw new Error("Account contains no usable Antigravity credential");
}

export async function generateCriticText({ systemPrompt, userPrompt }) {
  const deadlineAt = Date.now() + TOTAL_REQUEST_BUDGET_MS;

  if (isRedisConfigured()) {
    const pool = await getPoolStatus().catch(() => null);
    if (pool?.total > 0) {
      const attempts = Math.max(1, pool.total);
      const excludedIds = new Set();
      let lastError;

      for (let i = 0; i < attempts && hasRetryBudget(deadlineAt); i += 1) {
        let account;
        try {
          account = await getAccountForRequest({ excludedIds, model: LOCKED_MODEL });
        } catch (selectionError) {
          if (lastError) throw lastError;
          throw selectionError;
        }
        if (!account) break;
        excludedIds.add(account.id);

        let resolvedAccessToken = null;
        let resolvedProjectId = null;
        try {
          const resolved = await resolveCredential(account, deadlineAt);
          resolvedAccessToken = resolved.accessToken;
          resolvedProjectId = resolved.projectId;
          const generated = await callGenerateWithProjectRepair({
            accessToken: resolvedAccessToken,
            projectId: resolvedProjectId,
            cacheKey: account.id,
            systemPrompt,
            userPrompt,
            deadlineAt
          });
          resolvedProjectId = generated.projectId;
          await recordAccountSuccess(account.id, LOCKED_MODEL).catch(() => {});
          return generated.value;
        } catch (error) {
          lastError = error;
          const status = Number(error?.status) || 500;
          let resetsAtMs = error?.resetsAtMs;
          if (status === 404 && resolvedAccessToken && error && typeof error === "object") {
            const diagnostic = await fetchAntigravity404Diagnostic({
              accessToken: resolvedAccessToken,
              projectId: resolvedProjectId,
              oauthClientType: account.oauthClientType,
              deadlineAt
            }).catch(() => null);
            if (diagnostic) error.message = `${error.message}\n${diagnostic}`;
          }
          if ((status === 409 || status === 429) && !resetsAtMs && resolvedAccessToken) {
            resetsAtMs = await fetchAntigravityQuotaReset(
              resolvedAccessToken,
              resolvedProjectId,
              deadlineAt
            );
            if (resetsAtMs) error.resetsAtMs = resetsAtMs;
          }
          await recordAccountFailure(account.id, {
            status,
            model: LOCKED_MODEL,
            retryAfterMs: error?.retryAfterMs,
            resetsAtMs,
            errorText: error?.message
          }).catch(() => {});
          if (!shouldFailover(status)) throw error;
        } finally {
          await releaseAccountLease(account.id, account.leaseToken).catch(() => {});
        }
      }
      if (lastError) throw lastError;
    }
  }

  const legacy = await legacyCredential();
  if (!legacy) {
    throw new Error("No active Antigravity accounts. Add an account in the dashboard or configure a legacy token.");
  }
  const { accessToken, projectId } = await resolveCredential(legacy, deadlineAt);
  const generated = await callGenerateWithProjectRepair({
    accessToken,
    projectId,
    cacheKey: legacy.id,
    systemPrompt,
    userPrompt,
    deadlineAt
  });
  return generated.value;
}

export async function getConfigurationStatus() {
  let poolStatus = { total: 0, enabled: 0, available: 0 };
  if (isRedisConfigured()) {
    poolStatus = await getPoolStatus().catch(() => poolStatus);
  }
  return {
    configured: poolStatus.available > 0 || Boolean(process.env.ANTIGRAVITY_ACCESS_TOKEN || process.env.ANTIGRAVITY_REFRESH_TOKEN),
    model: LOCKED_MODEL,
    modelLocked: true,
    upstreamModel: UPSTREAM_LOCKED_MODEL,
    pool: poolStatus,
    redisConfigured: isRedisConfigured(),
    mcpProtected: Boolean(process.env.MCP_SHARED_SECRET)
  };
}
