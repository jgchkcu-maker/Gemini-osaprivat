import test from "node:test";
import assert from "node:assert/strict";
import { buildChallengePrompt, buildComparePrompt, CRITIC_SYSTEM_PROMPT } from "../src/critic/prompts.js";
import { parseCriticJson } from "../src/critic/parser.js";

test("system prompt hard-limits Gemini to critique instead of implementation", () => {
  assert.match(CRITIC_SYSTEM_PROMPT, /Do NOT implement/);
  assert.match(CRITIC_SYSTEM_PROMPT, /Do NOT modify files/);
  assert.match(CRITIC_SYSTEM_PROMPT, /primary model remains the final decision maker/);
});

test("challenge prompt contains supplied context", () => {
  const prompt = buildChallengePrompt({
    task: "Design a price tracker",
    proposal: "Use Postgres",
    context: "Runs on Vercel",
    focus: "architecture"
  });
  assert.match(prompt, /Design a price tracker/);
  assert.match(prompt, /Use Postgres/);
  assert.match(prompt, /Runs on Vercel/);
  assert.match(prompt, /architecture/);
});

test("compare prompt includes options and forbids execution", () => {
  const prompt = buildComparePrompt({
    task: "Pick storage",
    options: ["Postgres", "SQLite"],
    constraints: "serverless"
  });
  assert.match(prompt, /Postgres/);
  assert.match(prompt, /SQLite/);
  assert.match(prompt, /serverless/);
  assert.match(prompt, /Do not execute/);
});

test("parser accepts JSON in markdown fences", () => {
  const result = parseCriticJson('```json\n{"verdict":"revise","summary":"x"}\n```');
  assert.deepEqual(result, { verdict: "revise", summary: "x" });
});

test("parser returns structured fallback for non-JSON", () => {
  const result = parseCriticJson("The plan misses retry handling.");
  assert.equal(result.verdict, "revise");
  assert.equal(result.summary, "The plan misses retry handling.");
});
