# Gemini Critic MCP

A tiny remote MCP for **ChatGPT Web → Gemini 3.8 Flash High** where Gemini is an independent critic, not an executor.

## What it does

ChatGPT remains the planner, final decision maker, and implementer. This MCP exposes only:

- `challenge` — attack a proposal, find bad assumptions, missing cases, risks, and better alternatives.
- `compare` — rank 2-6 candidate approaches and explain trade-offs.

Gemini receives **no MCP tools, filesystem, shell, git, browser, workspace, deployment, or write access**. The Antigravity request itself is text-only and has no `tools` field. Thinking parts from the upstream SSE response are discarded; only the final critique is returned.

## 1. Local checks

```bash
npm install
npm test
npm run check
npm run build
```

Node.js 20+ is required.

## 2. Configure Antigravity credentials

Copy `.env.example` to `.env.local`.

Recommended stable configuration:

```env
ANTIGRAVITY_REFRESH_TOKEN=...
ANTIGRAVITY_OAUTH_CLIENT_ID=...
ANTIGRAVITY_OAUTH_CLIENT_SECRET=...
ANTIGRAVITY_MODEL=gemini-3.8-flash-high
```

`ANTIGRAVITY_REFRESH_TOKEN` also accepts the common composite form:

```text
refreshToken|projectId|managedProjectId
```

If the project id is not embedded, the server tries `loadCodeAssist` automatically. You may set `ANTIGRAVITY_PROJECT_ID` explicitly.

A short-lived `ANTIGRAVITY_ACCESS_TOKEN` is supported for testing, but it is not suitable for a permanent Vercel deployment.

Do not commit any token or OAuth credential to this repository.

## 3. Deploy on Vercel

1. Import this GitHub repository into Vercel.
2. Add the Antigravity environment variables from `.env.example` in **Project Settings → Environment Variables**.
3. Deploy.
4. Open:

```text
https://YOUR-PROJECT.vercel.app/api/health
```

A healthy configured deployment returns `ok: true`, `configured: true`, and model `gemini-3.8-flash-high`.

Your remote MCP URL is:

```text
https://YOUR-PROJECT.vercel.app/api/mcp
```

## 4. Connect ChatGPT Web

When your ChatGPT plan/workspace exposes custom remote MCP apps, add the URL above as the MCP server endpoint.

Recommended instruction for the main model:

```text
You are the primary planner and executor. Use the Gemini critic only as an independent second opinion.
Call challenge after a non-trivial plan, before an important architecture decision, when you are uncertain, and before finalizing a large change.
Use compare when there are 2+ credible alternatives.
Do not delegate implementation to Gemini. Evaluate its objections yourself and make the final decision.
```

## Optional endpoint protection

If your MCP client can attach a static `Authorization: Bearer ...` header, set `MCP_SHARED_SECRET` on Vercel. If it cannot, leave this unset and add a proper OAuth layer before exposing a sensitive/public production MCP.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTIGRAVITY_REFRESH_TOKEN` | recommended | Long-lived Antigravity/Google refresh credential |
| `ANTIGRAVITY_OAUTH_CLIENT_ID` | with refresh token | OAuth client used to refresh the access token |
| `ANTIGRAVITY_OAUTH_CLIENT_SECRET` | with refresh token | OAuth client secret |
| `ANTIGRAVITY_PROJECT_ID` | optional | Skip automatic project discovery |
| `ANTIGRAVITY_MODEL` | optional | Defaults to `gemini-3.8-flash-high` |
| `ANTIGRAVITY_ACCESS_TOKEN` | optional | Temporary alternative to refresh auth |
| `MCP_SHARED_SECRET` | optional | Static Bearer protection for compatible clients |
| `ANTIGRAVITY_API_ENDPOINT` | optional | Prepend a custom Cloud Code endpoint |

## Notes

This is an unofficial bridge built around the Antigravity/Cloud Code transport used by community integrations. Upstream private/internal endpoints and model ids can change. Use your own account, respect provider terms and quotas, and keep credentials server-side.
