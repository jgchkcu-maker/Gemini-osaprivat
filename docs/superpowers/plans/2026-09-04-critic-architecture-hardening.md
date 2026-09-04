# Gemini Critic Architecture Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Gemini Critic return strict structured MCP results, decouple critic logic from Antigravity transport, bound MCP abuse with optional Redis rate limiting, and expose safe diagnostics without changing the critic/executor responsibility split.

**Architecture:** Keep `challenge` and `compare` as stateless MCP primitives. Centralize input/output schemas in `src/critic/schemas.js`, validate model output before returning it, inject a tiny provider contract into the critic service, and keep transport/account-pool behavior behind the Antigravity provider. Add MCP-specific security/rate-limit helpers and enrich health diagnostics.

**Tech Stack:** Node.js 20+, Next.js 16, `mcp-handler` 2.x, Zod 4.x, Node test runner, Upstash Redis REST.

**Spec:** `docs/superpowers/specs/2026-09-04-critic-architecture-hardening-design.md`

## Global Constraints

- Keep ChatGPT as planner, final decision-maker, and executor.
- Gemini remains review-only with no filesystem, GitHub, shell, browser, deploy, or MCP tools.
- Keep only `challenge` and `compare` as public critic tools.
- Do not redesign Antigravity account-pool/OAuth behavior.
- Do not add automatic review loops, queues, workers, or microservices.
- Preserve existing challenge/compare input compatibility.
- Preserve existing encrypted account records.
- `npm test`, `npm run check`, and `npm run build` must all pass before completion.

---

### Task 1: Strict critic contracts and parsing

**Files:**
- Create: `src/critic/schemas.js`
- Modify: `src/critic/parser.js`
- Modify: `src/critic/prompts.js`
- Test: `tests/critic-schema.test.js`
- Test: `tests/critic.test.js`

**Interfaces:**
- Produces `challengeInputSchema`, `compareInputSchema`, `challengeOutputSchema`, `compareOutputSchema`.
- Produces `parseChallengeResult(text)` and `parseCompareResult(text)` returning schema-valid values.
- Preserves `parseCriticJson(text)` as a compatibility extraction helper for existing callers/tests while new service code uses strict parsers.

- [ ] **Step 1: Write failing contract tests**

Create tests that import the new schemas/parsers and assert:

```js
assert.equal(challengeOutputSchema.safeParse({
  verdict: "banana",
  summary: "x",
  objections: [],
  missing_considerations: [],
  alternatives: [],
  confidence: 0.5,
  requires_rechallenge: false
}).success, false);
```

```js
assert.equal(challengeOutputSchema.safeParse({
  verdict: "revise",
  summary: "x",
  objections: [{
    severity: "high",
    issue: "race",
    reason: "state can diverge",
    decision_impact: "blocks"
  }],
  missing_considerations: [],
  alternatives: [],
  confidence: 0.8,
  requires_rechallenge: true
}).success, true);
```

Also assert confidence `>1` fails, invalid impact fails, compare result validates, fenced JSON parses, and malformed JSON returns a schema-valid low-confidence degraded result.

- [ ] **Step 2: Verify RED in PR CI**

Expected failure: module `src/critic/schemas.js` or strict parser exports do not exist.

- [ ] **Step 3: Implement centralized schemas**

Use Zod enums and objects. `decision_impact` is exactly `blocks | changes_design | minor`; confidence is `z.number().min(0).max(1)`; `requires_rechallenge` is boolean. Keep existing input length limits exactly as the current MCP route.

- [ ] **Step 4: Implement strict parsing**

`parseChallengeResult` and `parseCompareResult` extract JSON, validate with `safeParse`, and otherwise return dedicated schema-valid degraded fallbacks. Do not retry Gemini from the parser.

- [ ] **Step 5: Update prompt response shapes**

Add `decision_impact` and `requires_rechallenge` to the challenge prompt contract and explain that only material redesigns justify re-challenge. Preserve trust-boundary and anti-nitpicking language.

- [ ] **Step 6: Verify GREEN**

Run `npm test`; all critic tests must pass.

---

### Task 2: Provider boundary and service validation

**Files:**
- Create: `src/critic/provider.js`
- Modify: `src/critic/service.js`
- Test: `tests/critic-provider.test.js`

**Interfaces:**
- `getCriticProvider()` returns the default object `{ name: "antigravity", generate }`.
- `challenge(input, options?)` and `compare(input, options?)` accept `{ provider }`; provider must expose `generate({ systemPrompt, userPrompt })`.

- [ ] **Step 1: Write failing provider tests**

Use a fake provider:

```js
const provider = {
  name: "fake",
  async generate() {
    return JSON.stringify({
      verdict: "accept",
      summary: "sound",
      objections: [],
      missing_considerations: [],
      alternatives: [],
      confidence: 0.9,
      requires_rechallenge: false
    });
  }
};
const result = await challenge({ task: "t", proposal: "p" }, { provider });
assert.equal(result.verdict, "accept");
```

Add a malformed-output case proving service returns the strict degraded result.

- [ ] **Step 2: Verify RED in CI**

Expected failure: provider injection is unsupported.

- [ ] **Step 3: Implement provider wrapper**

Wrap existing `generateCriticText` without moving Antigravity logic.

- [ ] **Step 4: Update service**

Use the injected/default provider and strict challenge/compare parsers. Keep transport exceptions as exceptions; only malformed model content degrades to a safe result.

- [ ] **Step 5: Verify GREEN**

Run the provider/critic test suite.

---

