import test from "node:test";
import assert from "node:assert/strict";
import { buildCompareDeleteCommand, resolveRedisCredentials } from "../src/accounts/redis.js";
import { encryptSecret, decryptSecret } from "../src/accounts/crypto.js";
import { accountRecordKey, normalizeAccountRecord } from "../src/accounts/store.js";
import {
  parseOAuthCallback,
  resolveOAuthCredentials,
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

test("direct web OAuth uses dedicated Google web client credentials", () => {
  assert.deepEqual(
    resolveWebOAuthCredentials({ GOOGLE_OAUTH_CLIENT_ID: "web-id", GOOGLE_OAUTH_CLIENT_SECRET: "web-secret" }),
    { clientId: "web-id", clientSecret: "web-secret" }
  );
  assert.equal(
    webOAuthRedirectUri("https://gemini-osaprivat.vercel.app/"),
    "https://gemini-osaprivat.vercel.app/api/accounts/oauth/callback"
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
});
