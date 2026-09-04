import { adminCookie, isAdminConfigured, verifyAdminPassword } from "../../../../src/admin/auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!isAdminConfigured()) {
    return Response.json({ error: "Set ADMIN_PASSWORD in Vercel Environment Variables first" }, { status: 503 });
  }
  const body = await request.json().catch(() => ({}));
  if (!verifyAdminPassword(body?.password || "")) {
    return Response.json({ error: "Invalid password" }, { status: 401 });
  }
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": adminCookie(), "Cache-Control": "no-store" } }
  );
}
