import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGenerateEnvelope,
  hasRetryBudget,
  LOCKED_MODEL,
  parseAntigravityQuotaReset,
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

test("request is text-only and sends Gemini 3.8 High in current Antigravity wire format", () => {
  const envelope = buildGenerateEnvelope({
    projectId: "p",
    model: "some-other-model",
    systemPrompt: "critic only",
    userPrompt: "challenge this"
  });
  assert.equal(LOCKED_MODEL, "gemini-3.8-flash-high");
  assert.equal(UPSTREAM_LOCKED_MODEL, "gemini-3.8-flash-high(high)");

  // The `(high)` suffix is an internal preset, not a literal upstream entity id.
  // Current 9router strips it from body.model and expresses High via thinkingConfig.
  assert.equal(envelope.model, LOCKED_MODEL);
  assert.deepEqual(envelope.request.generationConfig.thinkingConfig, {
    thinkingLevel: "high",
    includeThoughts: true
  });

  assert.match(envelope.request.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.match(
    envelope.requestId,
    /^agent\/[0-9a-f-]{36}\/\d+\/[0-9a-f-]{36}\/1$/i
  );
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

test("Antigravity quota response yields exact reset only when locked model is exhausted", () => {
  const now = Date.parse("2026-09-04T07:00:00Z");
  const reset = "2026-09-04T08:00:00Z";
  assert.equal(
    parseAntigravityQuotaReset(
      {
        models: {
          "gemini-3.8-flash-high": {
            quotaInfo: { remainingFraction: 0, resetTime: reset }
          }
        }
      },
      LOCKED_MODEL,
      now
    ),
    Date.parse(reset)
  );
  assert.equal(
    parseAntigravityQuotaReset(
      {
        models: {
          "gemini-3.8-flash-high": {
            quotaInfo: { remainingFraction: 0.25, resetTime: reset }
          }
        }
      },
      LOCKED_MODEL,
      now
    ),
    null
  );
});

test("deadline guard stops account rotation when there is not enough request budget", () => {
  assert.equal(hasRetryBudget(50_000, 40_000), true);
  assert.equal(hasRetryBudget(45_000, 40_000), false);
});
