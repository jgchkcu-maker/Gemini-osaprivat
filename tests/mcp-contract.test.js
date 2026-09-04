import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routeUrl = new URL("../app/api/mcp/route.js", import.meta.url);

async function routeSource() {
  return readFile(routeUrl, "utf8");
}

test("MCP route uses the shared critic input and output schemas", async () => {
  const source = await routeSource();
  assert.match(source, /challengeInputSchema/);
  assert.match(source, /challengeOutputSchema/);
  assert.match(source, /compareInputSchema/);
  assert.match(source, /compareOutputSchema/);
  assert.doesNotMatch(source, /z\.object\(/);
});

test("successful MCP tool results include structuredContent with a text compatibility fallback", async () => {
  const source = await routeSource();
  assert.match(source, /structuredContent:\s*value/);
  assert.match(source, /JSON\.stringify\(value, null, 2\)/);
});

test("MCP tool registration advertises output schemas", async () => {
  const source = await routeSource();
  assert.match(source, /outputSchema:\s*challengeOutputSchema/);
  assert.match(source, /outputSchema:\s*compareOutputSchema/);
});

test("MCP route wires constant-time bearer validation and distributed rate limiting", async () => {
  const source = await routeSource();
  assert.match(source, /isAuthorizedBearer/);
  assert.match(source, /checkMcpRateLimit/);
  assert.match(source, /status:\s*429/);
  assert.match(source, /Retry-After/);
  assert.doesNotMatch(source, /authorization\s*!==\s*`Bearer/);
});
