const URL_KEYS = [
  "KV_REST_API_URL",
  "UPSTASH_REDIS_REST_URL",
  "STORAGE_KV_REST_API_URL",
  "STORAGE_REST_API_URL"
];

const TOKEN_KEYS = [
  "KV_REST_API_TOKEN",
  "UPSTASH_REDIS_REST_TOKEN",
  "STORAGE_KV_REST_API_TOKEN",
  "STORAGE_REST_API_TOKEN"
];

function firstPresent(env, keys) {
  for (const key of keys) {
    const value = env?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function resolveRedisCredentials(env = process.env) {
  const url = firstPresent(env, URL_KEYS).replace(/\/$/, "");
  const token = firstPresent(env, TOKEN_KEYS);
  if (!url || !token) return null;
  return { url, token };
}

export function isRedisConfigured(env = process.env) {
  return Boolean(resolveRedisCredentials(env));
}

export async function redisCommand(command, env = process.env) {
  const credentials = resolveRedisCredentials(env);
  if (!credentials) {
    throw new Error("Upstash Redis is not configured. Connect the Vercel Upstash integration first.");
  }

  const response = await fetch(credentials.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(12_000)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    throw new Error(`Upstash Redis failed (${response.status}): ${payload?.error || "unknown error"}`);
  }
  return payload?.result;
}

export async function getJson(key) {
  const value = await redisCommand(["GET", key]);
  if (value == null || value === "") return null;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Invalid JSON stored at Redis key ${key}`);
  }
}

export async function setJson(key, value, ttlSeconds) {
  const command = ["SET", key, JSON.stringify(value)];
  if (ttlSeconds) command.push("EX", Math.max(1, Math.floor(ttlSeconds)));
  await redisCommand(command);
  return value;
}

export async function deleteKey(key) {
  await redisCommand(["DEL", key]);
}

export async function increment(key) {
  return Number(await redisCommand(["INCR", key]));
}
