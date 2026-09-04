import crypto from "node:crypto";
import { isRedisConfigured } from "../accounts/redis.js";
import {
  getAccountForRequest,
  getPoolStatus,
  recordAccountFailure,
  recordAccountSuccess
} from "../accounts/store.js";

const DEFAULT_ENDPOINTS = [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://cloudcode-pa.googleapis.com"
];
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const LOCKED_MODEL = "gemini-3.8-flash-high";
const TOKEN_CACHE_MS = 5 * 60 * 1000;

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
  return JSON.stringify({ ideType: 6, platform: 2, pluginType: 2 });
}

function headers(accessToken, accept = "application/json") {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: accept,
    "User-Agent": "antigravity/1.16.5 linux/x64",
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": clientMetadata()
  };
}

function statusError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function oauthClient() {
  const clientId = (process.env.ANTIGRAVITY_OAUTH_CLIENT_ID || process.env.ANTIGRAVITY_CLIENT_ID || "").trim();
  const clientSecret = (process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET || process.env.ANTIGRAVITY_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    throw new Error("ANTIGRAVITY_CLIENT_ID/SECRET (or ANTIGRAVITY_OAUTH_CLIENT_ID/SECRET) are required to refresh Antigravity accounts");
  }
  return { clientId, clientSecret };
}

async function refreshAccessToken(refreshToken, cacheKey = "legacy") {
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const { clientId, clientSecret } = oauthClient();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    }),
    signal: AbortSignal.timeout(20_000)
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
  tokenCache.set(cacheKey, { token: body.access_token, expiresAt: Date.now() + ttl });
  return body.access_token;
}

async function discoverProjectId(accessToken, explicitProjectId = "", cacheKey = "legacy") {
  if (explicitProjectId) return explicitProjectId;
  const cached = projectCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.projectId;

  let lastError;
  for (const endpoint of endpointCandidates()) {
    try {
      const response = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers: headers(accessToken),
        body: JSON.stringify({ metadata: { ideType: 6, platform: 2, pluginType: 2 } }),
        signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok) {
        lastError = statusError(`Project discovery failed at ${endpoint} (${response.status})`, response.status);
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

export function buildGenerateEnvelope({ projectId, model = LOCKED_MODEL, systemPrompt, userPrompt }) {
  return {
    project: projectId,
    model: LOCKED_MODEL,
    request: {
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { role: "user", parts: [{ text: systemPrompt }] },
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.2
      }
    },
    userAgent: "antigravity",
    requestType: "agent",
    requestId: `agent-${crypto.randomUUID()}`
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

async function callGenerate({ accessToken, projectId, systemPrompt, userPrompt }) {
  const envelope = buildGenerateEnvelope({ projectId, systemPrompt, userPrompt });
  let lastError;

  for (const endpoint of endpointCandidates()) {
    try {
      const streamResponse = await fetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
        method: "POST",
        headers: headers(accessToken, "text/event-stream"),
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(55_000)
      });
      if (streamResponse.ok) {
        const text = parseSseText(await streamResponse.text());
        if (text) return text;
        lastError = new Error(`Antigravity returned an empty response from ${endpoint}`);
        continue;
      }
      const streamError = await streamResponse.text();
      const error = statusError(`Antigravity API failed (${streamResponse.status}): ${streamError}`, streamResponse.status);
      if (streamResponse.status >= 400 && streamResponse.status < 500 && streamResponse.status !== 429) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (Number(error?.status) >= 400 && Number(error?.status) < 500 && Number(error?.status) !== 429) throw error;
    }
  }

  for (const endpoint of endpointCandidates()) {
    try {
      const response = await fetch(`${endpoint}/v1internal:generateContent`, {
        method: "POST",
        headers: headers(accessToken),
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(55_000)
      });
      if (!response.ok) {
        lastError = statusError(`Antigravity fallback failed (${response.status}): ${await response.text()}`, response.status);
        continue;
      }
      const text = parseJsonResponse(await response.json());
      if (text) return text;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Antigravity request failed");
}

async function legacyCredential() {
  const direct = process.env.ANTIGRAVITY_ACCESS_TOKEN?.trim();
  const composite = parseCompositeRefreshToken(process.env.ANTIGRAVITY_REFRESH_TOKEN ?? "");
  if (direct) {
    return {
      id: "legacy-access",
      accessToken: direct,
      projectId: process.env.ANTIGRAVITY_PROJECT_ID?.trim() || composite.managedProjectId || composite.projectId || ""
    };
  }
  if (!composite.refreshToken) return null;
  return {
    id: "legacy-refresh",
    refreshToken: composite.refreshToken,
    projectId: process.env.ANTIGRAVITY_PROJECT_ID?.trim() || composite.managedProjectId || composite.projectId || ""
  };
}

async function resolveCredential(account) {
  if (account?.refreshToken) {
    const accessToken = await refreshAccessToken(account.refreshToken, account.id);
    const projectId = await discoverProjectId(accessToken, account.projectId || "", account.id);
    return { accessToken, projectId };
  }
  if (account?.accessToken) {
    const projectId = await discoverProjectId(account.accessToken, account.projectId || "", account.id);
    return { accessToken: account.accessToken, projectId };
  }
  throw new Error("Account contains no usable Antigravity credential");
}

export async function generateCriticText({ systemPrompt, userPrompt }) {
  if (isRedisConfigured()) {
    const pool = await getPoolStatus().catch(() => null);
    if (pool?.total > 0) {
      const attempts = Math.max(1, pool.total);
      let lastError;
      for (let i = 0; i < attempts; i += 1) {
        const account = await getAccountForRequest();
        if (!account) break;
        try {
          const { accessToken, projectId } = await resolveCredential(account);
          const text = await callGenerate({ accessToken, projectId, systemPrompt, userPrompt });
          await recordAccountSuccess(account.id).catch(() => {});
          return text;
        } catch (error) {
          lastError = error;
          const status = Number(error?.status) || 500;
          await recordAccountFailure(account.id, status).catch(() => {});
          if (status !== 429 && status !== 401 && status !== 403) throw error;
        }
      }
      if (lastError) throw lastError;
    }
  }

  const legacy = await legacyCredential();
  if (!legacy) {
    throw new Error("No active Antigravity accounts. Add an account in the dashboard or configure a legacy token.");
  }
  const { accessToken, projectId } = await resolveCredential(legacy);
  return callGenerate({ accessToken, projectId, systemPrompt, userPrompt });
}

export async function getConfigurationStatus() {
  let poolStatus = { total: 0, enabled: 0, ready: 0, needsLogin: 0, cooldown: 0 };
  if (isRedisConfigured()) {
    poolStatus = await getPoolStatus().catch(() => poolStatus);
  }
  return {
    configured: poolStatus.ready > 0 || Boolean(process.env.ANTIGRAVITY_ACCESS_TOKEN || process.env.ANTIGRAVITY_REFRESH_TOKEN),
    model: LOCKED_MODEL,
    modelLocked: true,
    pool: poolStatus,
    redisConfigured: isRedisConfigured(),
    mcpProtected: Boolean(process.env.MCP_SHARED_SECRET)
  };
}
