import crypto from "node:crypto";
import { isRedisConfigured, redisCommand } from "../accounts/redis.js";

const WINDOW_SECONDS = 60;
const DEFAULT_PUBLIC_PER_MINUTE = 10;
const DEFAULT_AUTHENTICATED_PER_MINUTE = 60;
const MAX_LIMIT = 10000;
const RATE_LIMIT_SCRIPT = [
  "local current = redis.call('INCR', KEYS[1])",
  "if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end",
  "local ttl = redis.call('TTL', KEYS[1])",
  "return {current, ttl}"
].join("\n");

function positiveLimit(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) return fallback;
  return parsed;
}

export function getRateLimitConfig(env = process.env) {
  return {
    configured: isRedisConfigured(env),
    windowSeconds: WINDOW_SECONDS,
    publicPerMinute: positiveLimit(
      env.MCP_RATE_LIMIT_PUBLIC_PER_MINUTE,
      DEFAULT_PUBLIC_PER_MINUTE
    ),
    authenticatedPerMinute: positiveLimit(
      env.MCP_RATE_LIMIT_AUTHENTICATED_PER_MINUTE,
      DEFAULT_AUTHENTICATED_PER_MINUTE
    )
  };
}

function clientIdentity(request) {
  const forwarded = request?.headers?.get?.("x-forwarded-for") || "";
  const firstForwarded = forwarded.split(",")[0]?.trim();
  const realIp = request?.headers?.get?.("x-real-ip")?.trim();
  return firstForwarded || realIp || "unknown";
}

function hashedIdentity(request) {
  return crypto.createHash("sha256").update(clientIdentity(request)).digest("hex").slice(0, 24);
}

export async function checkMcpRateLimit(
  request,
  {
    authenticated = false,
    env = process.env,
    redisCommandFn = redisCommand
  } = {}
) {
  const config = getRateLimitConfig(env);
  const limit = authenticated ? config.authenticatedPerMinute : config.publicPerMinute;

  if (!config.configured) {
    return {
      allowed: true,
      configured: false,
      degraded: false,
      limit,
      remaining: null,
      retryAfterSeconds: 0
    };
  }

  const tier = authenticated ? "authenticated" : "public";
  const key = `gemini-critic:mcp-rate:v1:${tier}:${hashedIdentity(request)}`;
  const command = ["EVAL", RATE_LIMIT_SCRIPT, 1, key, String(config.windowSeconds)];

  try {
    const result = await redisCommandFn(command, env);
    const count = Math.max(0, Number(Array.isArray(result) ? result[0] : 0) || 0);
    const ttl = Math.max(1, Number(Array.isArray(result) ? result[1] : config.windowSeconds) || config.windowSeconds);
    const allowed = count <= limit;

    return {
      allowed,
      configured: true,
      degraded: false,
      limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: allowed ? 0 : ttl
    };
  } catch {
    return {
      allowed: true,
      configured: true,
      degraded: true,
      limit,
      remaining: null,
      retryAfterSeconds: 0
    };
  }
}
