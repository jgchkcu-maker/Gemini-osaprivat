import test from "node:test";
import assert from "node:assert/strict";
import {
  checkMcpRateLimit,
  getRateLimitConfig
} from "../src/mcp/rate-limit.js";

const redisEnv = {
  KV_REST_API_URL: "https://redis.example.test",
  KV_REST_API_TOKEN: "redis-token"
};

function request(ip = "203.0.113.8") {
  return new Request("https://critic.example.test/api/mcp", {
    headers: { "x-forwarded-for": `${ip}, 10.0.0.2` }
  });
}

test("rate-limit config uses conservative public and larger authenticated defaults", () => {
  const config = getRateLimitConfig(redisEnv);
  assert.equal(config.configured, true);
  assert.equal(config.windowSeconds, 60);
  assert.equal(config.publicPerMinute, 10);
  assert.equal(config.authenticatedPerMinute, 60);
});

test("rate-limit config accepts positive environment overrides and rejects invalid values", () => {
  const config = getRateLimitConfig({
    ...redisEnv,
    MCP_RATE_LIMIT_PUBLIC_PER_MINUTE: "17",
    MCP_RATE_LIMIT_AUTHENTICATED_PER_MINUTE: "99"
  });
  assert.equal(config.publicPerMinute, 17);
  assert.equal(config.authenticatedPerMinute, 99);

  const invalid = getRateLimitConfig({
    ...redisEnv,
    MCP_RATE_LIMIT_PUBLIC_PER_MINUTE: "0",
    MCP_RATE_LIMIT_AUTHENTICATED_PER_MINUTE: "not-a-number"
  });
  assert.equal(invalid.publicPerMinute, 10);
  assert.equal(invalid.authenticatedPerMinute, 60);
});

test("public limiter uses one Redis EVAL command and hashes client identity", async () => {
  const commands = [];
  const result = await checkMcpRateLimit(request(), {
    authenticated: false,
    env: redisEnv,
    redisCommandFn: async (command) => {
      commands.push(command);
      return [1, 59];
    }
  });

  assert.equal(result.allowed, true);
  assert.equal(result.limit, 10);
  assert.equal(result.remaining, 9);
  assert.equal(commands.length, 1);
  assert.equal(commands[0][0], "EVAL");
  assert.equal(commands[0][2], 1);
  assert.match(commands[0][3], /^gemini-critic:mcp-rate:v1:/);
  assert.doesNotMatch(commands[0][3], /203\.0\.113\.8/);
  assert.equal(commands[0][4], "60");
});

test("limiter rejects counts above the selected threshold with a retry hint", async () => {
  const publicResult = await checkMcpRateLimit(request(), {
    authenticated: false,
    env: redisEnv,
    redisCommandFn: async () => [11, 41]
  });
  assert.equal(publicResult.allowed, false);
  assert.equal(publicResult.limit, 10);
  assert.equal(publicResult.remaining, 0);
  assert.equal(publicResult.retryAfterSeconds, 41);

  const authenticatedResult = await checkMcpRateLimit(request(), {
    authenticated: true,
    env: redisEnv,
    redisCommandFn: async () => [11, 41]
  });
  assert.equal(authenticatedResult.allowed, true);
  assert.equal(authenticatedResult.limit, 60);
  assert.equal(authenticatedResult.remaining, 49);
});

test("limiter is inactive without Redis and fails open when Redis errors", async () => {
  const inactive = await checkMcpRateLimit(request(), { env: {} });
  assert.equal(inactive.allowed, true);
  assert.equal(inactive.configured, false);
  assert.equal(inactive.degraded, false);

  const degraded = await checkMcpRateLimit(request(), {
    env: redisEnv,
    redisCommandFn: async () => {
      throw new Error("redis unavailable");
    }
  });
  assert.equal(degraded.allowed, true);
  assert.equal(degraded.configured, true);
  assert.equal(degraded.degraded, true);
  assert.equal(degraded.remaining, null);
});
