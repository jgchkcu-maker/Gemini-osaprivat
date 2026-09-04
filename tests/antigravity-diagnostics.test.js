import test from "node:test";
import assert from "node:assert/strict";
import {
  formatAntigravity404Diagnostic,
  LOCKED_MODEL,
  summarizeAntigravityModels
} from "../src/antigravity/client.js";

test("model diagnostics report locked Gemini 3.8 availability without exposing unrelated models", () => {
  const summary = summarizeAntigravityModels({
    models: {
      [LOCKED_MODEL]: {
        quotaInfo: { remainingFraction: 0.75 }
      },
      "gemini-3.8-flash-medium": {
        quotaInfo: { remainingFraction: 1 }
      },
      "gemini-3.7-flash-high": {
        quotaInfo: { remainingFraction: 0.5 }
      },
      "internal-secret-model": {
        quotaInfo: { remainingFraction: 1 }
      }
    }
  });

  assert.deepEqual(summary, {
    lockedModelPresent: true,
    lockedModelHasQuota: true,
    lockedRemainingFraction: 0.75,
    nearbyModelIds: [
      "gemini-3.7-flash-high",
      "gemini-3.8-flash-high",
      "gemini-3.8-flash-medium"
    ]
  });
});

test("404 diagnostic is safe and contains the evidence needed to separate OAuth entitlement from request shape", () => {
  const text = formatAntigravity404Diagnostic({
    oauthClientType: "web",
    projectPresent: true,
    modelsStatus: 200,
    modelSummary: {
      lockedModelPresent: false,
      lockedModelHasQuota: false,
      lockedRemainingFraction: null,
      nearbyModelIds: ["gemini-3.7-flash-high"]
    }
  });

  assert.match(text, /oauth=web/);
  assert.match(text, /client=2\.11\.0/);
  assert.match(text, /project=present/);
  assert.match(text, /modelsStatus=200/);
  assert.match(text, /lockedModelPresent=false/);
  assert.match(text, /nearbyModels=gemini-3\.7-flash-high/);
  assert.doesNotMatch(text, /Bearer|refresh|access-token|project-123/);
});
