function stripFence(text) {
  const trimmed = String(text ?? "").trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

export function parseCriticJson(text) {
  const cleaned = stripFence(text);

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch {
        // Fall through to a safe structured fallback.
      }
    }
  }

  return {
    verdict: "revise",
    summary: cleaned || "Gemini returned an empty critique.",
    objections: [],
    missing_considerations: [],
    alternatives: [],
    confidence: 0.25
  };
}
