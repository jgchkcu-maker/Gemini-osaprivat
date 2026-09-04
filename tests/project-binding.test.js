import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureAntigravityProjectForToken,
  extractAntigravityProjectId,
  selectAntigravityTierId
} from "../src/accounts/oauth.js";

test("project helpers extract Cloud Code project and default tier", () => {
  const data = {
    cloudaicompanionProject: { id: "project-123" },
    allowedTiers: [
      { id: "other-tier", isDefault: false },
      { id: "free-tier", isDefault: true }
    ]
  };
  assert.equal(extractAntigravityProjectId(data), "project-123");
  assert.equal(selectAntigravityTierId(data), "free-tier");
  assert.equal(selectAntigravityTierId({ allowedTiers: [] }), "legacy-tier");
});

test("ensureAntigravityProjectForToken loads project, onboards, and waits until done", async () => {
  const calls = [];
  let onboardAttempt = 0;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/v1internal:loadCodeAssist")) {
      return Response.json({
        cloudaicompanionProject: { id: "project-123" },
        allowedTiers: [{ id: "free-tier", isDefault: true }]
      });
    }
    if (String(url).endsWith("/v1internal:onboardUser")) {
      onboardAttempt += 1;
      return Response.json(
        onboardAttempt === 1
          ? { done: false }
          : { done: true, response: { cloudaicompanionProject: { id: "project-123" } } }
      );
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const sleeps = [];
  const result = await ensureAntigravityProjectForToken("access-token", {
    fetchImpl,
    sleepImpl: async (ms) => sleeps.push(ms),
    maxOnboardAttempts: 3,
    fetchTimeoutMs: 2_000
  });

  assert.deepEqual(result, {
    projectId: "project-123",
    tierId: "free-tier",
    onboarded: true
  });
  assert.equal(calls[0].url, "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist");
  assert.equal(calls[1].url, "https://cloudcode-pa.googleapis.com/v1internal:onboardUser");
  assert.equal(calls[2].url, "https://cloudcode-pa.googleapis.com/v1internal:onboardUser");
  const onboardBody = JSON.parse(calls[1].init.body);
  assert.deepEqual(onboardBody, {
    tierId: "free-tier",
    metadata: { ideType: 9, platform: 3, pluginType: 2 }
  });
  assert.deepEqual(sleeps, [1500]);
});

test("onboarding can supply a project when loadCodeAssist has not created one yet", async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/v1internal:loadCodeAssist")) {
      return Response.json({ allowedTiers: [] });
    }
    return Response.json({
      done: true,
      response: { cloudaicompanionProject: "project-from-onboarding" }
    });
  };

  const result = await ensureAntigravityProjectForToken("access-token", {
    fetchImpl,
    sleepImpl: async () => {},
    maxOnboardAttempts: 1,
    fetchTimeoutMs: 2_000
  });
  assert.deepEqual(result, {
    projectId: "project-from-onboarding",
    tierId: "legacy-tier",
    onboarded: true
  });
});
