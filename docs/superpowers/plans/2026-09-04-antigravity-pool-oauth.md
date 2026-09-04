# Antigravity Pool + OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simple account-array rotation with a Vercel-safe Antigravity account pool modeled on the proven 9router/OmniRoute behavior, while keeping Gemini locked to `gemini-3.8-flash-high` and critic-only.

**Architecture:** Keep the existing Next.js/MCP surface. Use provider-native Antigravity OAuth (PKCE + state + localhost/manual callback) as the default, with custom Google Web OAuth optional. Store accounts as independent encrypted Redis records, serialize selection with a short Redis lock, lease the chosen account for each request, and apply per-model cooldowns with exact upstream retry/reset hints when available. Reuse design ideas from 9router/OmniRoute under MIT; do not import their routing engines.

**Tech Stack:** Next.js 16, Node 20+, Upstash Redis REST, mcp-handler, native crypto/fetch.

**Spec:** Existing project design + user request in chat.

## Global Constraints

- Model is hard-locked to `gemini-3.8-flash-high`.
- Gemini receives no tools, shell, filesystem, git, browser, deploy, or execution capabilities.
- Refresh tokens remain AES-256-GCM encrypted at rest.
- Existing dashboard and MCP endpoints remain compatible.
- Provider-native OAuth remains available without requiring a custom Google Cloud OAuth client.
- Failover is for availability across user-authorized accounts; do not implement behavior whose purpose is quota evasion.

---

### Task 1: Pool decision state machine

**Files:**
- Modify: `tests/pool.test.js`
- Modify: `src/accounts/pool.js`

**Interfaces:**
- Produces `chooseStickyAccount(accounts, state, options)` and enhanced `markAccountFailure(account, failure, now)`.

- [ ] Write failing tests for sticky round-robin, excluded account IDs, per-model locks, exact reset timestamps, `Retry-After`, transient 5xx cooldowns, and 401/403 `needs_login`.
- [ ] Run `npm test -- tests/pool.test.js` and confirm RED.
- [ ] Implement minimal pure decision logic.
- [ ] Run pool tests and confirm GREEN.

### Task 2: Redis primitives and account records

**Files:**
- Modify: `src/accounts/redis.js`
- Modify: `src/accounts/store.js`
- Modify: `tests/accounts-core.test.js`

**Interfaces:**
- Produces short distributed locks, compare-and-delete unlock, per-account keys, account index, rotation state, request leases, migration from the existing v1 JSON array.

- [ ] Add failing tests for key naming, record normalization, migration behavior helpers, and lease/lock command construction.
- [ ] Run tests and confirm RED.
- [ ] Implement Redis helpers and per-account storage.
- [ ] Preserve read compatibility with existing v1 data and migrate it on first write/read.
- [ ] Run tests and confirm GREEN.

### Task 3: Provider-native OAuth parity

**Files:**
- Modify: `src/accounts/oauth.js`
- Modify: `app/dashboard-client.js`
- Modify: `tests/accounts-core.test.js`

**Interfaces:**
- Provider-native Antigravity OAuth uses PKCE/state, `http://localhost:51121/oauth-callback`, offline access, consent, and discovers `projectId` via `loadCodeAssist`.
- Optional custom Web OAuth remains separate and opt-in.

- [ ] Add failing tests for provider-native scopes/redirect/auth URL and callback state validation.
- [ ] Run tests and confirm RED.
- [ ] Align native flow with 9router/OmniRoute semantics and reduce custom scopes to the minimum proven set where compatible.
- [ ] Make dashboard label native flow as recommended and Web OAuth as optional seamless mode.
- [ ] Run tests and confirm GREEN.

### Task 4: Request failover + deadlines

**Files:**
- Modify: `src/antigravity/client.js`
- Modify: `app/api/mcp/route.js`
- Add/modify tests around Antigravity request decisions.

**Interfaces:**
- Each request excludes already-tried accounts, acquires/releases a lease, records per-model failure state, honors exact reset/retry hints, and stops retrying when request deadline is too close.

- [ ] Add failing tests for retry-hint parsing, exclusion, lease release, and deadline decisions.
- [ ] Run tests and confirm RED.
- [ ] Implement failover loop with ~45s upstream budget inside Vercel 60s max duration.
- [ ] Require MCP bearer auth when `MCP_SHARED_SECRET` is configured and surface a dashboard warning when it is not.
- [ ] Run tests and confirm GREEN.

### Task 5: Attribution, docs, verification

**Files:**
- Add: `THIRD_PARTY_NOTICES.md`
- Modify: `README.md`

- [ ] Document architecture and OAuth modes.
- [ ] Attribute OmniRoute and 9router MIT-derived ideas/code where applicable.
- [ ] Run `npm test`.
- [ ] Run `npm run check`.
- [ ] Run `npm run build` via GitHub Actions.
- [ ] Verify Vercel deployment status for the final commit.
