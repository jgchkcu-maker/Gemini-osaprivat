import { generateCriticText } from "../antigravity/client.js";
import { parseCriticJson } from "./parser.js";
import { buildChallengePrompt, buildComparePrompt, CRITIC_SYSTEM_PROMPT } from "./prompts.js";

export async function challenge(input) {
  const raw = await generateCriticText({
    systemPrompt: CRITIC_SYSTEM_PROMPT,
    userPrompt: buildChallengePrompt(input)
  });
  return parseCriticJson(raw);
}

export async function compare(input) {
  const raw = await generateCriticText({
    systemPrompt: CRITIC_SYSTEM_PROMPT,
    userPrompt: buildComparePrompt(input)
  });
  return parseCriticJson(raw);
}
