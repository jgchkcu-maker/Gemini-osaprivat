import { getRateLimitConfig } from "./rate-limit.js";
import { getMcpAuthMode } from "./security.js";

export const MCP_SERVICE_VERSION = "0.4.0";
export const MCP_TOOLS = Object.freeze(["challenge", "compare"]);

export function getMcpMetadata(env = process.env) {
  const rateLimit = getRateLimitConfig(env);
  return {
    version: MCP_SERVICE_VERSION,
    transport: "streamable-http",
    tools: [...MCP_TOOLS],
    structuredOutput: true,
    outputValidation: true,
    authMode: getMcpAuthMode(env),
    rateLimit: {
      configured: rateLimit.configured,
      windowSeconds: rateLimit.windowSeconds,
      publicPerMinute: rateLimit.publicPerMinute,
      authenticatedPerMinute: rateLimit.authenticatedPerMinute
    }
  };
}
