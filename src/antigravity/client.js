import crypto from "node:crypto";

const DEFAULT_ENDPOINTS = [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://cloudcode-pa.googleapis.com"
];

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_MODEL = "gemini-3.8-flash-high";
const TOKEN_CACHE_MS = 5 * 60 * 1000;

let tokenCache = null;
let projectCache = null;

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

async function refreshAccessToken(refreshToken) {
  const clientId = process.env.ANTIGRAVITY_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("ANTIGRAVITY_OAUTH_CLIENT_ID and ANTIGRAVITY_OAUTH_CLIENT_SECRET are required when using a refresh token");
  }

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

  if (!response.ok) {
    throw new Error(`Antigravity token refresh failed (${response.status}): ${await response.text()}`);
  }

  const body = await response.json();
  if (!body.access_token) throw new Error("Antigravity token refresh returned no access_token");

  const ttl = Math.max(30_000, Math.min(((body.expires_in ?? 3600) - 60) * 1000, TOKEN_CACHE_MS));
  tokenCache = { token: body.access_token, expiresAt: Date.now() + ttl };
  return body.access_token;
}

async function getAccessToken() {
  const direct = process.env.ANTIGRAVITY_ACCESS_TOKEN?.trim();
  if (direct) return direct;

  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;

  const composite = process.env.ANTIGRAVITY_REFRESH_TOKEN?.trim();
  if (!composite) {
    throw new Error("Set ANTIGRAVITY_REFRESH_TOKEN (recommended) or ANTIGRAVITY_ACCESS_TOKEN");
  }
  return refreshAccessToken(parseCompositeRefreshToken(composite).refreshToken);
}

async function discoverProjectId(accessToken) {
  const explicit = process.env.ANTIGRAVITY_PROJECT_ID?.trim();
  if (explicit) return explicit;

  const composite = parseCompositeRefreshToken(process.env.ANTIGRAVITY_REFRESH_TOKEN ?? "");
  const embedded = composite.managedProjectId || composite.projectId;
  if (embedded) return embedded;

  if (projectCache && projectCache.expiresAt > Date.now()) return projectCache.projectId;

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
        lastError = new Error(`Project discovery failed at ${endpoint} (${response.status})`);
        continue;
      }
      const data = await response.json();
      const projectId = typeof data.cloudaicompanionProject === "string"
        ? data.cloudaicompanionProject
        : data.cloudaicompanionProject?.id;
      if (projectId) {
        projectCache = { projectId, expiresAt: Date.now() + TOKEN_CACHE_MS };
        return projectId;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Could not discover Antigravity project ID");
}

export function buildGenerateEnvelope({ projectId, model = DEFAULT_MODEL, systemPrompt, userPrompt }) {
  return {
    project: projectId,
    model,
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

export async function generateCriticText({ systemPrompt, userPrompt }) {
  const accessToken = await getAccessToken();
  const projectId = await discoverProjectId(accessToken);
  const model = process.env.ANTIGRAVITY_MODEL?.trim() || DEFAULT_MODEL;
  const envelope = buildGenerateEnvelope({ projectId, model, systemPrompt, userPrompt });

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
      if (streamResponse.status >= 400 && streamResponse.status < 500 && streamResponse.status !== 429) {
        throw new Error(`Antigravity API failed (${streamResponse.status}): ${streamError}`);
      }
      lastError = new Error(`Antigravity API failed (${streamResponse.status}): ${streamError}`);
    } catch (error) {
      lastError = error;
      if (/\(4\d\d\)/.test(String(error?.message)) && !/\(429\)/.test(String(error?.message))) throw error;
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
        lastError = new Error(`Antigravity fallback failed (${response.status}): ${await response.text()}`);
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

export function getConfigurationStatus() {
  return {
    configured: Boolean(
      process.env.ANTIGRAVITY_ACCESS_TOKEN ||
      (process.env.ANTIGRAVITY_REFRESH_TOKEN && process.env.ANTIGRAVITY_OAUTH_CLIENT_ID && process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET)
    ),
    model: process.env.ANTIGRAVITY_MODEL?.trim() || DEFAULT_MODEL,
    projectConfigured: Boolean(process.env.ANTIGRAVITY_PROJECT_ID || parseCompositeRefreshToken(process.env.ANTIGRAVITY_REFRESH_TOKEN ?? "").projectId),
    mcpProtected: Boolean(process.env.MCP_SHARED_SECRET)
  };
}
