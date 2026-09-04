import { requireAdmin } from "../../../../../src/admin/auth.js";
import { startOAuthFlow } from "../../../../../src/accounts/oauth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;
  try {
    return Response.json(await startOAuthFlow());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
