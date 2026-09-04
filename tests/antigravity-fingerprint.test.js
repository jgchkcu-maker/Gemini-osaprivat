import test from "node:test";
import assert from "node:assert/strict";
import {
  ANTIGRAVITY_IDE_USER_AGENT,
  ANTIGRAVITY_IDE_VERSION,
  ensureAntigravityProjectForToken
} from "../src/accounts/oauth.js";
import { buildAntigravityGenerationHeaders } from "../src/antigravity/client.js";

test("Gemini 3.8 uses the current Antigravity IDE 2.11.0 fingerprint", () => {
  assert.equal(ANTIGRAVITY_IDE_VERSION, "2.11.0");
  assert.equal(ANTIGRAVITY_IDE_USER_AGENT, "antigravity/ide/2.11.0 darwin/arm64");

  const headers = buildAntigravityGenerationHeaders("access-token", "text/event-stream");
  assert.equal(headers.Authorization, "Bearer access-token");
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers.Accept, "text/event-stream");
  assert.equal(headers["User-Agent"], ANTIGRAVITY_IDE_USER_AGENT);

  // Current 9router generation transport identifies itself through the official
  // IDE User-Agent; Cloud Code metadata headers belong to project/OAuth calls.
  assert.equal(headers["Client-Metadata"], undefined);
  assert.equal(headers["X-Goog-Api-Client"], undefined);
  assert.equal(headers["x-request-source"], undefined);
});

test("project binding uses the same current IDE fingerprint", async () => {
  const seenUserAgents = [];
  const fetchImpl = async (url, init = {}) => {
    seenUserAgents.push(init.headers?.["User-Agent"]);
    if (String(url).endsWith("/v1internal:loadCodeAssist")) {
      return Response.json({
        cloudaicompanionProject: { id: "project-123" },
        allowedTiers: [{ id: "free-tier", isDefault: true }]
      });
    }
    if (String(url).endsWith("/v1internal:onboardUser")) {
      return Response.json({
        done: true,
        response: { cloudaicompanionProject: { id: "project-123" } }
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  await ensureAntigravityProjectForToken("access-token", {
    fetchImpl,
    sleepImpl: async () => {},
    maxOnboardAttempts: 1,
    fetchTimeoutMs: 2_000
  });

  assert.deepEqual(seenUserAgents, [ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_IDE_USER_AGENT]);
});
