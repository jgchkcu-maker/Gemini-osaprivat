import { requireAdmin } from "../../../../../src/admin/auth.js";
import { finishOAuthFlow } from "../../../../../src/accounts/oauth.js";
import { addAccount } from "../../../../../src/accounts/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json();
    if (!body?.callbackUrl || !body?.state) throw new Error("Callback URL and OAuth state are required");
    const credentials = await finishOAuthFlow(body.callbackUrl, body.state);
    const account = await addAccount({
      email: credentials.email,
      projectId: credentials.projectId,
      refreshToken: credentials.refreshToken,
      oauthClientType: credentials.oauthClientType
    });
    return Response.json({ account });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
