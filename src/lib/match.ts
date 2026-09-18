import type { JobData } from "../types/job";
import {
  aiMatchOutputSchema,
  matchAnalysisSchema,
  type AIMatchOutput,
  type MatchAnalysis,
  type MatchCategory,
  type MatchItem,
  type MatchPriority,
  type MatchStatus,
} from "../types/match";
import type { ResumeData, SourcedText } from "../types/resume";
import { validateJobData } from "./job";
import { validateResumeData } from "./resume";

export class MatchValidationError extends Error {
  constructor(public readonly rule: string, public readonly field?: string) {
    super("匹配分析结果未通过结构或简历证据验证，请重试。");
  }
}

export type MatchRequirement = {
  id: string;
  category: MatchCategory;
  priority: MatchPriority;
  value: string;
  sourceText: string;
};

export type ResumeFact = SourcedText & { id: string };

const priorityWeights: Record<MatchPriority, number> = {
  required: 4,
  preferred: 2,
  unspecified: 1,
};
const statusCredits: Record<MatchStatus, number> = {
  matched: 1,
  partial: 0.5,
  missing: 0,
};

export function collectMatchRequirements(jobInput: JobData): MatchRequirement[] {
  const job = validateJobData(jobInput);
  const requirements: MatchRequirement[] = [];
  const add = (category: MatchCategory, priority: MatchPriority, items: SourcedText[]) => {
    for (const [index, item] of items.entries()) {
      requirements.push({ id: `${category}:${priority}:${index}`, category, priority, ...item });
    }
  };
  add("responsibility", "unspecified", job.responsibilities);
  add("skill", "required", job.requiredSkills);
  add("skill", "preferred", job.preferredSkills);
  add("skill", "unspecified", job.unspecifiedSkills);
  add("education", "required", job.educationRequirements.filter((item) => item.priority === "required"));
  add("education", "preferred", job.educationRequirements.filter((item) => item.priority === "preferred"));
  add("education", "unspecified", job.educationRequirements.filter((item) => item.priority === "unspecified"));
  add("experience", "required", job.experienceRequirements.filter((item) => item.priority === "required"));
  add("experience", "preferred", job.experienceRequirements.filter((item) => item.priority === "preferred"));
  add("experience", "unspecified", job.experienceRequirements.filter((item) => item.priority === "unspecified"));
  add("certification", "required", job.certifications.filter((item) => item.priority === "required"));
  add("certification", "preferred", job.certifications.filter((item) => item.priority === "preferred"));
  add("certification", "unspecified", job.certifications.filter((item) => item.priority === "unspecified"));
  add("language", "required", job.languageRequirements.filter((item) => item.priority === "required"));
  add("language", "preferred", job.languageRequirements.filter((item) => item.priority === "preferred"));
  add("language", "unspecified", job.languageRequirements.filter((item) => item.priority === "unspecified"));
  add("other", "required", job.otherRequirements.filter((item) => item.priority === "required"));
  add("other", "preferred", job.otherRequirements.filter((item) => item.priority === "preferred"));
  add("other", "unspecified", job.otherRequirements.filter((item) => item.priority === "unspecified"));
  return requirements;
}

export function collectResumeFacts(resumeInput: ResumeData): ResumeFact[] {
  const resume = validateResumeData(resumeInput);
  const facts: ResumeFact[] = [];
  const seen = new Set<string>();
  const snapshotId = Array.from(resume.rawText).reduce(
    (hash, character) => Math.imul(hash ^ character.codePointAt(0)!, 16777619) >>> 0,
    2166136261,
  ).toString(36);
  const visit = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (typeof value !== "object" || value === null) return;
    if ("value" in value && "sourceText" in value && typeof value.value === "string" && typeof value.sourceText === "string") {
      const key = `${value.value}\0${value.sourceText}`;
      if (!seen.has(key)) {
        const sequence = String(facts.length + 1).padStart(3, "0");
        facts.push({ id: `resume_evidence_${snapshotId}_${sequence}`, value: value.value, sourceText: value.sourceText });
      }
      seen.add(key);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (key !== "id" && key !== "rawText" && key !== "personalInfo" && key !== "category" && key !== "title") {
        visit(item, path ? `${path}.${key}` : key);
      }
    }
  };
  visit(resume, "");
  return facts;
}

