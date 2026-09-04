# Antigravity Live 404 Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the newly-added Antigravity account return real Gemini 3.8 Flash High text through the production MCP endpoint instead of upstream HTTP 404.

**Architecture:** Keep the existing OAuth/account pool and MCP surface. Correct only the Antigravity wire request to match the current 9router protocol: public model ID in the body, High thinking in `thinkingConfig`, and Antigravity-style session/request IDs. If the production smoke test still fails, add project rediscovery/onboarding only as the next isolated fix.

**Tech Stack:** Next.js 16, Node.js 22, node:test, Vercel, Upstash Redis, Google Antigravity internal Cloud Code endpoints.

**Spec:** Current production failure captured by live smoke PR #3 and current 9router Antigravity executor/model mapping.

## Global Constraints

- Public model remains hard-locked to `gemini-3.8-flash-high`.
- Gemini remains critique-only and text-only; no tools are sent upstream.
- Existing account OAuth/pool behavior must remain compatible.
- No user refresh/access tokens may be logged or committed.
- A production live MCP call is the final acceptance test.

---

### Task 1: Correct Gemini 3.8 High wire envelope

**Files:**
- Modify: `tests/antigravity.test.js`
- Modify: `src/antigravity/client.js`

**Interfaces:**
- Consumes: `buildGenerateEnvelope({ projectId, systemPrompt, userPrompt })`
- Produces: an Antigravity request body with `model === "gemini-3.8-flash-high"`, `thinkingConfig.thinkingLevel === "high"`, UUID session id, and `agent/<uuid>/<timestamp>/<uuid>/1` request id.

- [ ] **Step 1: Write the failing test**

Change the envelope test so it requires the literal public model ID on the wire, High thinking config, a UUID `sessionId`, and Antigravity request-id shape. The current implementation must fail because it sends `gemini-3.8-flash-high(high)` and has no session id.

- [ ] **Step 2: Run test to verify RED**

Run: `npm test`
Expected: the updated envelope test fails on model/thinking/session metadata while unrelated tests pass.

- [ ] **Step 3: Implement the minimal protocol correction**

Keep `UPSTREAM_LOCKED_MODEL` as the internal preset description, but send `LOCKED_MODEL` in the actual body. Add `generationConfig.thinkingConfig = { thinkingLevel: "high", includeThoughts: true }`. Generate one session UUID per envelope and an Antigravity-compatible request id using UUIDs and the current timestamp.

- [ ] **Step 4: Run full verification**

Run: `npm test && npm run check && npm run build`
Expected: all commands succeed.

### Task 2: Review, deploy, and live-test production

**Files:**
- No production source changes unless Task 1 live verification fails.

**Interfaces:**
- Consumes: production `/api/mcp` `challenge` tool.
- Produces: actual non-error Gemini critic text.

- [ ] **Step 1: Review PR diff against current 9router**

Confirm body model has no thinking suffix, High thinking config is present, endpoint remains `/v1internal:streamGenerateContent?alt=sse`, and no account secrets are exposed.

- [ ] **Step 2: Merge only after green CI and Vercel Preview**

Deploy the merge commit through the existing Vercel Git integration.

- [ ] **Step 3: Run live production MCP smoke test**

Send a real `challenge` request to `https://gemini-osaprivat.vercel.app/api/mcp` and require non-error text from Gemini.

- [ ] **Step 4: Continue if live smoke fails**

If the failure is still upstream 404, inspect/revalidate the account project using current `loadCodeAssist` + `onboardUser` behavior and implement project rediscovery/onboarding as a separate RED→GREEN patch. If the error changes, diagnose that exact new layer rather than guessing.
