import test from "node:test";
import assert from "node:assert/strict";

const BASE_URL = "https://gemini-osaprivat.vercel.app";

function parseMcpSse(raw) {
  for (const line of String(raw).split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const value = line.slice(5).trim();
    if (!value || value === "[DONE]") continue;
    try {
      return JSON.parse(value);
    } catch {
      // Keep looking for a valid MCP event.
    }
  }
  return null;
}

test("production Gemini Critic reviews the real MCP architecture", async () => {
  const response = await fetch(`${BASE_URL}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "mcp-architecture-review",
      method: "tools/call",
      params: {
        name: "challenge",
        arguments: {
          task: "Evaluate whether the current Gemini Critic MCP architecture is sound for its intended role as a reliable independent second-opinion tool for ChatGPT/Codex. Identify what is already good, what is materially weak, and what should be changed before treating it as production-grade. Prioritize architecture, reliability, security, operability, and simplicity.",
          proposal: "Keep the current architecture: a Next.js/Vercel remote HTTP MCP endpoint built with mcp-handler; expose only challenge and compare tools with Zod schemas; route both through a small critic service that builds a strict reviewer system prompt and calls Gemini; lock the model to gemini-3.8-flash-high with thinkingLevel=high and temperature=0.2; strip thought parts and parse only final structured JSON. Use an Upstash Redis-backed Google/Antigravity account pool with encrypted refresh tokens, round-robin/sticky selection, per-model cooldowns, quota reset handling, OAuth refresh, project discovery, endpoint failover, and a 45-second request budget. Keep token/project caches in memory per Vercel instance. Protect /api/mcp with Bearer auth only when MCP_SHARED_SECRET is configured; otherwise allow unauthenticated access. Depend on unofficial Antigravity/Cloud Code internal endpoints. Keep the MCP synchronous: each challenge/compare waits for Gemini and returns the result in the same request.",
          context: "Current implementation details: /api/mcp has maxDuration=60 and accepts GET/POST. challenge inputs: task up to 30k chars, proposal/context up to 60k; compare accepts 2-6 options. Errors become MCP isError text. Critic execution is intentionally read-only/no-tools. Account refresh tokens are encrypted at rest. Upstream handling includes 401/403 login invalidation, 429 quota cooldown/reset parsing, transient 5xx cooldown, endpoint failover, project repair on some 404s, total request deadline guards, and SSE parsing that discards Gemini thought parts. There is currently no explicit MCP-level rate limiter or per-caller quota visible in the route. The goal is a personal/small-team critic MCP, not a public high-scale SaaS. Give a concrete verdict: accept/revise/reject and list only decision-relevant changes. If the current design is good enough for personal use but not public production, say so explicitly.",
          focus: "architecture"
        }
      }
    }),
    signal: AbortSignal.timeout(55_000)
  });

  const raw = await response.text();
  console.log(`ARCH_HTTP_STATUS=${response.status}`);
  assert.equal(response.status, 200);

  const event = parseMcpSse(raw);
  assert.ok(event?.result, "expected a JSON-RPC result event");
  assert.notEqual(event.result.isError, true, "MCP tool returned an error");

  const text = event.result.content?.find((item) => item?.type === "text")?.text;
  assert.ok(text, "expected non-empty Gemini critic text");
  const critic = JSON.parse(text);
  console.log(`ARCH_CRITIC=${JSON.stringify(critic)}`);
  assert.match(String(critic.verdict), /^(accept|revise|reject)$/);
  assert.equal(typeof critic.summary, "string");
  assert.ok(Array.isArray(critic.objections));
  assert.ok(Array.isArray(critic.missing_considerations));
  assert.ok(Array.isArray(critic.alternatives));
  assert.equal(typeof critic.confidence, "number");
});
