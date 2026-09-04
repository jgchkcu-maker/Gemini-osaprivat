import test from "node:test";
import assert from "node:assert/strict";

const ENDPOINT = "https://gemini-osaprivat.vercel.app/api/mcp";

function parseMcpResponse(raw) {
  const direct = String(raw || "").trim();
  if (!direct) return null;
  try {
    return JSON.parse(direct);
  } catch {
    const messages = [];
    for (const line of direct.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const value = line.slice(5).trim();
      if (!value || value === "[DONE]") continue;
      try { messages.push(JSON.parse(value)); } catch {}
    }
    return messages.find((message) => message?.id === "live-smoke-1") || messages.at(-1) || null;
  }
}

test("live production MCP can reach the newly added Antigravity account", { timeout: 60_000 }, async () => {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "live-smoke-1",
      method: "tools/call",
      params: {
        name: "challenge",
        arguments: {
          task: "Production connectivity smoke test",
          proposal: "The Gemini Critic account pool is reachable and can return a short critique.",
          context: "Reply briefly. This request only verifies that the configured Antigravity account can execute the locked Gemini model.",
          focus: "logic"
        }
      }
    }),
    signal: AbortSignal.timeout(55_000)
  });

  const raw = await response.text();
  console.log(`LIVE_HTTP_STATUS=${response.status}`);
  console.log(`LIVE_RAW=${raw.slice(0, 12000)}`);

  assert.equal(response.status, 200, `live MCP returned HTTP ${response.status}: ${raw.slice(0, 2000)}`);
  const payload = parseMcpResponse(raw);
  assert.ok(payload, "live MCP returned no parseable JSON-RPC payload");
  assert.equal(payload.error, undefined, `MCP protocol error: ${JSON.stringify(payload.error)}`);
  assert.ok(payload.result, `MCP response has no result: ${JSON.stringify(payload)}`);
  assert.notEqual(payload.result.isError, true, `Gemini tool returned an error: ${JSON.stringify(payload.result)}`);
  const text = payload.result?.content?.find?.((part) => part?.type === "text")?.text;
  assert.ok(text && text.trim(), `Gemini tool returned no text: ${JSON.stringify(payload.result)}`);
  assert.doesNotMatch(text, /Gemini critic failed:/i, text);
  console.log(`LIVE_GEMINI_RESPONSE=${text.slice(0, 8000)}`);
});
