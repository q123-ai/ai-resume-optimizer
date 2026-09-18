import { z } from "zod";
import { jobSourcedTextSchema } from "./job";
import { sourcedTextSchema } from "./resume";

export const matchStatusSchema = z.enum(["matched", "partial", "missing"]);
export const matchPrioritySchema = z.enum(["required", "preferred", "unspecified"]);
export const matchCategorySchema = z.enum([
  "responsibility",
  "skill",
  "education",
  "experience",
  "certification",
  "language",
  "other",
]);

export const aiMatchDecisionSchema = z.strictObject({
  requirementId: z.string().min(1).max(100),
  status: matchStatusSchema,
  resumeEvidenceIds: z.array(z.string().min(1).max(160)).max(20),
  matchReason: z.string().min(1).max(500),
});

export const aiMatchOutputSchema = z.strictObject({
  matches: z.array(aiMatchDecisionSchema).max(300),
});

export const matchEvidenceSchema = sourcedTextSchema.extend({
  evidenceId: z.string().min(1),
});

export const matchItemSchema = z.strictObject({
  id: z.string().min(1),
  category: matchCategorySchema,
  priority: matchPrioritySchema,
  requirement: jobSourcedTextSchema,
  status: matchStatusSchema,
  resumeEvidence: z.array(matchEvidenceSchema),
  matchReason: z.string().min(1).max(500),
});

const scoreGroupSchema = z.strictObject({
  possibleWeight: z.number().nonnegative(),
  earnedWeight: z.number().nonnegative(),
  matched: z.number().int().nonnegative(),
  partial: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
});

export const scoreBreakdownSchema = z.strictObject({
  required: scoreGroupSchema,
  preferred: scoreGroupSchema,
  unspecified: scoreGroupSchema,
  requirementPercentage: z.number().min(0).max(100),
  keywordPercentage: z.number().min(0).max(100),
  requirementContribution: z.number().min(0).max(100),
  keywordContribution: z.number().min(0).max(100),
});

export const keywordCoverageSchema = z.strictObject({
  coveredKeywords: z.array(z.string()),
  missingKeywords: z.array(z.string()),
  coveragePercentage: z.number().min(0).max(100),
});

export const matchSummaryItemSchema = z.strictObject({
  requirementId: z.string().min(1),
  value: z.string().min(1),
});

export const matchAnalysisSchema = z.strictObject({
  overallMatch: z.strictObject({
    score: z.number().int().min(0).max(100),
    level: z.enum(["high", "medium", "low"]),
    breakdown: scoreBreakdownSchema,
  }),
  matchedRequirements: z.array(matchItemSchema),
  partialMatches: z.array(matchItemSchema),
  missingRequirements: z.array(matchItemSchema),
  skillMatches: z.strictObject({
    matchedSkills: z.array(matchItemSchema),
    partialSkills: z.array(matchItemSchema),
    missingSkills: z.array(matchItemSchema),
  }),
  keywordCoverage: keywordCoverageSchema,
  strengths: z.array(matchSummaryItemSchema),
  gaps: z.array(matchSummaryItemSchema),
});

export type MatchStatus = z.infer<typeof matchStatusSchema>;
export type MatchPriority = z.infer<typeof matchPrioritySchema>;
export type MatchCategory = z.infer<typeof matchCategorySchema>;
export type AIMatchOutput = z.infer<typeof aiMatchOutputSchema>;
export type MatchItem = z.infer<typeof matchItemSchema>;
export type MatchAnalysis = z.infer<typeof matchAnalysisSchema>;
