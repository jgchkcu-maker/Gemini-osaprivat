import test from "node:test";
import assert from "node:assert/strict";

const BASE_URL = "https://gemini-osaprivat.vercel.app";

function parseSseResult(raw) {
  for (const line of String(raw || "").split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const value = line.slice(5).trim();
    if (!value || value === "[DONE]") continue;
    const event = JSON.parse(value);
    if (event?.result) return event.result;
    if (event?.error) throw new Error(`MCP JSON-RPC error: ${JSON.stringify(event.error)}`);
  }
  return null;
}

test("live production returns real Gemini critic text", async () => {
  const response = await fetch(`${BASE_URL}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "live-final-acceptance",
      method: "tools/call",
      params: {
        name: "challenge",
        arguments: {
          task: "Final production connectivity acceptance test",
          proposal: "Return a concise critique proving the configured Antigravity account can answer.",
          context: "This is the final end-to-end acceptance test for the production Gemini critic path.",
          focus: "general"
        }
      }
    }),
    signal: AbortSignal.timeout(55_000)
  });

  const raw = await response.text();
  console.log(`LIVE_HTTP_STATUS=${response.status}`);
  console.log(`LIVE_RAW=${raw.slice(0, 5000)}`);
  assert.equal(response.status, 200);

  const result = parseSseResult(raw);
  assert.ok(result, "MCP response must contain a JSON-RPC result event");
  assert.notEqual(result.isError, true, `Gemini tool returned an error: ${JSON.stringify(result)}`);

  const text = (result.content || [])
    .filter((item) => item?.type === "text")
    .map((item) => item.text || "")
    .join("\n")
    .trim();

  console.log(`LIVE_TEXT=${text.slice(0, 1800)}`);
  assert.ok(text.length > 0, "Gemini critic must return non-empty text");
  assert.doesNotMatch(text, /^Gemini critic failed:/, "production must not return an upstream failure wrapper");
});
