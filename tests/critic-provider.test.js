import test from "node:test";
import assert from "node:assert/strict";
import { challenge, compare } from "../src/critic/service.js";

const acceptedChallenge = {
  verdict: "accept",
  summary: "The proposal is sound for the supplied constraints.",
  objections: [],
  missing_considerations: [],
  alternatives: [],
  confidence: 0.9,
  requires_rechallenge: false
};

test("challenge accepts an injected critic provider instead of depending on Antigravity directly", async () => {
  const calls = [];
  const provider = {
    name: "fake",
    async generate(input) {
      calls.push(input);
      return JSON.stringify(acceptedChallenge);
    }
  };

  const result = await challenge(
    { task: "Review storage", proposal: "Use Redis", focus: "architecture" },
    { provider }
  );

  assert.deepEqual(result, acceptedChallenge);
  assert.equal(calls.length, 1);
  assert.match(calls[0].systemPrompt, /independent second-opinion reviewer/i);
  assert.match(calls[0].userPrompt, /Use Redis/);
});

test("challenge degrades malformed provider output but does not hide provider exceptions", async () => {
  const malformedProvider = {
    name: "malformed",
    async generate() {
      return '{"verdict":"banana"}';
    }
  };

  const degraded = await challenge(
    { task: "Review", proposal: "Ship" },
    { provider: malformedProvider }
  );
  assert.equal(degraded.verdict, "revise");
  assert.equal(degraded.requires_rechallenge, false);
  assert.ok(degraded.confidence <= 0.25);

  const failingProvider = {
    name: "failing",
    async generate() {
      throw new Error("upstream unavailable");
    }
  };

  await assert.rejects(
    challenge({ task: "Review", proposal: "Ship" }, { provider: failingProvider }),
    /upstream unavailable/
  );
});

test("compare uses the same injected provider boundary and strict parser", async () => {
  const provider = {
    name: "fake",
    async generate() {
      return JSON.stringify({
        preferred_option: "A",
        ranking: [
          { option: "A", score: 9, reason: "Better fit." },
          { option: "B", score: 5, reason: "More complexity." }
        ],
        weaknesses: [{ option: "B", issues: ["More moving parts."] }],
        decision_rule: "Choose the smallest reliable option.",
        confidence: 0.8
      });
    }
  };

  const result = await compare(
    { task: "Pick", options: ["A", "B"] },
    { provider }
  );
  assert.equal(result.preferred_option, "A");
  assert.equal(result.confidence, 0.8);
});
