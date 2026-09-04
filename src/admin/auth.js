import crypto from "node:crypto";

const COOKIE_NAME = "gemini_critic_admin";

function adminSecret(env = process.env) {
  return env.ADMIN_PASSWORD?.trim() || env.MCP_SHARED_SECRET?.trim() || "";
}

function sessionValue(secret) {
  return crypto.createHash("sha256").update(`gemini-critic-admin:${secret}`).digest("hex");
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cookieValue(request) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export function isAdminConfigured(env = process.env) {
  return Boolean(adminSecret(env));
}

export function verifyAdminPassword(password, env = process.env) {
  const secret = adminSecret(env);
  return Boolean(secret) && timingSafeEqualText(password, secret);
}

export function isAdminRequest(request, env = process.env) {
  const secret = adminSecret(env);
  if (!secret) return false;
  return timingSafeEqualText(cookieValue(request), sessionValue(secret));
}

function requestUsesSecureCookies(request) {
  if (!request) return true;
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  try {
    if (new URL(request.url).protocol === "https:") return true;
  } catch {
    return true;
  }
  return forwardedProtocol === "https";
}

export function adminCookie(env = process.env, request) {
  const secret = adminSecret(env);
  if (!secret) throw new Error("Set ADMIN_PASSWORD or MCP_SHARED_SECRET in Vercel");
  const secure = requestUsesSecureCookies(request) ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(sessionValue(secret))}; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=2592000`;
}

export function clearAdminCookie(request) {
  const secure = requestUsesSecureCookies(request) ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=0`;
}

export function requireAdmin(request) {
  if (!isAdminRequest(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
