import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGenerateEnvelope,
  hasRetryBudget,
  LOCKED_MODEL,
  parseCompositeRefreshToken,
  parseSseText,
  parseUpstreamRetryHints,
  UPSTREAM_LOCKED_MODEL
} from "../src/antigravity/client.js";

test("composite refresh tokens are parsed", () => {
  assert.deepEqual(parseCompositeRefreshToken("refresh|project|managed"), {
    refreshToken: "refresh",
    projectId: "project",
    managedProjectId: "managed"
  });
});

test("request is text-only, has no tools, and maps locked High model to current upstream id", () => {
  const envelope = buildGenerateEnvelope({
    projectId: "p",
    model: "some-other-model",
    systemPrompt: "critic only",
    userPrompt: "challenge this"
  });
  assert.equal(LOCKED_MODEL, "gemini-3.8-flash-high");
  assert.equal(UPSTREAM_LOCKED_MODEL, "gemini-3.8-flash-high(high)");
  assert.equal(envelope.model, UPSTREAM_LOCKED_MODEL);
  assert.equal(envelope.requestType, "agent");
  assert.equal(envelope.request.tools, undefined);
  assert.equal(envelope.request.systemInstruction.parts[0].text, "critic only");
  assert.equal(envelope.request.contents[0].parts[0].text, "challenge this");
});

test("SSE parser drops thought parts and returns final text", () => {
  const sse = [
    'data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"private"}]}}]}}',
    'data: {"response":{"candidates":[{"content":{"parts":[{"text":"final "}]}}]}}',
    'data: {"response":{"candidates":[{"content":{"parts":[{"text":"answer"}]}}]}}'
  ].join("\n");
  assert.equal(parseSseText(sse), "final answer");
});

test("retry hints prefer exact reset and understand Retry-After seconds", () => {
  const now = Date.parse("2026-09-04T07:00:00Z");
  assert.deepEqual(
    parseUpstreamRetryHints(
      { get: (name) => name.toLowerCase() === "retry-after" ? "12" : null },
      '{"resetAt":"2026-09-04T07:05:00Z"}',
      now
    ),
    { retryAfterMs: 12_000, resetsAtMs: Date.parse("2026-09-04T07:05:00Z") }
  );
});

test("retry hints parse Google-style retry delay from body", () => {
  const hint = parseUpstreamRetryHints(
    { get: () => null },
    '{"retryDelay":"7.5s"}',
    1000
  );
  assert.equal(hint.retryAfterMs, 7500);
  assert.equal(hint.resetsAtMs, null);
});

test("deadline guard stops account rotation when there is not enough request budget", () => {
  assert.equal(hasRetryBudget(50_000, 40_000), true);
  assert.equal(hasRetryBudget(45_000, 40_000), false);
});
