# Gemini Critic MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Vercel-hosted remote MCP that lets ChatGPT ask Gemini 3.8 Flash High to criticize or compare proposals without giving Gemini any execution capability.

**Architecture:** Next.js exposes a stateless `/api/mcp` route via `mcp-handler`. Pure prompt/parser modules isolate critic behavior, while a small Antigravity client exchanges credentials, discovers the project, sends text-only Gemini requests, and strips thought parts from SSE responses.

**Tech Stack:** Node.js 20+, Next.js 16, mcp-handler 2, MCP SDK 2, Zod 4, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-04-gemini-critic-mcp-design.md`

## Global Constraints
- Default model is exactly `gemini-3.8-flash-high`.
- Gemini must receive no tools or action capabilities.
- Secrets live only in environment variables.
- MCP transport is stateless Streamable HTTP.
- Only final Gemini text may be returned; thought parts are discarded.

---

### Task 1: Critic contract
**Files:** `tests/critic.test.js`, `src/critic/prompts.js`, `src/critic/parser.js`
- [x] Write failing prompt/parser tests.
- [x] Verify failure because modules do not exist.
- [x] Implement minimal prompts and parser.
- [x] Run `npm test` and verify green.

### Task 2: Antigravity transport
**Files:** `tests/antigravity.test.js`, `src/antigravity/client.js`
- [x] Write failing request/SSE tests.
- [x] Verify failure because module does not exist.
- [x] Implement text-only envelope, token handling, project discovery, endpoint fallback, and SSE final-text parsing.
- [x] Run `npm test` and verify green.

### Task 3: MCP tools and deployment surface
**Files:** `src/critic/service.js`, `app/api/mcp/route.js`, `app/api/health/route.js`, `.env.example`, `README.md`
- [x] Wire `challenge` and `compare` to the critic service.
- [x] Add optional Bearer protection and health endpoint.
- [x] Document Vercel and ChatGPT Web connection steps.
- [ ] Run `npm run check`, `npm test`, and `npm run build` when dependencies are available.
