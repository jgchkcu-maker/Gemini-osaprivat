import { isAdminConfigured, isAdminRequest } from "../../../../src/admin/auth.js";
import { getPoolStatus } from "../../../../src/accounts/store.js";
import { isRedisConfigured } from "../../../../src/accounts/redis.js";
import { isOAuthConfigured, isWebOAuthConfigured, webOAuthRedirectUri } from "../../../../src/accounts/oauth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const authenticated = isAdminRequest(request);
  const origin = new URL(request.url).origin;
  const base = {
    ok: true,
    authenticated,
    adminConfigured: isAdminConfigured(),
    redisConfigured: isRedisConfigured(),
    oauthConfigured: isOAuthConfigured(),
    webOauthConfigured: isWebOAuthConfigured(),
    oauthRedirectUri: webOAuthRedirectUri(origin),
    model: "gemini-3.8-flash-high",
    modelLocked: true
  };
  if (!authenticated) return Response.json(base);
  try {
    return Response.json({ ...base, pool: await getPoolStatus() });
  } catch (error) {
    return Response.json({ ...base, pool: { configured: false, total: 0, enabled: 0, available: 0 }, storageError: error.message });
  }
}