function normalize(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

function keywordIsCovered(keyword: string, facts: ResumeFact[]): boolean {
  const target = normalize(keyword);
  if (!target) return false;
  const asciiToken = /^[a-z0-9+#.]+$/i.test(target);
  return facts.some((fact) => {
    const text = normalize(`${fact.value} ${fact.sourceText}`);
    if (!asciiToken) return text.includes(target);
    return (text.match(/[a-z][a-z0-9+#.]*/gi) ?? []).some((token) => token.toLocaleLowerCase() === target);
  });
}

export function calculateKeywordCoverage(jobInput: JobData, resumeInput: ResumeData) {
  const job = validateJobData(jobInput);
  const facts = collectResumeFacts(resumeInput);
  const keywords = [...new Set(job.keywords.map((item) => item.value.trim()).filter(Boolean))];
  const coveredKeywords = keywords.filter((keyword) => keywordIsCovered(keyword, facts));
  const missingKeywords = keywords.filter((keyword) => !coveredKeywords.includes(keyword));
  return {
    coveredKeywords,
    missingKeywords,
    coveragePercentage: keywords.length ? Math.round((coveredKeywords.length / keywords.length) * 100) : 0,
  };
}

function scoreGroup(items: MatchItem[], priority: MatchPriority) {
  const selected = items.filter((item) => item.priority === priority);
  const weight = priorityWeights[priority];
  return {
    possibleWeight: selected.length * weight,
    earnedWeight: selected.reduce((total, item) => total + weight * statusCredits[item.status], 0),
    matched: selected.filter((item) => item.status === "matched").length,
    partial: selected.filter((item) => item.status === "partial").length,
    missing: selected.filter((item) => item.status === "missing").length,
  };
}

export function calculateOverallMatch(items: MatchItem[], keywordPercentage: number, keywordCount = 0) {
  const required = scoreGroup(items, "required");
  const preferred = scoreGroup(items, "preferred");
  const unspecified = scoreGroup(items, "unspecified");
  const possible = required.possibleWeight + preferred.possibleWeight + unspecified.possibleWeight;
  const earned = required.earnedWeight + preferred.earnedWeight + unspecified.earnedWeight;
  const requirementPercentage = possible ? Math.round((earned / possible) * 100) : 0;
  const hasKeywords = keywordCount > 0;
  const requirementShare = possible && hasKeywords ? 0.9 : possible ? 1 : 0;
  const keywordShare = possible ? (hasKeywords ? 0.1 : 0) : 1;
  const requirementContribution = Math.round(requirementPercentage * requirementShare * 10) / 10;
  const keywordContribution = Math.round(keywordPercentage * keywordShare * 10) / 10;
  const score = Math.round(requirementContribution + keywordContribution);
  return {
    score,
    level: score >= 75 ? "high" as const : score >= 50 ? "medium" as const : "low" as const,
    breakdown: {
      required,
      preferred,
      unspecified,
      requirementPercentage,
      keywordPercentage,
      requirementContribution,
      keywordContribution,
    },
  };
}

function normalizeTechnicalStatus(status: MatchStatus, requirement: MatchRequirement, evidence: ResumeFact[], job: JobData): MatchStatus {
  const requirementText = normalize(`${requirement.value} ${requirement.sourceText}`);
  const tokens = [...new Set(job.keywords.map((keyword) => normalize(keyword.value))
    .filter((token) => /^[a-z0-9+#.]+$/i.test(token) && requirementText.includes(token)))];
  if (!tokens.length || status === "missing") return status;
  const covered = tokens.filter((token) => keywordIsCovered(token, evidence)).length;
  if (covered === 0) return "missing";
  if (covered < tokens.length && status === "matched") return "partial";
  return status;
}

export function createMatchAnalysis(
  aiInput: unknown,
  resumeInput: ResumeData,
  jobInput: JobData,
): MatchAnalysis {
  const resume = validateResumeData(resumeInput);
  const job = validateJobData(jobInput);
  const parsed = aiMatchOutputSchema.safeParse(aiInput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue.path.map((part) => typeof part === "number" ? `[${part}]` : part)
      .join(".").replace(/\.\[/g, "[") || "root";
    throw new MatchValidationError(issue.code, field);
  }
  const requirements = collectMatchRequirements(job);
  const facts = collectResumeFacts(resume);
  const requirementById = new Map(requirements.map((item) => [item.id, item]));
  const factById = new Map(facts.map((item) => [item.id, item]));
  const decisions = new Map<string, AIMatchOutput["matches"][number]>();
  for (const [index, decision] of parsed.data.matches.entries()) {
    const field = `matches[${index}]`;
    if (!requirementById.has(decision.requirementId)) throw new MatchValidationError("unknown_requirement", `${field}.requirementId`);
    if (decisions.has(decision.requirementId)) throw new MatchValidationError("duplicate_requirement", `${field}.requirementId`);
    if (new Set(decision.resumeEvidenceIds).size !== decision.resumeEvidenceIds.length) throw new MatchValidationError("duplicate_evidence", `${field}.resumeEvidenceIds`);
    if (decision.resumeEvidenceIds.some((id) => !factById.has(id))) throw new MatchValidationError("fabricated_resume_evidence", `${field}.resumeEvidenceIds`);
    if (decision.status === "missing" && decision.resumeEvidenceIds.length) throw new MatchValidationError("missing_with_evidence", field);
    if (decision.status !== "missing" && !decision.resumeEvidenceIds.length) throw new MatchValidationError("match_without_evidence", field);
    decisions.set(decision.requirementId, decision);
  }
  if (decisions.size !== requirements.length) throw new MatchValidationError("incomplete_requirements", "matches");

  const items: MatchItem[] = requirements.map((requirement) => {
    const decision = decisions.get(requirement.id)!;
    const evidence = decision.resumeEvidenceIds.map((id) => factById.get(id)!);
    const status = normalizeTechnicalStatus(decision.status, requirement, evidence, job);
    let matchReason = decision.matchReason;
    if (status === "missing" && decision.status !== "missing") {
      matchReason = "简历中未找到该明确技能的相关证据。";
    } else if (status === "partial" && decision.status === "matched") {
      matchReason = "简历仅覆盖该要求中的部分明确技能。";
    }
    return {
      id: requirement.id,
      category: requirement.category,
      priority: requirement.priority,
      requirement: { value: requirement.value, sourceText: requirement.sourceText },
      status,
      resumeEvidence: status === "missing" ? [] : evidence.map(({ id, value, sourceText }) => ({ evidenceId: id, value, sourceText })),
      matchReason: status === "missing" ? "简历中未找到相关证据。" : matchReason,
    };
  });
  const keywordCoverage = calculateKeywordCoverage(job, resume);
  const overallMatch = calculateOverallMatch(items, keywordCoverage.coveragePercentage, job.keywords.length);
  const matchedRequirements = items.filter((item) => item.status === "matched");
  const partialMatches = items.filter((item) => item.status === "partial");
  const missingRequirements = items.filter((item) => item.status === "missing");
  const skills = items.filter((item) => item.category === "skill");
  return matchAnalysisSchema.parse({
    overallMatch,
    matchedRequirements,
    partialMatches,
    missingRequirements,
    skillMatches: {
      matchedSkills: skills.filter((item) => item.status === "matched"),
      partialSkills: skills.filter((item) => item.status === "partial"),
      missingSkills: skills.filter((item) => item.status === "missing"),
    },
    keywordCoverage,
    strengths: matchedRequirements.map((item) => ({ requirementId: item.id, value: item.requirement.value })),
    gaps: [...partialMatches, ...missingRequirements].map((item) => ({ requirementId: item.id, value: item.requirement.value })),
  });
}

export function validateMatchAnalysis(input: unknown, resume: ResumeData, job: JobData): MatchAnalysis {
  const parsed = matchAnalysisSchema.parse(input);
  const requirements = collectMatchRequirements(job);
  const facts = collectResumeFacts(resume);
  const requirementById = new Map(requirements.map((item) => [item.id, item]));
  const factById = new Map(facts.map((item) => [item.id, item]));
  const items = [...parsed.matchedRequirements, ...parsed.partialMatches, ...parsed.missingRequirements];
  if (items.length !== requirements.length || new Set(items.map((item) => item.id)).size !== requirements.length) {
    throw new MatchValidationError("result_requirements");
  }
  for (const item of items) {
    const requirement = requirementById.get(item.id);
    if (!requirement || item.requirement.value !== requirement.value || item.requirement.sourceText !== requirement.sourceText || item.priority !== requirement.priority || item.category !== requirement.category) {
      throw new MatchValidationError("result_requirement_changed");
    }
    if (item.resumeEvidence.some((evidence) => {
      const fact = factById.get(evidence.evidenceId);
      return !fact || fact.value !== evidence.value || fact.sourceText !== evidence.sourceText;
    })) {
      throw new MatchValidationError("result_evidence_changed");
    }
    if ((item.status === "missing") !== (item.resumeEvidence.length === 0)) throw new MatchValidationError("result_status_evidence");
  }
  if (parsed.matchedRequirements.some((item) => item.status !== "matched") ||
      parsed.partialMatches.some((item) => item.status !== "partial") ||
      parsed.missingRequirements.some((item) => item.status !== "missing")) {
    throw new MatchValidationError("result_status_bucket");
  }
  const expectedCoverage = calculateKeywordCoverage(job, resume);
  if (JSON.stringify(parsed.keywordCoverage) !== JSON.stringify(expectedCoverage)) throw new MatchValidationError("result_keyword_score");
  const expectedScore = calculateOverallMatch(items, expectedCoverage.coveragePercentage, job.keywords.length);
  if (JSON.stringify(parsed.overallMatch) !== JSON.stringify(expectedScore)) throw new MatchValidationError("result_overall_score");
  const skills = items.filter((item) => item.category === "skill");
  const expectedSkills = {
    matchedSkills: skills.filter((item) => item.status === "matched"),
    partialSkills: skills.filter((item) => item.status === "partial"),
    missingSkills: skills.filter((item) => item.status === "missing"),
  };
  if (JSON.stringify(parsed.skillMatches) !== JSON.stringify(expectedSkills)) throw new MatchValidationError("result_skill_groups");
  const expectedStrengths = parsed.matchedRequirements.map((item) => ({ requirementId: item.id, value: item.requirement.value }));
  const expectedGaps = [...parsed.partialMatches, ...parsed.missingRequirements].map((item) => ({ requirementId: item.id, value: item.requirement.value }));
  if (JSON.stringify(parsed.strengths) !== JSON.stringify(expectedStrengths) || JSON.stringify(parsed.gaps) !== JSON.stringify(expectedGaps)) {
    throw new MatchValidationError("result_summary_groups");
  }
  return parsed;
}
