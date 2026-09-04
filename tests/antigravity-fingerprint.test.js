import test from "node:test";
import assert from "node:assert/strict";
import {
  ANTIGRAVITY_IDE_USER_AGENT,
  ANTIGRAVITY_IDE_VERSION,
  buildAntigravityGenerationHeaders
} from "../src/antigravity/client.js";

test("Gemini 3.8 uses the current Antigravity IDE 2.11.0 fingerprint", () => {
  assert.equal(ANTIGRAVITY_IDE_VERSION, "2.11.0");
  assert.equal(ANTIGRAVITY_IDE_USER_AGENT, "antigravity/ide/2.11.0 darwin/arm64");

  const headers = buildAntigravityGenerationHeaders("access-token", "text/event-stream");
  assert.equal(headers.Authorization, "Bearer access-token");
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers.Accept, "text/event-stream");
  assert.equal(headers["User-Agent"], ANTIGRAVITY_IDE_USER_AGENT);

  // Current 9router generation transport identifies itself through the official
  // IDE User-Agent; project-discovery metadata is not part of generation calls.
  assert.equal(headers["Client-Metadata"], undefined);
  assert.equal(headers["X-Goog-Api-Client"], undefined);
  assert.equal(headers["x-request-source"], undefined);
});
