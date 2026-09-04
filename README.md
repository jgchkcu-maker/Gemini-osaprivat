# Gemini Critic Control

Remote MCP + web dashboard for **ChatGPT Web → Gemini 3.8 Flash High**. Gemini is an independent reviewer only; ChatGPT remains planner, judge and executor.

## What is locked down

The public model is hard-coded to `gemini-3.8-flash-high`, currently mapped to the Antigravity upstream id `gemini-3.8-flash-high(high)`. There is no environment-variable override. Gemini receives text only: no filesystem, shell, git, browser, workspace, deploy access, or MCP tools. Upstream thought parts are discarded before the response is returned to ChatGPT.

MCP tools stay intentionally small:

- `challenge` — independently review one concrete proposal for material weaknesses, false assumptions and failure modes.
- `compare` — rank 2–6 credible candidate approaches and explain the decision trade-offs.

Both tools now publish Zod input/output schemas and return validated `structuredContent` plus a JSON text compatibility fallback. Malformed Gemini JSON is converted to a low-confidence schema-valid degraded result instead of leaking arbitrary values into the MCP contract.

For `challenge`, every objection includes `decision_impact`:

- `blocks` — do not execute the proposal as written;
- `changes_design` — the direction may survive, but a material redesign is needed;
- `minor` — useful local improvement that does not change the main decision.

The result also includes `requires_rechallenge`. Gemini should set it only when fixing a material objection changes the proposal enough that one more independent review has real decision value.

## How ChatGPT should use the critic

Gemini is deliberately not given repository or execution tools. The primary agent must collect the smallest relevant evidence itself and pass it through `context`.

A good architecture/code review context normally contains:

```text
GOAL
CONSTRAINTS
CURRENT FLOW
RELEVANT CODE OR OBSERVED BEHAVIOR
KNOWN RISKS / UNCERTAINTIES
```

Recommended orchestration:

1. ChatGPT researches the task and forms its own candidate decision.
2. If there are 2+ genuinely credible approaches, call `compare` first.
3. Call `challenge` for non-trivial plans, architecture changes, multi-file changes, security/auth/state/concurrency risk, uncertain assumptions, repeated failures, or before finalizing a substantial change.
4. ChatGPT independently evaluates Gemini's objections. Gemini does not get veto power and its suggestions are not executed automatically.
5. If a material objection caused a substantial redesign and `requires_rechallenge=true`, one additional `challenge` is reasonable.
6. Do not create an open-ended GPT ↔ Gemini loop. Minor changes do not justify another review.

Do not call the critic for trivial deterministic edits where a second model is unlikely to change the decision.

## Architecture

The critic path is intentionally layered without turning it into a microservice system:

```text
ChatGPT
  ↓
MCP challenge / compare
  ↓
Critic Service
  ↓
Critic Provider
  ↓
Antigravity Provider
  ↓
Gemini 3.8 Flash High
  ↓
strict output validation
  ↓
MCP structuredContent
  ↓
ChatGPT evaluates and executes
```

`src/critic/service.js` depends on a small provider contract instead of Antigravity transport details directly. Antigravity remains the default provider today, but the reviewer logic is no longer coupled to that implementation.

## Account pool

The pool is intentionally small and purpose-built for the critic. Its behavior is adapted from proven 9router/OmniRoute Antigravity patterns:

- one encrypted Redis record per account instead of one shared JSON blob;
- short distributed selection lock for Vercel/serverless concurrency;
- per-request account lease;
- sticky rotation: reuse a healthy account briefly, then move to the least-recently-used healthy account;
- already-tried accounts are excluded during a retry;
- model-specific cooldowns instead of disabling the whole account for every quota event;
- `401/403` → `Needs login`;
- `409/429` → honor upstream `Retry-After`/reset hints and best-effort query `fetchAvailableModels` for the exact High quota reset;
- transient `5xx` → short cooldown and failover;
- old `accounts:v1` data is migrated automatically to the v2 records.

Refresh credentials remain AES-256-GCM encrypted at rest. For backward compatibility, the Redis secret token can still be used as the encryption seed. For production, set a separate `ACCOUNT_ENCRYPTION_KEY`; `/api/health` reports only whether the source is `dedicated`, `redis-token`, or `unconfigured`, never the secret itself.

## Adding accounts

### Recommended: provider-native Antigravity OAuth

This is the default flow and **does not require creating your own Google Cloud OAuth application**. The project includes the same class of public native-app OAuth credentials used by community Antigravity integrations; explicit `ANTIGRAVITY_*` env values are optional overrides.

1. Dashboard → **Add account** → **Antigravity OAuth**.
2. Click **Continue with Antigravity**.
3. Finish Google sign-in.
4. Google redirects to `http://localhost:51121/oauth-callback?...`.
5. On a remote Vercel deployment localhost may not load; copy the complete URL from the browser address bar.
6. Paste it into the dashboard and click **Add to pool**.

The flow uses PKCE/state, offline access, the provider-native Antigravity OAuth client, user-info lookup, and `loadCodeAssist` project discovery.

### Optional: seamless Web OAuth

If you want one-click browser OAuth with no callback copy/paste, create a Google OAuth client of type **Web application** and configure:

