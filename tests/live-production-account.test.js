import test from "node:test";
import assert from "node:assert/strict";

const BASE_URL = "https://gemini-osaprivat.vercel.app";

function parseSseResult(raw) {
  for (const line of String(raw || "").split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const event = JSON.parse(payload);
      if (event?.result) return event.result;
      if (event?.error) throw new Error(`MCP JSON-RPC error: ${JSON.stringify(event.error)}`);
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
  return null;
}

test("live production MCP returns real Gemini critic text after project binding repair", async () => {
  const response = await fetch(`${BASE_URL}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "live-smoke-after-project-binding",
      method: "tools/call",
      params: {
        name: "challenge",
        arguments: {
          task: "Production connectivity smoke test",
          proposal: "Return a concise critique proving the configured Antigravity account can answer.",
          context: "This request only checks that production can reach the locked Gemini critic model.",
          focus: "general"
        }
      }
    }),
    signal: AbortSignal.timeout(55_000)
  });

  const raw = await response.text();
  console.log(`LIVE_HTTP_STATUS=${response.status}`);
  console.log(`LIVE_RAW=${raw.slice(0, 4000)}`);
  assert.equal(response.status, 200);

  const result = parseSseResult(raw);
  assert.ok(result, "MCP response must contain a JSON-RPC result event");
  assert.notEqual(result.isError, true, `Gemini tool returned an error: ${JSON.stringify(result)}`);

  const text = (result.content || [])
    .filter((item) => item?.type === "text")
    .map((item) => item.text || "")
    .join("\n")
    .trim();

  console.log(`LIVE_TEXT=${text.slice(0, 1600)}`);
  assert.ok(text.length > 0, "Gemini critic must return non-empty text");
  assert.ok(!text.startsWith("Gemini critic failed:"), "Gemini critic must not return an upstream failure wrapper");
});
