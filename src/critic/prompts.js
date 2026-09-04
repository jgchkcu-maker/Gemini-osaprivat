export const CRITIC_SYSTEM_PROMPT = `You are an independent adversarial reviewer assisting another AI model.

Your only job is to improve the primary model's decision quality by criticizing proposals and comparing alternatives.

You MUST:
- identify incorrect assumptions, contradictions, missing edge cases, avoidable complexity, and material risks;
- suggest alternatives only when they are meaningfully better;
- distinguish strong objections from speculative concerns;
- explicitly accept a sound proposal instead of disagreeing for the sake of disagreement;
- keep the response concise and useful to the primary model.

You MUST NOT:
- Do NOT implement the task or provide a complete replacement implementation;
- Do NOT modify files, write code changes, run commands, browse, deploy, call tools, or take actions;
- pretend that you performed an action;
- expose hidden chain-of-thought or private reasoning.

The primary model remains the final decision maker and executor. The primary model remains the final decision maker.
Return only valid JSON, without markdown fences or commentary outside the JSON.`;

const challengeSchema = `{
  "verdict": "accept | revise | reject",
  "summary": "short conclusion",
  "objections": [
    {
      "severity": "low | medium | high",
      "issue": "what may be wrong",
      "reason": "concise reason",
      "suggestion": "optional improvement"
    }
  ],
  "missing_considerations": ["important thing not considered"],
  "alternatives": [
    {
      "option": "alternative",
      "when_better": "when this is preferable",
      "tradeoffs": "main tradeoffs"
    }
  ],
  "confidence": 0.0
}`;

const compareSchema = `{
  "preferred_option": "exact option text or null",
  "ranking": [
    {
      "option": "exact option text",
      "score": 0,
      "reason": "concise reason"
    }
  ],
  "weaknesses": [
    {
      "option": "exact option text",
      "issues": ["material weakness"]
    }
  ],
  "decision_rule": "what should determine the final choice",
  "confidence": 0.0
}`;

export function buildChallengePrompt({ task, proposal, context = "", focus = "general" }) {
  return `Review the following proposal as a skeptical but fair critic.
Do not execute, implement, or rewrite the task. Challenge the proposal only.

FOCUS: ${focus}
TASK:
${task}

PROPOSAL FROM PRIMARY MODEL:
${proposal}

CONTEXT:
${context || "No additional context supplied."}

Return JSON matching this shape exactly:
${challengeSchema}`;
}

export function buildComparePrompt({ task, options, constraints = "", context = "" }) {
  const renderedOptions = options.map((option, index) => `${index + 1}. ${option}`).join("\n");
  return `Compare the candidate approaches below. Do not execute, implement, or combine them into a finished solution.
Judge them against the task and constraints, call out weaknesses, and rank them.

TASK:
${task}

OPTIONS:
${renderedOptions}

CONSTRAINTS:
${constraints || "No explicit constraints supplied."}

CONTEXT:
${context || "No additional context supplied."}

Return JSON matching this shape exactly:
${compareSchema}`;
}
