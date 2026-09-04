# Gemini Critic Architecture Hardening Design

## Goal

Keep ChatGPT as the primary planner, judge, and executor while making Gemini Critic a reliable independent second-opinion reviewer that is safe to call from ChatGPT Web through remote MCP.

## Non-goals

- Do not give Gemini filesystem, GitHub, shell, browser, deployment, or other execution capabilities.
- Do not turn Gemini into an orchestrator or final decision-maker.
- Do not add many specialized MCP tools; keep `challenge` and `compare` as the public primitives.
- Do not redesign the existing Antigravity account-pool/OAuth transport in this iteration.
- Do not introduce queues, workers, or microservices.

## Current flow

`ChatGPT -> /api/mcp -> critic/service -> antigravity/client -> account pool -> Redis -> Gemini 3.8 Flash High`

The MCP layer is already thin and the Antigravity transport has recently been stabilized. The main weaknesses are the output contract, direct coupling between critic service and Antigravity, public-endpoint abuse risk, and weak diagnostics for ChatGPT MCP integration.

## Target flow

`ChatGPT -> MCP challenge/compare -> Critic Service -> Critic Provider -> Antigravity Provider -> Gemini -> strict Zod validation -> MCP structuredContent -> ChatGPT evaluates -> ChatGPT executes`

The provider boundary is intentionally minimal. The critic service depends on a `generate({ systemPrompt, userPrompt })` contract instead of importing Antigravity transport details directly.

## Reviewer orchestration policy

Orchestration remains with the primary agent, not the server. The recommended calling policy is:

- Call `challenge` for non-trivial plans, architecture changes, multi-file changes, security/auth/state/concurrency risks, uncertain assumptions, repeated failures, or before finalizing a substantial decision.
- Call `compare` when two or more credible approaches exist before selecting the proposal to challenge.
- Do not call Gemini for trivial deterministic edits.
- ChatGPT must collect the smallest relevant evidence from files, logs, docs, or web sources and pass it in `context`; Gemini does not receive direct tools.
- ChatGPT must independently evaluate objections instead of automatically accepting them.
- At most one re-challenge is recommended after a material redesign. There is no automatic server-side review loop.

## Contracts

### Challenge input

Fields remain compatible with the existing public tool:

- `task: string` (1..30000)
- `proposal: string` (1..60000)
- `context?: string` (<=60000)
- `focus: general | logic | architecture | code | ux | simplicity | failure_modes`

### Challenge output

The validated result is:

```json
{
  "verdict": "accept | revise | reject",
  "summary": "string",
  "objections": [
    {
      "severity": "low | medium | high",
      "issue": "string",
      "reason": "string",
      "decision_impact": "blocks | changes_design | minor",
      "suggestion": "string?"
    }
  ],
  "missing_considerations": ["string"],
  "alternatives": [
    {
      "option": "string",
      "when_better": "string",
      "tradeoffs": "string"
    }
  ],
  "confidence": 0.0,
  "requires_rechallenge": false
}
```

`requires_rechallenge` is true only when addressing a material objection is likely to change the design enough that a second review has useful decision value. Minor changes must not trigger it.

`decision_impact` means:

- `blocks`: the proposal should not be executed as written.
- `changes_design`: the core approach can survive, but a meaningful redesign is needed.
- `minor`: a useful local improvement that does not change the main decision.

### Compare output

The existing compare contract remains, but becomes strictly validated:

```json
{
  "preferred_option": "exact option text or null",
  "ranking": [{ "option": "string", "score": 0, "reason": "string" }],
  "weaknesses": [{ "option": "string", "issues": ["string"] }],
  "decision_rule": "string",
  "confidence": 0.0
}
```

Scores are finite numbers. Confidence is constrained to `0..1`.

## Parsing and degraded behavior

Gemini output is treated as untrusted data.

1. Strip a single markdown JSON fence if present.
2. Try direct JSON parse.
3. If necessary, try the first complete-looking object span.
4. Validate against the relevant Zod output schema.
5. If parsing or validation fails, return a safe schema-valid degraded result with low confidence instead of returning arbitrary malformed data.

Malformed output does not automatically spend another Gemini request.

## MCP result shape

Each tool returns both:

- `structuredContent`: the validated object for MCP-aware clients.
- `content`: a JSON text representation as a compatibility fallback.

Tool registration uses `outputSchema` if the installed `mcp-handler`/MCP server API accepts it in the current build. The build is the source of truth; no unsupported signature is kept.

## Provider boundary

Add `src/critic/provider.js` with a tiny default provider wrapping `generateCriticText` from the existing Antigravity client. `challenge` and `compare` accept an injectable provider dependency for tests.

No provider registry, factory hierarchy, model selection UI, or automatic fallback provider is added now.

## MCP security and rate limiting

Existing optional bearer authentication remains compatible so ChatGPT connectivity is not destabilized during this iteration.

Bearer comparison is constant-time when a shared secret is configured.

Rate limiting uses Redis when available and is fail-open if Redis itself fails so the critic is not made unavailable by an observability/protection dependency. Defaults:

- public endpoint: 10 requests/minute per client identity
- bearer-protected endpoint: 60 requests/minute per client identity

Both values are configurable with environment variables. Client identity is derived from forwarded IP headers and hashed before use in Redis keys. The limiter returns `429` with a retry hint when exceeded.

If Redis is not configured, health diagnostics must clearly report that rate limiting is inactive.

## Health and diagnostics

`/api/health` adds safe MCP metadata without secrets:

- service version
- transport/protocol label
- registered tools (`challenge`, `compare`)
- structured-output validation enabled
- auth mode (`public` or `bearer`)
- rate-limit configured/enabled and configured limits
- account-encryption seed source (`dedicated`, `redis-token`, or `unconfigured`)

This makes it possible to distinguish a server registration/configuration problem from a ChatGPT custom-app tool-import problem.

## Encryption compatibility

Existing encrypted account records must remain readable. `ACCOUNT_ENCRYPTION_KEY` stays optional for backward compatibility. Health and README warn when Redis credentials are also the encryption seed and recommend a dedicated key for production.

## Tests

Use Node test runner and TDD. Add coverage for:

- strict challenge validation, including invalid verdict/confidence/impact
- strict compare validation
- fenced and embedded JSON extraction
- schema-valid degraded results for malformed output
- prompt contract fields and prompt-injection boundaries
- provider injection and provider failure behavior
- MCP structured result shape
- constant-time bearer helper semantics
- rate-limit configuration, Redis command shape, threshold behavior, fail-open behavior
- health security/diagnostic metadata

Existing Antigravity/OAuth/pool tests must continue to pass.

## CI and dependency reproducibility

The repository currently has no `package-lock.json`. This iteration does not hand-write a lockfile. CI keeps `npm install` until a lockfile can be generated by npm in an environment with registry access; once committed, CI should switch to `npm ci` in a separate reproducibility change.

`npm test`, `npm run check`, and `npm run build` remain required gates.

## Success criteria

- ChatGPT receives schema-valid structured critic results.
- Malformed Gemini output cannot create arbitrary tool-contract values.
- Critic service no longer directly depends on Antigravity implementation details.
- Public MCP abuse is bounded when Redis is configured.
- Health reveals enough safe metadata to diagnose MCP registration/configuration.
- Existing account-pool/OAuth/Antigravity behavior is unchanged except for the new provider call boundary.
- Full CI passes before merge.