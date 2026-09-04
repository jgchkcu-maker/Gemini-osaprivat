import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getEncryptionConfigurationStatus } from "../src/accounts/crypto.js";
import { getMcpMetadata } from "../src/mcp/metadata.js";

const healthRouteUrl = new URL("../app/api/health/route.js", import.meta.url);

test("encryption diagnostics distinguish dedicated key, Redis fallback, and unconfigured state", () => {
  assert.deepEqual(
    getEncryptionConfigurationStatus({ ACCOUNT_ENCRYPTION_KEY: "dedicated-secret-value" }),
    { configured: true, source: "dedicated" }
  );

  assert.deepEqual(
    getEncryptionConfigurationStatus({
      KV_REST_API_URL: "https://redis.example.test",
      KV_REST_API_TOKEN: "redis-secret-value"
    }),
    { configured: true, source: "redis-token" }
  );

  assert.deepEqual(getEncryptionConfigurationStatus({}), {
    configured: false,
    source: "unconfigured"
  });
});

test("MCP metadata exposes safe tool/auth/rate-limit diagnostics without secret values", () => {
  const env = {
    MCP_SHARED_SECRET: "mcp-secret-value",
    KV_REST_API_URL: "https://redis.example.test",
    KV_REST_API_TOKEN: "redis-secret-value",
    MCP_RATE_LIMIT_PUBLIC_PER_MINUTE: "21",
    MCP_RATE_LIMIT_AUTHENTICATED_PER_MINUTE: "84"
  };

  const metadata = getMcpMetadata(env);
  assert.equal(metadata.version, "0.4.0");
  assert.equal(metadata.transport, "streamable-http");
  assert.deepEqual(metadata.tools, ["challenge", "compare"]);
  assert.equal(metadata.structuredOutput, true);
  assert.equal(metadata.outputValidation, true);
  assert.equal(metadata.authMode, "bearer");
  assert.deepEqual(metadata.rateLimit, {
    configured: true,
    windowSeconds: 60,
    publicPerMinute: 21,
    authenticatedPerMinute: 84
  });

  const serialized = JSON.stringify(metadata);
  assert.doesNotMatch(serialized, /mcp-secret-value/);
  assert.doesNotMatch(serialized, /redis-secret-value/);
});

test("health route includes MCP and encryption diagnostics", async () => {
  const source = await readFile(healthRouteUrl, "utf8");
  assert.match(source, /getMcpMetadata/);
  assert.match(source, /getEncryptionConfigurationStatus/);
  assert.match(source, /mcp:/);
  assert.match(source, /encryption:/);
});
