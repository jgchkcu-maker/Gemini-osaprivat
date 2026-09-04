import crypto from "node:crypto";

export function getMcpAuthMode(env = process.env) {
  return env.MCP_SHARED_SECRET?.trim() ? "bearer" : "public";
}

export function isAuthorizedBearer(authorization, secret) {
  const normalizedSecret = String(secret ?? "").trim();
  if (!normalizedSecret) return true;

  const expected = Buffer.from(`Bearer ${normalizedSecret}`, "utf8");
  const actual = Buffer.from(String(authorization ?? ""), "utf8");
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}
