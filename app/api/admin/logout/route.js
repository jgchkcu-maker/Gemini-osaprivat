import { clearAdminCookie } from "../../../../src/admin/auth.js";

export const runtime = "nodejs";

export async function POST() {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearAdminCookie() } });
}
