import { getConfigurationStatus } from "../../../src/antigravity/client.js";
import { getEncryptionConfigurationStatus } from "../../../src/accounts/crypto.js";
import { getMcpMetadata } from "../../../src/mcp/metadata.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    ok: true,
    service: "gemini-critic-mcp",
    ...getConfigurationStatus(),
    mcp: getMcpMetadata(),
    encryption: getEncryptionConfigurationStatus()
  });
}