### Task 3: Structured MCP output and shared tool schemas

**Files:**
- Modify: `app/api/mcp/route.js`
- Test: `tests/mcp-contract.test.js`

**Interfaces:**
- Tool inputs use schemas imported from `src/critic/schemas.js`.
- Successful tool result is `{ content: [{type:"text", text}], structuredContent: value }`.
- Tool registration declares the relevant output schema when supported by the installed MCP server API.

- [ ] **Step 1: Write failing source-level MCP contract tests**

Assert the route imports shared schemas and that the result helper includes `structuredContent`. The build remains the compatibility test for `outputSchema` registration.

- [ ] **Step 2: Verify RED**

Expected failure: route still defines its own input schemas and returns text only.

- [ ] **Step 3: Update MCP route**

Remove duplicated Zod input definitions. Register `challenge`/`compare` with shared input/output schemas and return validated structured data plus JSON text fallback.

- [ ] **Step 4: Verify GREEN**

Run tests and `npm run build`; if `outputSchema` is not accepted by the installed handler API, keep `structuredContent` and omit only the unsupported registration property.

---

### Task 4: MCP bearer helper and Redis rate limiter

**Files:**
- Create: `src/mcp/security.js`
- Create: `src/mcp/rate-limit.js`
- Modify: `app/api/mcp/route.js`
- Test: `tests/mcp-security.test.js`
- Test: `tests/mcp-rate-limit.test.js`

**Interfaces:**
- `getMcpAuthMode(env)` returns `public | bearer`.
- `isAuthorizedBearer(authorization, secret)` performs constant-time comparison for configured secrets.
- `getRateLimitConfig(env)` returns public/authenticated per-minute limits with defaults `10/60`.
- `checkMcpRateLimit(request, { authenticated, env, redisCommandFn })` returns `{ allowed, limit, remaining, retryAfterSeconds, degraded }`.

- [ ] **Step 1: Write failing security tests**

Assert exact Bearer acceptance/rejection and auth-mode detection.

- [ ] **Step 2: Write failing rate-limit tests**

Use an injected fake `redisCommandFn` and assert:
- expected EVAL command shape;
- threshold allows counts `<= limit` and rejects `> limit`;
- public/authenticated limits differ;
- Redis errors produce `allowed: true, degraded: true`.

- [ ] **Step 3: Verify RED**

Expected failure: helper modules do not exist.

- [ ] **Step 4: Implement security helper**

Use `crypto.timingSafeEqual` on equal-length Buffers after length check.

- [ ] **Step 5: Implement fixed-window limiter**

Hash client IP before composing the Redis key. Use one Lua `EVAL` to `INCR`, set 60-second expiry on first increment, and return count/TTL. Skip Redis when not configured. Parse env values as positive bounded integers.

- [ ] **Step 6: Wire into route**

Authenticate first. Then apply rate limiting and return `429` JSON with `Retry-After` when exceeded. Limiter failures are fail-open.

- [ ] **Step 7: Verify GREEN**

Run security/rate-limit tests plus build.

---

### Task 5: Health diagnostics and encryption warning

**Files:**
- Modify: `src/accounts/crypto.js`
- Create: `src/mcp/metadata.js`
- Modify: `app/api/health/route.js`
- Test: `tests/health-metadata.test.js`

**Interfaces:**
- `getEncryptionConfigurationStatus(env)` returns only `{ configured, source }`, where source is `dedicated | redis-token | unconfigured`.
- `getMcpMetadata(env)` returns safe version/tool/auth/rate-limit metadata with no secret values.

- [ ] **Step 1: Write failing diagnostics tests**

Assert dedicated key, Redis fallback, and unconfigured states. Assert MCP metadata lists exactly `challenge` and `compare`, reports auth mode and limits, and never returns secret text.

- [ ] **Step 2: Verify RED**

Expected failure: metadata helpers do not exist.

- [ ] **Step 3: Implement metadata helpers**

Use constants for service version/protocol/tool list. Reuse security/rate-limit config helpers rather than duplicating logic.

- [ ] **Step 4: Enrich health route**

Preserve existing `getConfigurationStatus()` fields and append nested `mcp` and `encryption` objects.

- [ ] **Step 5: Verify GREEN**

Run tests and build.

---

### Task 6: Documentation, scripts, and final regression gate

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml` only if a real npm-generated lockfile is available; otherwise leave installation command unchanged.

**Interfaces:**
- README documents evidence-first context, `compare -> challenge`, maximum one material re-challenge, new structured fields, rate-limit env vars, diagnostics, and dedicated encryption-key recommendation.

- [ ] **Step 1: Update environment documentation**

Add `MCP_RATE_LIMIT_PUBLIC_PER_MINUTE` and `MCP_RATE_LIMIT_AUTHENTICATED_PER_MINUTE`; clarify that Redis enables distributed rate limiting and a dedicated encryption key is recommended.

- [ ] **Step 2: Update ChatGPT orchestration instructions**

Document that the primary agent gathers evidence, calls critic selectively, independently evaluates objections, and performs at most one re-challenge after material redesign.

- [ ] **Step 3: Extend syntax checks**

Add all new source files to `npm run check`.

- [ ] **Step 4: Full regression verification**

Run in GitHub Actions:

```text
npm test
npm run check
npm run build
```

Expected: all pass with no test failures or build errors.

- [ ] **Step 5: Review PR diff**

Confirm no unrelated account-pool/OAuth/Antigravity refactor, no secrets, no hidden tool capabilities for Gemini, and no automatic server-side review loop.
