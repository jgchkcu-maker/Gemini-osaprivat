import test from "node:test";
import assert from "node:assert/strict";

const BASE_URL = "https://gemini-osaprivat.vercel.app";

test("live production exposes safe evidence for the remaining Antigravity 404", async () => {
  const response = await fetch(`${BASE_URL}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "live-404-diagnostic",
      method: "tools/call",
      params: {
        name: "challenge",
        arguments: {
          task: "Production connectivity diagnostic",
          proposal: "Return a concise critique proving the configured Antigravity account can answer.",
          context: "If upstream still returns 404, include only the safe Antigravity diagnostic evidence already attached by production.",
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
  assert.match(raw, /(Antigravity 404 diagnostics:|\"isError\":false)/, "production must either return Gemini text or safe 404 diagnostics");
});
