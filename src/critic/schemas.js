import { z } from "zod";

export const criticFocusSchema = z.enum([
  "general",
  "logic",
  "architecture",
  "code",
  "ux",
  "simplicity",
  "failure_modes"
]);

export const challengeInputSchema = z.object({
  task: z.string().min(1).max(30000),
  proposal: z.string().min(1).max(60000),
  context: z.string().max(60000).optional(),
  focus: criticFocusSchema.default("general")
});

export const compareInputSchema = z.object({
  task: z.string().min(1).max(30000),
  options: z.array(z.string().min(1).max(30000)).min(2).max(6),
  constraints: z.string().max(30000).optional(),
  context: z.string().max(60000).optional()
});

export const objectionSchema = z.object({
  severity: z.enum(["low", "medium", "high"]),
  issue: z.string().min(1),
  reason: z.string().min(1),
  decision_impact: z.enum(["blocks", "changes_design", "minor"]),
  suggestion: z.string().min(1).optional()
});

export const alternativeSchema = z.object({
  option: z.string().min(1),
  when_better: z.string().min(1),
  tradeoffs: z.string().min(1)
});

export const challengeOutputSchema = z.object({
  verdict: z.enum(["accept", "revise", "reject"]),
  summary: z.string().min(1),
  objections: z.array(objectionSchema),
  missing_considerations: z.array(z.string().min(1)),
  alternatives: z.array(alternativeSchema),
  confidence: z.number().min(0).max(1),
  requires_rechallenge: z.boolean()
});

export const compareOutputSchema = z.object({
  preferred_option: z.string().min(1).nullable(),
  ranking: z.array(
    z.object({
      option: z.string().min(1),
      score: z.number().finite(),
      reason: z.string().min(1)
    })
  ),
  weaknesses: z.array(
    z.object({
      option: z.string().min(1),
      issues: z.array(z.string().min(1))
    })
  ),
  decision_rule: z.string().min(1),
  confidence: z.number().min(0).max(1)
});
