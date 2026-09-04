import test from "node:test";
import assert from "node:assert/strict";
import { buildCompareDeleteCommand, resolveRedisCredentials } from "../src/accounts/redis.js";
import { encryptSecret, decryptSecret } from "../src/accounts/crypto.js";
import { accountRecordKey, normalizeAccountRecord } from "../src/accounts/store.js";
import { adminCookie, clearAdminCookie } from "../src/admin/auth.js";
import {
  ANTIGRAVITY_NATIVE_REDIRECT_URI,
  ANTIGRAVITY_NATIVE_SCOPES,
  parseOAuthCallback,
  resolveOAuthCredentials,
  resolveOAuthMode,
  resolveWebOAuthCredentials,
  webOAuthRedirectUri
} from "../src/accounts/oauth.js";

test("Redis credentials support Vercel KV integration names", () => {
  assert.deepEqual(
    resolveRedisCredentials({ KV_REST_API_URL: "https://redis.example", KV_REST_API_TOKEN: "token" }),
    { url: "https://redis.example", token: "token" }
  );
});

test("Redis credentials support canonical Upstash names", () => {
  assert.deepEqual(
    resolveRedisCredentials({ UPSTASH_REDIS_REST_URL: "https://redis.example", UPSTASH_REDIS_REST_TOKEN: "token" }),
    { url: "https://redis.example", token: "token" }
  );
});

test("Redis credentials support Vercel custom STORAGE prefix", () => {
  assert.deepEqual(
    resolveRedisCredentials({ STORAGE_URL: "https://redis.example", STORAGE_TOKEN: "token" }),
    { url: "https://redis.example", token: "token" }
  );
});