```env
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
```

Authorized redirect URI:

```text
https://YOUR-PROJECT.vercel.app/api/accounts/oauth/callback
```

This mode is optional; the dashboard only offers it when those variables are present.

### Import credential

An existing Antigravity credential can also be imported. Composite form is supported:

```text
refreshToken|projectId|managedProjectId
```

## Vercel configuration

Connect **Upstash for Redis** from Vercel Marketplace. The app recognizes common Vercel/Upstash variable names, including:

```env
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
```

and:

```env
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

For the dashboard, the only required app-level secret is:

```env
ADMIN_PASSWORD=choose-a-strong-password
```

Provider-native Antigravity OAuth works without custom OAuth environment variables. If you intentionally want to override the embedded public native-app client, set **both** values:

```env
ANTIGRAVITY_CLIENT_ID=...
ANTIGRAVITY_CLIENT_SECRET=...
```

The aliases `ANTIGRAVITY_OAUTH_CLIENT_ID` and `ANTIGRAVITY_OAUTH_CLIENT_SECRET` are also accepted. Do not set only one half of the pair.

Recommended/optional settings:

```env
ACCOUNT_ENCRYPTION_KEY=separate-long-random-secret
MCP_SHARED_SECRET=optional-bearer-secret
MCP_RATE_LIMIT_PUBLIC_PER_MINUTE=10
MCP_RATE_LIMIT_AUTHENTICATED_PER_MINUTE=60
ANTIGRAVITY_API_ENDPOINT=optional-custom-endpoint
GOOGLE_OAUTH_CLIENT_ID=optional-web-oauth-client
GOOGLE_OAUTH_CLIENT_SECRET=optional-web-oauth-secret
# Optional when the dashboard is opened from Vercel preview deployments.
# GOOGLE_OAUTH_APP_URL=https://YOUR-PRODUCTION-DOMAIN
# Optional full callback override.
# GOOGLE_OAUTH_REDIRECT_URI=https://YOUR-PRODUCTION-DOMAIN/api/accounts/oauth/callback
```

`ADMIN_PASSWORD` protects the dashboard with a Secure/HttpOnly/SameSite cookie. Keep user credentials and private secrets in Vercel Environment Variables; the embedded native OAuth client is public client metadata, not a per-user credential.

### MCP protection and rate limiting

If `MCP_SHARED_SECRET` is configured, `/api/mcp` requires the exact Bearer credential and compares it with a constant-time check. Enable it only if the MCP client configuration you use can send the bearer token.

If `MCP_SHARED_SECRET` is not set, the endpoint remains public for ChatGPT connectivity/testing. When Redis is configured, a distributed per-client limiter reduces quota abuse. Default limits are:

- public: `10` requests/minute;
- bearer-authenticated: `60` requests/minute.

The client identity is hashed before it is used in a Redis key. Limits can be overridden with `MCP_RATE_LIMIT_PUBLIC_PER_MINUTE` and `MCP_RATE_LIMIT_AUTHENTICATED_PER_MINUTE`.

If Redis is not configured, distributed rate limiting is inactive. If Redis fails during an otherwise valid MCP request, the limiter fails open so a Redis protection dependency does not take the critic itself offline. `/api/health` reports whether rate limiting is configured.

Legacy single-account env credentials are still accepted as a fallback if the Redis pool is empty.

After adding or changing environment variables, redeploy the project.

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

Health output contains safe diagnostics for MCP version, transport, registered tools, structured-output validation, auth mode, rate-limit configuration and encryption-key source. It is intended to distinguish "the MCP server did not expose the tool" from "ChatGPT/custom app did not import the tool" without exposing credentials.

## Recommended ChatGPT instruction

```text
You are the primary planner, final decision-maker and executor. Gemini Critic is an independent second opinion, not a manager or executor.

Before a code or architecture review, collect the smallest relevant evidence from the repository, logs, documentation or web research and pass it in context. Gemini has no tools of its own.

Use compare when there are 2+ genuinely credible alternatives. Use challenge for non-trivial plans, important architecture decisions, multi-file changes, security/auth/state/concurrency risk, uncertain assumptions, repeated failures, or before finalizing a substantial change.

Evaluate Gemini's objections yourself. Do not automatically implement its suggestions. If a material redesign occurs and requires_rechallenge=true, perform at most one additional challenge. Do not create an endless review loop. Never delegate implementation to Gemini.
```

## Checks

```bash
npm install
npm test
npm run check
npm run build
```

Node.js 20+ is required.

The repository currently does not commit a generated `package-lock.json`, so CI intentionally continues to use `npm install`. Do not hand-write a lockfile; switch CI to `npm ci` only after a real npm-generated lockfile is committed.

## Third-party attribution

Pool/OAuth interoperability ideas are adapted from **9router** and **OmniRoute**, both MIT-licensed. See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

## Risk note

This is an unofficial bridge around Antigravity/Cloud Code behavior used by community integrations. It depends on private/internal Google endpoints and model identifiers that can change without notice. The current 9router registry itself labels the Antigravity provider deprecated/risk-noticed. Use accounts you control, respect provider terms and quotas, and keep credentials server-side.
