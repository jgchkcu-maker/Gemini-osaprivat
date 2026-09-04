import crypto from "node:crypto";
import { deleteKey, getJson, setJson } from "./redis.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const ANTIGRAVITY_NATIVE_REDIRECT_URI = "http://localhost:51121/oauth-callback";
const FLOW_TTL_SECONDS = 10 * 60;
export const ANTIGRAVITY_NATIVE_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs"
];
const ENDPOINTS = ["https://daily-cloudcode-pa.googleapis.com", "https://cloudcode-pa.googleapis.com"];

export function resolveOAuthCredentials(env = process.env) {
  const clientId = (
    env.ANTIGRAVITY_OAUTH_CLIENT_ID
    || env.ANTIGRAVITY_CLIENT_ID
    || env.ANTIGRAVIT_CLIENT_ID
    || ""
  ).trim();
  const clientSecret = (
    env.ANTIGRAVITY_OAUTH_CLIENT_SECRET
    || env.ANTIGRAVITY_CLIENT_SECRET
    || env.ANTIGRAVIT_CLIENT_SECRET
    || env.ANTIGRAVIT_ENT_SECRET
    || ""
  ).trim();
  return { clientId, clientSecret };
}

export function resolveWebOAuthCredentials(env = process.env) {
  const clientId = (env.GOOGLE_OAUTH_CLIENT_ID || env.GOOGLE_WEB_CLIENT_ID || "").trim();
  const clientSecret = (env.GOOGLE_OAUTH_CLIENT_SECRET || env.GOOGLE_WEB_CLIENT_SECRET || "").trim();
  return { clientId, clientSecret };
}

export function webOAuthRedirectUri(origin) {
  const url = new URL(String(origin));
  return `${url.origin}/api/accounts/oauth/callback`;
}

export function isWebOAuthConfigured(env = process.env) {
  const { clientId, clientSecret } = resolveWebOAuthCredentials(env);
  return Boolean(clientId && clientSecret);
}

export function resolveOAuthMode({ mode, origin } = {}, env = process.env) {
  if (mode === "web" && origin && isWebOAuthConfigured(env)) return "web";
  return "antigravity";
}

function oauthClient(clientKind = "antigravity", env = process.env) {
  const credentials = clientKind === "web" ? resolveWebOAuthCredentials(env) : resolveOAuthCredentials(env);
  if (!credentials.clientId || !credentials.clientSecret) {
    if (clientKind === "web") {
      throw new Error("Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel for one-click Google OAuth");
    }
    throw new Error("Set ANTIGRAVITY_CLIENT_ID/SECRET in Vercel for provider-native Antigravity OAuth");
  }
  return credentials;
}

function metadataHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "antigravity/1.16.5 linux/x64",
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": JSON.stringify({ ideType: 9, platform: 3, pluginType: 2 }),
    "x-request-source": "local"
  };
}

export function isOAuthConfigured(env = process.env) {
  const native = resolveOAuthCredentials(env);
  return Boolean(native.clientId && native.clientSecret) || isWebOAuthConfigured(env);
}

export function parseOAuthCallback(raw, expectedState) {
  const input = String(raw ?? "").trim();
  if (!input) throw new Error("OAuth callback URL is empty");
  let url;
  try {
    url = new URL(input);
  } catch {
    const query = input.startsWith("?") ? input.slice(1) : input;
    url = new URL(`${ANTIGRAVITY_NATIVE_REDIRECT_URI}?${query}`);
  }
  const providerError = url.searchParams.get("error");
  if (providerError) throw new Error(`OAuth provider error: ${providerError.slice(0, 120)}`);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) throw new Error("OAuth callback is missing state or code");
  if (expectedState && state !== expectedState) throw new Error("OAuth state mismatch");
  return { state, code };
}

export async function startOAuthFlow({ origin, mode } = {}) {
  const clientKind = resolveOAuthMode({ mode, origin });
  const { clientId } = oauthClient(clientKind);
  const redirectUri = clientKind === "web" ? webOAuthRedirectUri(origin) : ANTIGRAVITY_NATIVE_REDIRECT_URI;
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(32).toString("base64url");

  await setJson(
    `gemini-critic:oauth:${state}`,
    { verifier, createdAt: Date.now(), redirectUri, clientKind },
    FLOW_TTL_SECONDS
  );

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: ANTIGRAVITY_NATIVE_SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent"
  });

  return {
    state,
    mode: clientKind === "web" ? "web" : "manual",
    oauthClientType: clientKind,
    redirectUri,
    authorizationUrl: `${AUTH_URL}?${params.toString()}`
  };
}

async function exchangeCode(code, verifier, clientKind, redirectUri) {
  const { clientId, clientSecret } = oauthClient(clientKind);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code_verifier: verifier
    }),
    signal: AbortSignal.timeout(20_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`OAuth token exchange failed (${response.status}): ${body?.error_description || body?.error || "unknown error"}`);
  }
  if (!body.access_token || !body.refresh_token) {
    throw new Error("Google did not return both access and refresh tokens. Remove the app permission and try again.");
  }
  return body;
}

async function fetchEmail(accessToken) {
  const response = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
    headers: { Authorization: `Bearer ${accessToken}`, "x-request-source": "local" },
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
        body: JSON.stringify({ metadata: { ideType: 9, platform: 3, pluginType: 2 } }),
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

async function completeOAuthCode(state, code) {
  const key = `gemini-critic:oauth:${state}`;
  const flow = await getJson(key);
  if (!flow?.verifier || !flow?.redirectUri || !flow?.clientKind) {
    throw new Error("OAuth flow expired. Start Add account again.");
  }
  await deleteKey(key);

  const tokens = await exchangeCode(code, flow.verifier, flow.clientKind, flow.redirectUri);
  const [email, projectId] = await Promise.all([
    fetchEmail(tokens.access_token),
    discoverProjectIdForToken(tokens.access_token)
  ]);

  return {
    email,
    projectId,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiresIn: Number(tokens.expires_in ?? 3600),
    oauthClientType: flow.clientKind
  };
}

export async function finishOAuthFlow(callbackUrl, expectedState) {
  const { state, code } = parseOAuthCallback(callbackUrl, expectedState);
  return completeOAuthCode(state, code);
}

export async function finishOAuthCallback({ state, code, error }) {
  if (error) throw new Error(`OAuth provider error: ${String(error).slice(0, 120)}`);
  if (!state || !code) throw new Error("OAuth callback is missing state or code");
  return completeOAuthCode(state, code);
}