test("distributed lock release uses compare-and-delete Lua", () => {
  const command = buildCompareDeleteCommand("pool:lock", "owner-token");
  assert.equal(command[0], "EVAL");
  assert.equal(command[2], 1);
  assert.equal(command[3], "pool:lock");
  assert.equal(command[4], "owner-token");
  assert.match(command[1], /redis\.call\(['\"]get['\"]/i);
  assert.match(command[1], /redis\.call\(['\"]del['\"]/i);
});

test("account records have stable per-account Redis keys", () => {
  assert.equal(accountRecordKey("abc-123"), "gemini-critic:account:v2:abc-123");
});

test("legacy account records normalize to the v2 pool shape", () => {
  const record = normalizeAccountRecord({
    id: "a",
    email: "a@example.com",
    refreshToken: "encrypted",
    enabled: true,
    cooldownUntil: 5000
  });
  assert.equal(record.id, "a");
  assert.equal(record.oauthClientType, "antigravity");
  assert.deepEqual(record.modelLocks, {});
  assert.equal(record.cooldownUntil, 5000);
});

test("OAuth credentials support existing ANTIGRAVITY_CLIENT aliases", () => {
  assert.deepEqual(
    resolveOAuthCredentials({ ANTIGRAVITY_CLIENT_ID: "id", ANTIGRAVITY_CLIENT_SECRET: "secret" }),
    { clientId: "id", clientSecret: "secret" }
  );
});

test("OAuth credentials support the exact misspelled Vercel names already in this project", () => {
  assert.deepEqual(
    resolveOAuthCredentials({ ANTIGRAVIT_CLIENT_ID: "id", ANTIGRAVIT_ENT_SECRET: "secret" }),
    { clientId: "id", clientSecret: "secret" }
  );
});

test("OAuth credentials tolerate unknown Antigravity env typos by semantic key matching", () => {
  assert.deepEqual(
    resolveOAuthCredentials({ ANTIGRAVTY_LOGIN_CLIENT_ID: "id", ANTIGRAVTY_LOGIN_CLIENT_SECRET: "secret" }),
    { clientId: "id", clientSecret: "secret" }
  );
});

test("provider-native Antigravity OAuth is the default and matches 9router scopes", () => {
  assert.equal(ANTIGRAVITY_NATIVE_REDIRECT_URI, "http://localhost:51121/oauth-callback");
  assert.deepEqual(ANTIGRAVITY_NATIVE_SCOPES, [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs"
  ]);
  assert.equal(
    resolveOAuthMode(
      { mode: undefined, origin: "https://gemini-osaprivat.vercel.app" },
      {
        ANTIGRAVITY_CLIENT_ID: "ag-id",
        ANTIGRAVITY_CLIENT_SECRET: "ag-secret",
        GOOGLE_OAUTH_CLIENT_ID: "web-id",
        GOOGLE_OAUTH_CLIENT_SECRET: "web-secret"
      }
    ),
    "antigravity"
  );
});

test("direct web OAuth is opt-in and uses dedicated Google web client credentials", () => {
  const env = { GOOGLE_OAUTH_CLIENT_ID: "web-id", GOOGLE_OAUTH_CLIENT_SECRET: "web-secret" };
  assert.deepEqual(resolveWebOAuthCredentials(env), { clientId: "web-id", clientSecret: "web-secret" });
  assert.equal(
    resolveOAuthMode({ mode: "web", origin: "https://gemini-osaprivat.vercel.app" }, env),
    "web"
  );
  assert.equal(
    webOAuthRedirectUri("https://gemini-osaprivat.vercel.app/"),
    "https://gemini-osaprivat.vercel.app/api/accounts/oauth/callback"
  );
});

test("web OAuth accepts common Google client env aliases", () => {
  assert.deepEqual(
    resolveWebOAuthCredentials({ GOOGLE_CLIENT_ID: "web-id", GOOGLE_CLIENT_SECRET: "web-secret" }),
    { clientId: "web-id", clientSecret: "web-secret" }
  );
});

test("explicit web OAuth never silently falls back to the manual native flow", () => {
  assert.throws(
    () => resolveOAuthMode({ mode: "web", origin: "https://gemini-osaprivat.vercel.app" }, {}),
    /GOOGLE_OAUTH_CLIENT_ID.*GOOGLE_OAUTH_CLIENT_SECRET/i
  );
});

test("web OAuth can use a stable app origin when the dashboard is opened from a preview URL", () => {
  const env = {
    GOOGLE_OAUTH_CLIENT_ID: "web-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "web-secret",
    GOOGLE_OAUTH_APP_URL: "https://gemini-osaprivat.vercel.app"
  };
  assert.equal(
    webOAuthRedirectUri("https://gemini-osaprivat-git-main-jgchkcu-maker.vercel.app", env),
    "https://gemini-osaprivat.vercel.app/api/accounts/oauth/callback"
  );
});

test("configured web OAuth redirect URI must point to this callback route", () => {
  const env = {
    GOOGLE_OAUTH_REDIRECT_URI: "https://gemini-osaprivat.vercel.app/wrong-callback"
  };
  assert.throws(
    () => webOAuthRedirectUri("https://gemini-osaprivat.vercel.app", env),
    /callback pathname/i
  );
  assert.throws(
    () => webOAuthRedirectUri("https://gemini-osaprivat.vercel.app", {
      GOOGLE_OAUTH_REDIRECT_URI: "https://gemini-osaprivat.vercel.app/api/accounts/oauth/callback?source=preview"
    }),
    /query parameters/i
  );
});

test("account refresh tokens are encrypted and can be recovered", () => {
  const encrypted = encryptSecret("refresh-token", "a sufficiently long encryption seed");
  assert.notEqual(encrypted, "refresh-token");
  assert.equal(decryptSecret(encrypted, "a sufficiently long encryption seed"), "refresh-token");
});

test("OAuth callback validates state", () => {
  const parsed = parseOAuthCallback(
    "http://localhost:51121/oauth-callback?state=expected&code=abc123",
    "expected"
  );
  assert.deepEqual(parsed, { state: "expected", code: "abc123" });
  assert.throws(
    () => parseOAuthCallback("http://localhost:51121/oauth-callback?state=wrong&code=abc123", "expected"),
    /state mismatch/i
  );
  assert.throws(
    () => parseOAuthCallback("http://localhost:51121/oauth-callback?error=access_denied&error_description=User%20cancelled", "expected"),
    /access_denied.*User cancelled/i
  );
  assert.deepEqual(
    parseOAuthCallback("localhost:51121/oauth-callback?state=expected&code=abc123", "expected"),
    { state: "expected", code: "abc123" }
  );
});

test("admin cookies are usable on local HTTP and remain secure on HTTPS", () => {
  const httpRequest = new Request("http://localhost:3000/api/admin/login");
  const httpsRequest = new Request("https://gemini-osaprivat.vercel.app/api/admin/login");
  const conflictingProxyRequest = new Request("https://gemini-osaprivat.vercel.app/api/admin/login", {
    headers: { "x-forwarded-proto": "http" }
  });
  const trustedProxyRequest = new Request("http://127.0.0.1:3000/api/admin/login", {
    headers: { "x-forwarded-proto": "https" }
  });
  assert.doesNotMatch(adminCookie({ ADMIN_PASSWORD: "local-password-123" }, httpRequest), /; Secure/);
  assert.match(adminCookie({ ADMIN_PASSWORD: "local-password-123" }, httpsRequest), /; Secure/);
  assert.match(adminCookie({ ADMIN_PASSWORD: "local-password-123" }, conflictingProxyRequest), /; Secure/);
  assert.match(adminCookie({ ADMIN_PASSWORD: "local-password-123" }, trustedProxyRequest), /; Secure/);
  assert.doesNotMatch(clearAdminCookie(httpRequest), /; Secure/);
});
