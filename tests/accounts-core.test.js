import test from "node:test";
import assert from "node:assert/strict";
import { resolveRedisCredentials } from "../src/accounts/redis.js";
import { encryptSecret, decryptSecret } from "../src/accounts/crypto.js";
import { parseOAuthCallback } from "../src/accounts/oauth.js";

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
