import { requireAdmin } from "../../../src/admin/auth.js";
import { addAccount, listAccounts, removeAccount, setAccountEnabled } from "../../../src/accounts/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseComposite(value = "") {
  const [refreshToken = "", projectId = "", managedProjectId = ""] = String(value).trim().split("|");
  return { refreshToken, projectId: managedProjectId || projectId || "" };
}

function errorResponse(error, status = 400) {
  return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function GET(request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;
  try {
    return Response.json({ accounts: await listAccounts() });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

export async function POST(request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json();
    const composite = parseComposite(body?.refreshToken || "");
    const account = await addAccount({
      email: body?.email || "Antigravity account",
      projectId: body?.projectId || composite.projectId,
      refreshToken: composite.refreshToken
    });
    return Response.json({ account }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json();
    if (!body?.id) throw new Error("Account id is required");
    const account = await setAccountEnabled(body.id, body.enabled);
    return Response.json({ account });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json().catch(() => ({}));
    if (!body?.id) throw new Error("Account id is required");
    await removeAccount(body.id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
