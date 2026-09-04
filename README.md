# Gemini Critic Control

Remote MCP + web dashboard for **ChatGPT Web → Gemini 3.8 Flash High**. Gemini is an independent critic only; ChatGPT remains planner, judge and executor.

## What is locked down

The public model is hard-coded to `gemini-3.8-flash-high`, currently mapped to the Antigravity upstream id `gemini-3.8-flash-high(high)`. There is no environment-variable override. Gemini receives text only: no filesystem, shell, git, browser, workspace, deploy access, or MCP tools. Upstream thought parts are discarded before the response is returned to ChatGPT.

MCP tools:

- `challenge` — attack assumptions, edge cases and weak decisions.
- `compare` — rank 2–6 candidate approaches and explain trade-offs.

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

Refresh credentials remain AES-256-GCM encrypted at rest. By default the Redis secret token is used as the encryption seed; `ACCOUNT_ENCRYPTION_KEY` can be supplied to use a separate seed.

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

Optional:

```env
ACCOUNT_ENCRYPTION_KEY=separate-long-random-secret
MCP_SHARED_SECRET=optional-bearer-secret
ANTIGRAVITY_API_ENDPOINT=optional-custom-endpoint
GOOGLE_OAUTH_CLIENT_ID=optional-web-oauth-client
GOOGLE_OAUTH_CLIENT_SECRET=optional-web-oauth-secret
# Optional when the dashboard is opened from Vercel preview deployments.
# GOOGLE_OAUTH_APP_URL=https://YOUR-PRODUCTION-DOMAIN
# Optional full callback override.
# GOOGLE_OAUTH_REDIRECT_URI=https://YOUR-PRODUCTION-DOMAIN/api/accounts/oauth/callback
```

`ADMIN_PASSWORD` protects the dashboard with a Secure/HttpOnly/SameSite cookie. Keep user credentials and private secrets in Vercel Environment Variables; the embedded native OAuth client is public client metadata, not a per-user credential.

If `MCP_SHARED_SECRET` is not set, `/api/mcp` is not bearer-protected. This can be useful while testing ChatGPT MCP connectivity, but the endpoint should be treated as public. Only enable the secret if the MCP client configuration you use can send the bearer token.

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

## Third-party attribution

Pool/OAuth interoperability ideas are adapted from **9router** and **OmniRoute**, both MIT-licensed. See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

## Risk note

This is an unofficial bridge around Antigravity/Cloud Code behavior used by community integrations. It depends on private/internal Google endpoints and model identifiers that can change without notice. The current 9router registry itself labels the Antigravity provider deprecated/risk-noticed. Use accounts you control, respect provider terms and quotas, and keep credentials server-side.
