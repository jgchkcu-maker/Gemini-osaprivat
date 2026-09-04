import { createMcpHandler } from "mcp-handler";
import { challenge, compare } from "../../../src/critic/service.js";
import {
  challengeInputSchema,
  challengeOutputSchema,
  compareInputSchema,
  compareOutputSchema
} from "../../../src/critic/schemas.js";
import { checkMcpRateLimit } from "../../../src/mcp/rate-limit.js";
import { isAuthorizedBearer } from "../../../src/mcp/security.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function asToolResult(value) {
  return {
    structuredContent: value,
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function asToolError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: `Gemini critic failed: ${message}` }]
  };
}

const mcp = createMcpHandler((server) => {
  server.registerTool(
    "challenge",
    {
      title: "Challenge a proposal",
      description:
        "Ask Gemini 3.8 Flash High to independently review a plan or decision. Supply relevant evidence in context for architecture/code reviews. Gemini is critique-only: it cannot edit files, run commands, browse, deploy, or execute the task.",
      inputSchema: challengeInputSchema,
      outputSchema: challengeOutputSchema
    },
    async (input) => {
      try {
        return asToolResult(await challenge(input));
      } catch (error) {
        return asToolError(error);
      }
    }
  );

  server.registerTool(
    "compare",
    {
      title: "Compare candidate approaches",
      description:
        "Ask Gemini 3.8 Flash High to rank 2-6 credible options and identify trade-offs. Supply relevant evidence in context. Gemini only judges the options and does not execute any of them.",
      inputSchema: compareInputSchema,
      outputSchema: compareOutputSchema
    },
    async (input) => {
      try {
        return asToolResult(await compare(input));
      } catch (error) {
        return asToolError(error);
      }
    }
  );
});

async function handler(request) {
  const secret = process.env.MCP_SHARED_SECRET?.trim();
  let authenticated = false;

  if (secret) {
    const authorization = request.headers.get("authorization");
    if (!isAuthorizedBearer(authorization, secret)) {
      return Response.json(
        { error: "unauthorized" },
        {
          status: 401,
          headers: { "WWW-Authenticate": 'Bearer realm="gemini-critic-mcp"' }
        }
      );
    }
    authenticated = true;
  }

  const rateLimit = await checkMcpRateLimit(request, { authenticated });
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
          "X-RateLimit-Limit": String(rateLimit.limit),
          "X-RateLimit-Remaining": String(rateLimit.remaining)
        }
      }
    );
  }

  return mcp(request);
}

export { handler as GET, handler as POST };
