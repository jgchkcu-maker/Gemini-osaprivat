import { challengeOutputSchema, compareOutputSchema } from "./schemas.js";

function stripFence(text) {
  const trimmed = String(text ?? "").trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function parseJsonCandidate(text) {
  const cleaned = stripFence(text);

  try {
    return { cleaned, value: JSON.parse(cleaned) };
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return {
          cleaned,
          value: JSON.parse(cleaned.slice(firstBrace, lastBrace + 1))
        };
      } catch {
        // Fall through to a structured degraded result.
      }
    }
  }

  return { cleaned, value: null };
}

export function parseCriticJson(text) {
  const { cleaned, value } = parseJsonCandidate(text);
  if (value !== null) return value;

  return {
    verdict: "revise",
    summary: cleaned || "Gemini returned an empty critique.",
    objections: [],
    missing_considerations: [],
    alternatives: [],
    confidence: 0.25
  };
}

function challengeFallback(cleaned) {
  return {
    verdict: "revise",
    summary: cleaned
      ? `Gemini returned an invalid structured critique: ${cleaned.slice(0, 2000)}`
      : "Gemini returned an empty or invalid structured critique.",
    objections: [],
    missing_considerations: [],
    alternatives: [],
    confidence: 0.15,
    requires_rechallenge: false
  };
}

function compareFallback(cleaned) {
  return {
    preferred_option: null,
    ranking: [],
    weaknesses: [],
    decision_rule: cleaned
      ? `Gemini returned an invalid structured comparison: ${cleaned.slice(0, 2000)}`
      : "Gemini returned an empty or invalid structured comparison.",
    confidence: 0.15
  };
}

export function parseChallengeResult(text) {
  const { cleaned, value } = parseJsonCandidate(text);
  const parsed = challengeOutputSchema.safeParse(value);
  return parsed.success ? parsed.data : challengeFallback(cleaned);
}

export function parseCompareResult(text) {
  const { cleaned, value } = parseJsonCandidate(text);
  const parsed = compareOutputSchema.safeParse(value);
  return parsed.success ? parsed.data : compareFallback(cleaned);
}
