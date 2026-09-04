# Gemini Critic MCP Design

## Goal
Expose Gemini 3.8 Flash High to ChatGPT Web as a remote MCP critic, not as an executor.

## Architecture
ChatGPT remains planner, judge, and implementer. The MCP server exposes only `challenge` and `compare`. Both tools send text to Gemini through the Antigravity Cloud Code transport and return structured criticism. Gemini receives no tool declarations, filesystem, shell, git, browser, workspace, or write capability.

## Deployment
The service is a stateless Next.js application using `mcp-handler` v2 at `/api/mcp`, suitable for Vercel. Antigravity credentials are server-side environment variables only.

## Security boundaries
- No secrets are committed to GitHub.
- The Gemini request envelope never includes a `tools` field.
- The system prompt explicitly forbids implementation and action-taking.
- Only final response text is returned; thought parts from SSE are discarded.
- An optional `MCP_SHARED_SECRET` can protect the endpoint for clients that can send a Bearer header.

## Tools
### challenge
Inputs: task, proposal, optional context, focus. Returns verdict, summary, objections, missing considerations, alternatives, and confidence.

### compare
Inputs: task, 2-6 options, optional constraints/context. Returns preferred option, ranking, weaknesses, decision rule, and confidence.
