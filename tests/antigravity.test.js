import test from "node:test";
import assert from "node:assert/strict";
import { buildGenerateEnvelope, parseCompositeRefreshToken, parseSseText } from "../src/antigravity/client.js";

test("composite refresh tokens are parsed", () => {
  assert.deepEqual(parseCompositeRefreshToken("refresh|project|managed"), {
    refreshToken: "refresh",
    projectId: "project",
    managedProjectId: "managed"
  });
});

test("request is text-only and has no tools", () => {
  const envelope = buildGenerateEnvelope({
    projectId: "p",
    model: "gemini-3.8-flash-high",
    systemPrompt: "critic only",
    userPrompt: "challenge this"
  });
  assert.equal(envelope.model, "gemini-3.8-flash-high");
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
