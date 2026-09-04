import crypto from "node:crypto";
import { deleteKey, getJson, setJson } from "./redis.js";
import { embeddedAntigravityOAuthCredentials } from "./public-credentials.js";

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
const WEB_OAUTH_APP_URL_KEYS = ["GOOGLE_OAUTH_APP_URL", "OAUTH_APP_URL", "APP_URL", "NEXT_PUBLIC_APP_URL", "VERCEL_PROJECT_PRODUCTION_URL"];
const WEB_OAUTH_REDIRECT_URI_KEYS = ["GOOGLE_OAUTH_REDIRECT_URI", "OAUTH_REDIRECT_URI"];

function firstNonEmpty(env, names) {
  for (const name of names) {
    const value = String(env?.[name] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function fuzzyAntigravityEnv(env, kind) {
  const entries = Object.entries(env ?? {});
  const candidates = entries
    .map(([key, value]) => ({
      key: key.toUpperCase().replace(/[^A-Z0-9]/g, ""),
      value: String(value ?? "").trim()
    }))
    .filter(({ key, value }) => value && key.startsWith("ANTIGRAV"));

  if (kind === "clientId") {
    const match = candidates.find(({ key }) => key.includes("CLIENT") && key.endsWith("ID"));
    return match?.value ?? "";
  }

  const match = candidates.find(({ key }) =>
    key.includes("SECRET") && (key.includes("CLIENT") || key.includes("OAUTH") || key.includes("ENT"))
  );
  return match?.value ?? "";
}

export function resolveOAuthCredentials(env = process.env) {
  const clientId = firstNonEmpty(env, [
    "ANTIGRAVITY_OAUTH_CLIENT_ID",
    "ANTIGRAVITY_CLIENT_ID",
    "ANTIGRAVIT_CLIENT_ID"
  ]) || fuzzyAntigravityEnv(env, "clientId");

  const clientSecret = firstNonEmpty(env, [
    "ANTIGRAVITY_OAUTH_CLIENT_SECRET",
    "ANTIGRAVITY_CLIENT_SECRET",
    "ANTIGRAVIT_CLIENT_SECRET",
    "ANTIGRAVIT_ENT_SECRET"
  ]) || fuzzyAntigravityEnv(env, "clientSecret");

  // A custom native OAuth client is an atomic pair. Use it only when both
  // halves are present; otherwise ignore stale/partial overrides and fall back
  // to the complete embedded public client instead of mixing credentials.
  if (clientId && clientSecret) return { clientId, clientSecret };

  return embeddedAntigravityOAuthCredentials();
}

export function resolveWebOAuthCredentials(env = process.env) {
  const clientId = firstNonEmpty(env, ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_WEB_CLIENT_ID", "GOOGLE_CLIENT_ID"]);
  const clientSecret = firstNonEmpty(env, ["GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_WEB_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"]);
  return { clientId, clientSecret };
}

function normalizeHttpOrigin(value) {
  let candidate = String(value ?? "").trim();
  if (!candidate) return "";
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  const url = new URL(candidate);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("OAuth app URL must use HTTP or HTTPS");
  return url.origin;
}

export function resolveWebOAuthOrigin(requestOrigin, env = process.env) {
  for (const key of WEB_OAUTH_APP_URL_KEYS) {
    const value = String(env?.[key] ?? "").trim();
    if (!value) continue;
    try {
      return normalizeHttpOrigin(value);
    } catch {
      throw new Error(`${key} must be a valid HTTP or HTTPS origin`);
    }
  }
  return normalizeHttpOrigin(requestOrigin);
}

export function webOAuthRedirectUri(origin, env = process.env) {
  const configured = firstNonEmpty(env, WEB_OAUTH_REDIRECT_URI_KEYS);
  if (configured) {
    let url;
    try {
      url = new URL(configured);
    } catch {
      throw new Error("OAuth redirect URI must be a valid absolute URL");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("OAuth redirect URI must use HTTP or HTTPS");
    }
    if (
      !url.hostname ||
      url.username ||
      url.password ||
      url.pathname !== "/api/accounts/oauth/callback"
    ) {
      throw new Error("OAuth redirect URI must use the /api/accounts/oauth/callback pathname");
    }
    if (url.search || url.hash) {
      throw new Error("OAuth redirect URI must not contain query parameters or a fragment");
    }
    return url.toString();
  }
  return `${resolveWebOAuthOrigin(origin, env)}/api/accounts/oauth/callback`;
}

export function isWebOAuthConfigured(env = process.env) {
  const { clientId, clientSecret } = resolveWebOAuthCredentials(env);
  return Boolean(clientId && clientSecret);
}

export function resolveOAuthMode({ mode, origin } = {}, env = process.env) {
  if (mode === "web") {
    if (!origin) throw new Error("Web OAuth requires the dashboard origin");
    if (!isWebOAuthConfigured(env)) {
      throw new Error("Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel for one-click Google OAuth");
    }
    return "web";
  }
  return "antigravity";
}

function oauthClient(clientKind = "antigravity", env = process.env) {
  const credentials = clientKind === "web" ? resolveWebOAuthCredentials(env) : resolveOAuthCredentials(env);
  if (!credentials.clientId || !credentials.clientSecret) {
    if (clientKind === "web") {
      throw new Error("Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel for one-click Google OAuth");
    }
    throw new Error("Provider-native Antigravity OAuth client is unavailable");
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
    const normalized = /^(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(input)
      ? `http://${input}`
      : input;
    url = new URL(normalized);
  } catch {
    const query = input.startsWith("?") ? input.slice(1) : input;
    url = new URL(`${ANTIGRAVITY_NATIVE_REDIRECT_URI}?${query}`);
  }
  const providerError = url.searchParams.get("error");
  if (providerError) {
    const description = url.searchParams.get("error_description");
    const detail = description ? ` — ${description}` : "";
    throw new Error(`OAuth provider error: ${(providerError + detail).slice(0, 240)}`);
  }
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) throw new Error("OAuth callback is missing state or code");
  if (expectedState && state !== expectedState) throw new Error("OAuth state mismatch");
  return { state, code };
}

export async function startOAuthFlow({ origin, mode } = {}) {
  const clientKind = resolveOAuthMode({ mode, origin }, process.env);
  const { clientId } = oauthClient(clientKind);
  const returnOrigin = normalizeHttpOrigin(origin);
  const redirectUri = clientKind === "web" ? webOAuthRedirectUri(origin, process.env) : ANTIGRAVITY_NATIVE_REDIRECT_URI;
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(32).toString("base64url");

  await setJson(
    `gemini-critic:oauth:${state}`,
    { verifier, createdAt: Date.now(), redirectUri, returnOrigin, clientKind },
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
    returnOrigin,
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
  const returnOrigin = flow.returnOrigin || "";
  try {
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
      oauthClientType: flow.clientKind,
      returnOrigin
    };
  } catch (error) {
    if (error && typeof error === "object") error.oauthReturnOrigin = returnOrigin;
    throw error;
  }
}

export async function finishOAuthFlow(callbackUrl, expectedState) {
  const { state, code } = parseOAuthCallback(callbackUrl, expectedState);
  return completeOAuthCode(state, code);
}

export async function finishOAuthCallback({ state, code, error, errorDescription }) {
  if (error) {
    let returnOrigin = "";
    if (state) {
      const key = `gemini-critic:oauth:${state}`;
      try {
        const flow = await getJson(key);
        returnOrigin = flow?.returnOrigin || "";
        await deleteKey(key);
      } catch {
        // Keep the callback usable even when the flow has already expired.
      }
    }
    const detail = errorDescription ? ` — ${String(errorDescription)}` : "";
    const callbackError = new Error(`OAuth provider error: ${(String(error) + detail).slice(0, 240)}`);
    callbackError.oauthReturnOrigin = returnOrigin;
    throw callbackError;
  }
  if (!state || !code) throw new Error("OAuth callback is missing state or code");
  return completeOAuthCode(state, code);
}
