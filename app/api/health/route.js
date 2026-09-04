import { getConfigurationStatus } from "../../../src/antigravity/client.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    ok: true,
    service: "gemini-critic-mcp",
    ...getConfigurationStatus()
  });
}
