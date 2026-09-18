import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import MatchAnalysisPreview from "../src/components/MatchAnalysisPreview";
import type { MatchAnalysis } from "../src/types/match";

const item = {
  id: "skill:required:0",
  category: "skill" as const,
  priority: "required" as const,
  requirement: { value: "熟练使用 Excel", sourceText: "任职要求：熟练使用 Excel" },
  status: "matched" as const,
  resumeEvidence: [{ evidenceId: "skills[0].name", value: "Excel", sourceText: "使用 Excel 制作示例报表" }],
  matchReason: "简历证据直接支持该技能要求。",
};
const analysis: MatchAnalysis = {
  overallMatch: {
    score: 100,
    level: "high",
    breakdown: {
      required: { possibleWeight: 4, earnedWeight: 4, matched: 1, partial: 0, missing: 0 },
      preferred: { possibleWeight: 0, earnedWeight: 0, matched: 0, partial: 0, missing: 0 },
      unspecified: { possibleWeight: 0, earnedWeight: 0, matched: 0, partial: 0, missing: 0 },
      requirementPercentage: 100,
      keywordPercentage: 100,
      requirementContribution: 90,
      keywordContribution: 10,
    },
  },
  matchedRequirements: [item],
  partialMatches: [],
  missingRequirements: [],
  skillMatches: { matchedSkills: [item], partialSkills: [], missingSkills: [] },
  keywordCoverage: { coveredKeywords: ["Excel"], missingKeywords: [], coveragePercentage: 100 },
  strengths: [{ requirementId: item.id, value: "熟练使用 Excel" }],
  gaps: [],
};

test("successful pipeline analysis renders the existing MatchAnalysis result UI", () => {
  const html = renderToStaticMarkup(<MatchAnalysisPreview analysis={analysis} />);
  assert.match(html, /岗位匹配分析/);
  assert.match(html, /已匹配要求/);
  assert.match(html, /关键词覆盖/);
  assert.match(html, /熟练使用 Excel/);
});

test("preview uses requirement identity when two displayed requirements have identical text", () => {
  const duplicate = { ...item, id: "skill:required:1" };
  const duplicateAnalysis: MatchAnalysis = {
    ...analysis,
    matchedRequirements: [item, duplicate],
    skillMatches: { ...analysis.skillMatches, matchedSkills: [item, duplicate] },
    strengths: [
      { requirementId: item.id, value: item.requirement.value },
      { requirementId: duplicate.id, value: duplicate.requirement.value },
    ],
  };
  const warnings: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { warnings.push(args); };
  try {
    const html = renderToStaticMarkup(<MatchAnalysisPreview analysis={duplicateAnalysis} />);
    assert.equal((html.match(/熟练使用 Excel/g) ?? []).length >= 2, true);
  } finally {
    console.error = originalError;
  }
  assert.equal(warnings.some((args) => args.some((value) => String(value).includes("same key"))), false);
});
