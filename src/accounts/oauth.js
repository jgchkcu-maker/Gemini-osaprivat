import crypto from "node:crypto";
import { deleteKey, getJson, setJson } from "./redis.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REDIRECT_URI = "http://localhost:51121/oauth-callback";
const FLOW_TTL_SECONDS = 10 * 60;
const SCOPES = [
  "https://www.googleapis.com/auth/aicode",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs"
];
const ENDPOINTS = ["https://daily-cloudcode-pa.googleapis.com", "https://cloudcode-pa.googleapis.com"];

export function resolveOAuthCredentials(env = process.env) {
  const clientId = (env.ANTIGRAVITY_OAUTH_CLIENT_ID || env.ANTIGRAVITY_CLIENT_ID || "").trim();
  const clientSecret = (env.ANTIGRAVITY_OAUTH_CLIENT_SECRET || env.ANTIGRAVITY_CLIENT_SECRET || "").trim();
  return { clientId, clientSecret };
}

function oauthClient(env = process.env) {
  const { clientId, clientSecret } = resolveOAuthCredentials(env);
  if (!clientId || !clientSecret) {
    throw new Error("Set ANTIGRAVITY_CLIENT_ID/SECRET (or ANTIGRAVITY_OAUTH_CLIENT_ID/SECRET) in Vercel to use browser OAuth");
  }
  return { clientId, clientSecret };
}

function metadataHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "antigravity/1.16.5 linux/x64",
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": JSON.stringify({ ideType: 6, platform: 2, pluginType: 2 })
  };
}

export function isOAuthConfigured(env = process.env) {
  const { clientId, clientSecret } = resolveOAuthCredentials(env);
  return Boolean(clientId && clientSecret);
}

export function parseOAuthCallback(raw, expectedState) {
  const input = String(raw ?? "").trim();
  if (!input) throw new Error("OAuth callback URL is empty");
  let url;
  try {
    url = new URL(input);
  } catch {
    const query = input.startsWith("?") ? input.slice(1) : input;
    url = new URL(`${REDIRECT_URI}?${query}`);
  }
  const providerError = url.searchParams.get("error");
  if (providerError) throw new Error(`OAuth provider error: ${providerError.slice(0, 120)}`);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) throw new Error("OAuth callback is missing state or code");
  if (expectedState && state !== expectedState) throw new Error("OAuth state mismatch");
  return { state, code };
}

export async function startOAuthFlow() {
  const { clientId } = oauthClient();
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(32).toString("base64url");
  await setJson(`gemini-critic:oauth:${state}`, { verifier, createdAt: Date.now() }, FLOW_TTL_SECONDS);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent"
  });
  return { state, authorizationUrl: `${AUTH_URL}?${params.toString()}` };
}

async function exchangeCode(code, verifier) {
  const { clientId, clientSecret } = oauthClient();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier
    }),
    signal: AbortSignal.timeout(20_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`OAuth token exchange failed (${response.status}): ${body?.error_description || body?.error || "unknown error"}`);
  if (!body.access_token || !body.refresh_token) throw new Error("Google did not return both access and refresh tokens");
  return body;
}

async function fetchEmail(accessToken) {
  const response = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) return "unknown-account";
  const data = await response.json().catch(() => ({}));
  return data?.email || "unknown-account";
}

export async function discoverProjectIdForToken(accessToken) {
  let lastError;
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers: metadataHeaders(accessToken),
        body: JSON.stringify({ metadata: { ideType: 6, platform: 2, pluginType: 2 } }),
        signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok) {
        lastError = new Error(`Project discovery failed (${response.status})`);
        continue;
      }
      const data = await response.json();
      const projectId = typeof data.cloudaicompanionProject === "string"
        ? data.cloudaicompanionProject
        : data.cloudaicompanionProject?.id;
      if (projectId) return projectId;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Could not discover Antigravity project ID");
}

export async function finishOAuthFlow(callbackUrl, expectedState) {
  const { state, code } = parseOAuthCallback(callbackUrl, expectedState);
  const key = `gemini-critic:oauth:${state}`;
  const flow = await getJson(key);
  if (!flow?.verifier) throw new Error("OAuth flow expired. Start Add account again.");
  await deleteKey(key);
  const tokens = await exchangeCode(code, flow.verifier);
  const [email, projectId] = await Promise.all([
    fetchEmail(tokens.access_token),
    discoverProjectIdForToken(tokens.access_token)
  ]);
  return {
    email,
    projectId,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiresIn: Number(tokens.expires_in ?? 3600)
  };
}
