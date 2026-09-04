import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { challenge, compare } from "../../../src/critic/service.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function asToolResult(value) {
  return {
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
        "Ask Gemini 3.8 Flash High to critically review a plan or decision. Gemini is critique-only: it cannot edit files, run commands, browse, deploy, or execute the task.",
      inputSchema: z.object({
        task: z.string().min(1).max(30000),
        proposal: z.string().min(1).max(60000),
        context: z.string().max(60000).optional(),
        focus: z
          .enum(["general", "logic", "architecture", "code", "ux", "simplicity", "failure_modes"])
          .default("general")
      })
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
        "Ask Gemini 3.8 Flash High to rank 2-6 options and identify trade-offs. Gemini only judges the options and does not execute any of them.",
      inputSchema: z.object({
        task: z.string().min(1).max(30000),
        options: z.array(z.string().min(1).max(30000)).min(2).max(6),
        constraints: z.string().max(30000).optional(),
        context: z.string().max(60000).optional()
      })
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
  if (secret) {
    const authorization = request.headers.get("authorization");
    if (authorization !== `Bearer ${secret}`) {
      return Response.json(
        { error: "unauthorized" },
        {
          status: 401,
          headers: { "WWW-Authenticate": 'Bearer realm="gemini-critic-mcp"' }
        }
      );
    }
  }
  return mcp(request);
}

export { handler as GET, handler as POST };
