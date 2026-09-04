# Gemini Critic Control

Remote MCP + web dashboard for **ChatGPT Web → Gemini 3.8 Flash High**. Gemini is an independent critic only; ChatGPT remains planner, judge and executor.

## What is locked down

The model is hard-coded to `gemini-3.8-flash-high`. There is no environment-variable override. Gemini receives text only: no filesystem, shell, git, browser, workspace, deploy access, or MCP tools. Upstream thought parts are discarded before the response is returned to ChatGPT.

MCP tools:

- `challenge` — attack assumptions, edge cases and weak decisions.
- `compare` — rank 2–6 candidate approaches and explain trade-offs.

## Account pool dashboard

The home page is a private control panel for multiple Antigravity Google accounts:

- encrypted refresh credentials in Upstash Redis;
- round-robin account selection;
- automatic cooldown after `429`;
- `Needs login` after `401/403`;
- enable/disable and remove accounts;
- Google OAuth paste-callback flow when OAuth env is configured;
- manual import of existing `refreshToken|projectId|managedProjectId` credentials.

Refresh tokens are encrypted with AES-256-GCM before being stored. By default the Redis secret token is used as the encryption seed; `ACCOUNT_ENCRYPTION_KEY` can be supplied to use a separate seed.

## Vercel configuration

Connect **Upstash for Redis** from Vercel Marketplace. This app recognizes both common Vercel/Upstash variable sets:

```env
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
```

or:

```env
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

Then set:

```env
ADMIN_PASSWORD=choose-a-strong-password
ANTIGRAVITY_OAUTH_CLIENT_ID=...
ANTIGRAVITY_OAUTH_CLIENT_SECRET=...
```

`ADMIN_PASSWORD` protects the web dashboard with a Secure/HttpOnly/SameSite cookie. OAuth client variables are required for refreshing pooled Google accounts and for the browser OAuth flow. They must stay in Vercel Environment Variables and must never be committed to GitHub.

Optional:

```env
ACCOUNT_ENCRYPTION_KEY=separate-long-random-secret
MCP_SHARED_SECRET=optional-bearer-secret
ANTIGRAVITY_API_ENDPOINT=optional-custom-endpoint
```

Legacy single-account env credentials are still accepted as a fallback if the Redis pool is empty.

After adding or changing env variables, redeploy the project.

## URLs

Dashboard:

```text
https://YOUR-PROJECT.vercel.app/
```

MCP:

```text
https://YOUR-PROJECT.vercel.app/api/mcp
```

Health:

```text
https://YOUR-PROJECT.vercel.app/api/health
```

## Recommended ChatGPT instruction

```text
You are the primary planner and executor. Use Gemini Critic as an independent second opinion.
Call challenge after a non-trivial plan, before an important architecture decision, when uncertain, and before finalizing a large change.
Use compare when there are 2+ credible alternatives.
Never delegate implementation to Gemini. Evaluate its objections yourself and make the final decision.
```

## Checks

```bash
npm install
npm test
npm run check
npm run build
```

Node.js 20+ is required.

## Note

This is an unofficial bridge around Antigravity/Cloud Code behavior used by community integrations. Private/internal endpoints and model IDs can change. Use accounts you control, respect provider terms and quotas, and keep credentials server-side.
