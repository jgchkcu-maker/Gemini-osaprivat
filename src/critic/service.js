import { parseChallengeResult, parseCompareResult } from "./parser.js";
import { buildChallengePrompt, buildComparePrompt, CRITIC_SYSTEM_PROMPT } from "./prompts.js";
import { getCriticProvider } from "./provider.js";

function resolveProvider(options = {}) {
  const provider = options.provider ?? getCriticProvider();
  if (!provider || typeof provider.generate !== "function") {
    throw new Error("Critic provider must expose generate({ systemPrompt, userPrompt })");
  }
  return provider;
}

export async function challenge(input, options = {}) {
  const provider = resolveProvider(options);
  const raw = await provider.generate({
    systemPrompt: CRITIC_SYSTEM_PROMPT,
    userPrompt: buildChallengePrompt(input)
  });
  return parseChallengeResult(raw);
}

export async function compare(input, options = {}) {
  const provider = resolveProvider(options);
  const raw = await provider.generate({
    systemPrompt: CRITIC_SYSTEM_PROMPT,
    userPrompt: buildComparePrompt(input)
  });
  return parseCompareResult(raw);
}
