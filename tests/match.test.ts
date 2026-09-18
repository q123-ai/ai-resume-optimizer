import { test } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { getAIError } from "../src/lib/ai";
import { analyzeMatch, analyzeMatchWithRetry, analyzeMatchRequestSchema, MatchAnalysisError } from "../src/lib/analyze-match";
import { createJobData } from "../src/lib/job";
import {
  calculateKeywordCoverage,
  calculateOverallMatch,
  collectMatchRequirements,
  collectResumeFacts,
  createMatchAnalysis,
  MatchValidationError,
  validateMatchAnalysis,
} from "../src/lib/match";
import { MatchClientError, requestMatchAnalysis } from "../src/lib/match-client";
import { createResumeData } from "../src/lib/resume";
import type { JobExtraction } from "../src/types/job";
import type { AIMatchOutput } from "../src/types/match";
import type { ResumeExtraction } from "../src/types/resume";

// All people, companies and employment information below are fictional.
const resumeRaw = "李明\nli.ming@example.com\n示例大学 本科\n示例科技有限公司 数据分析实习生\n使用 Excel 对经营数据进行统计分析\n使用 SQL 查询业务数据\n了解 Python 基础\n具备良好的沟通能力";
const sourced = (value: string) => ({ value, sourceText: value });
const resumeExtraction: ResumeExtraction = {
  personalInfo: { name: sourced("李明"), phone: null, email: sourced("li.ming@example.com"), location: null, website: null, linkedin: null, github: null, other: [] },
  summary: null,
  education: [{ school: sourced("示例大学"), degree: sourced("本科"), major: null, startDate: null, endDate: null, description: [] }],
  experience: [{ company: sourced("示例科技有限公司"), position: sourced("数据分析实习生"), startDate: null, endDate: null, location: null, description: [sourced("使用 Excel 对经营数据进行统计分析"), sourced("使用 SQL 查询业务数据")] }],
  projects: [],
  skills: [
    { name: sourced("Excel"), category: null, description: null },
    { name: sourced("SQL"), category: null, description: null },
    { name: sourced("Python"), category: null, description: sourced("了解 Python 基础") },
    { name: sourced("沟通能力"), category: null, description: sourced("具备良好的沟通能力") },
  ],
  certificates: [],
  other: [],
};
const resumeData = createResumeData(resumeExtraction, resumeRaw);

const jobRaw = "岗位职责：负责经营数据分析\n任职要求：熟练使用 Excel\n必须掌握 SQL\nPython 经验优先\n沟通能力\n学历要求：本科\n关键词：Excel、SQL、Python";
const jobExtraction: JobExtraction = {
  jobTitle: null, companyName: null, location: null, employmentType: null, salary: null,
  responsibilities: [sourced("负责经营数据分析")],
  requiredSkills: [sourced("熟练使用 Excel"), sourced("必须掌握 SQL")],
  preferredSkills: [sourced("Python 经验优先")],
  unspecifiedSkills: [sourced("沟通能力")],
  educationRequirements: [{ ...sourced("学历要求：本科"), priority: "required" }],
  experienceRequirements: [], certifications: [], languageRequirements: [], otherRequirements: [],
  keywords: [sourced("Excel"), sourced("SQL"), sourced("Python")],
};
const jobData = createJobData(jobExtraction, jobRaw);

function factId(value: string) {
  const fact = collectResumeFacts(resumeData).find((item) => item.value === value);
  assert.ok(fact, `missing fictional fact: ${value}`);
  return fact.id;
}

const evidenceByRequirement = (value: string): string[] => {
  if (value.includes("经营数据分析")) return [factId("使用 Excel 对经营数据进行统计分析")];
  if (value.includes("Excel")) return [factId("Excel")];
  if (value.includes("SQL")) return [factId("SQL")];
  if (value.includes("Python")) return [factId("Python")];
  if (value.includes("沟通")) return [factId("沟通能力")];
  if (value.includes("本科")) return [factId("本科")];
  return [];
};

function output(statuses: Partial<Record<string, "matched" | "partial" | "missing">> = {}): AIMatchOutput {
  return {
    matches: collectMatchRequirements(jobData).map((requirement) => {
      const status = statuses[requirement.id] ?? "matched";
      return {
        requirementId: requirement.id,
        status,
        resumeEvidenceIds: status === "missing" ? [] : evidenceByRequirement(requirement.value),
        matchReason: status === "partial" ? "存在相关事实，但证据不足以证明完全满足。" : status === "missing" ? "未找到证据。" : "简历事实直接支持该要求。",
      };
    }),
  };
}

test("complete match produces traceable requirements, skills and strengths", () => {
  const analysis = createMatchAnalysis(output(), resumeData, jobData);
  assert.equal(analysis.missingRequirements.length, 0);
  assert.equal(analysis.partialMatches.length, 0);
  assert.equal(analysis.matchedRequirements.length, collectMatchRequirements(jobData).length);
  assert.equal(analysis.skillMatches.matchedSkills.length, 4);
  assert.ok(analysis.matchedRequirements.every((item) => item.resumeEvidence.length > 0));
  assert.ok(analysis.strengths.some((item) => item.value === "熟练使用 Excel"));
});

test("partial and missing matches remain separate; missing never has resume evidence", () => {
  const requirements = collectMatchRequirements(jobData);
  const python = requirements.find((item) => item.value.includes("Python"))!;
  const sql = requirements.find((item) => item.value.includes("SQL"))!;
  const analysis = createMatchAnalysis(output({ [python.id]: "partial", [sql.id]: "missing" }), resumeData, jobData);
  assert.equal(analysis.partialMatches[0].id, python.id);
  assert.equal(analysis.missingRequirements[0].id, sql.id);
  assert.deepEqual(analysis.missingRequirements[0].resumeEvidence, []);
  assert.equal(analysis.missingRequirements[0].matchReason, "简历中未找到相关证据。");
});

test("all requirements can be missing without inventing candidate facts", () => {
  const statuses: Partial<Record<string, "matched" | "partial" | "missing">> = {};
  collectMatchRequirements(jobData).forEach((item) => { statuses[item.id] = "missing"; });
  const analysis = createMatchAnalysis(output(statuses), resumeData, jobData);
  assert.equal(analysis.overallMatch.score, 10);
  assert.equal(analysis.missingRequirements.length, collectMatchRequirements(jobData).length);
  assert.ok(analysis.missingRequirements.every((item) => item.resumeEvidence.length === 0));
});

test("required absence reduces score more than preferred absence; unspecified stays lower weight", () => {
  const requirements = collectMatchRequirements(jobData);
  const required = requirements.find((item) => item.priority === "required")!;
  const preferred = requirements.find((item) => item.priority === "preferred")!;
  const unspecified = requirements.find((item) => item.priority === "unspecified")!;
  const missingRequired = createMatchAnalysis(output({ [required.id]: "missing" }), resumeData, jobData);
  const missingPreferred = createMatchAnalysis(output({ [preferred.id]: "missing" }), resumeData, jobData);
  const missingUnspecified = createMatchAnalysis(output({ [unspecified.id]: "missing" }), resumeData, jobData);
  assert.ok(missingRequired.overallMatch.score < missingPreferred.overallMatch.score);
  assert.ok(missingPreferred.overallMatch.score < missingUnspecified.overallMatch.score);
});

test("semantic evidence supports a differently worded data analysis requirement", () => {
  const analysis = createMatchAnalysis(output(), resumeData, jobData);
  const responsibility = analysis.matchedRequirements.find((item) => item.category === "responsibility")!;
  assert.equal(responsibility.resumeEvidence[0].value, "使用 Excel 对经营数据进行统计分析");
});

test("unknown AI evidence IDs are rejected as fabricated evidence", () => {
  const fabricated = output();
  fabricated.matches[0].resumeEvidenceIds = ["resume_evidence_unknown_999"];
  assert.throws(() => createMatchAnalysis(fabricated, resumeData, jobData), (error: unknown) => error instanceof MatchValidationError && error.rule === "fabricated_resume_evidence");
});

test("mixed, altered and previous-snapshot evidence IDs are rejected", () => {
  const legalId = factId("Excel");
  for (const ids of [
    [legalId, "resume_evidence_unknown_999"],
    [legalId.slice(0, -1) + "x"],
  ]) {
    const invalid = output();
    invalid.matches[0].resumeEvidenceIds = ids;
    assert.throws(() => createMatchAnalysis(invalid, resumeData, jobData),
      (error: unknown) => error instanceof MatchValidationError && error.rule === "fabricated_resume_evidence");
  }

  const changedResume = createResumeData(resumeExtraction, `${resumeRaw}\n新增的虚构简历内容`);
  assert.equal(collectResumeFacts(changedResume).some((fact) => fact.id === legalId), false);
  const stale = output();
  stale.matches[0].resumeEvidenceIds = [legalId];
  assert.throws(() => createMatchAnalysis(stale, changedResume, jobData),
    (error: unknown) => error instanceof MatchValidationError && error.rule === "fabricated_resume_evidence");
});

test("evidence IDs are deterministic within one resume snapshot and change with the resume", () => {
  assert.deepEqual(collectResumeFacts(resumeData), collectResumeFacts(resumeData));
  const changedResume = createResumeData(resumeExtraction, `${resumeRaw}\n另一份虚构内容`);
  assert.notDeepEqual(
    collectResumeFacts(resumeData).map((fact) => fact.id),
    collectResumeFacts(changedResume).map((fact) => fact.id),
  );
});

test("SQL cannot be inferred from adjacent Excel or Python evidence", () => {
  const sql = collectMatchRequirements(jobData).find((item) => item.value.includes("SQL"))!;
  const wrong = output();
  const decision = wrong.matches.find((item) => item.requirementId === sql.id)!;
  decision.resumeEvidenceIds = [factId("Excel"), factId("Python")];
  const analysis = createMatchAnalysis(wrong, resumeData, jobData);
  assert.equal(analysis.missingRequirements.some((item) => item.id === sql.id), true);
});

test("a requirement containing multiple explicit tools becomes partial when only some are evidenced", () => {
  const combinedRaw = jobRaw + "\n必须掌握 Excel 和 SQL";
  const combinedJob = createJobData({ ...jobExtraction, requiredSkills: [sourced("必须掌握 Excel 和 SQL")], preferredSkills: [], unspecifiedSkills: [] }, combinedRaw);
  const requirement = collectMatchRequirements(combinedJob).find((item) => item.category === "skill")!;
  const decisions: AIMatchOutput = { matches: collectMatchRequirements(combinedJob).map((item) => ({
    requirementId: item.id,
    status: "matched",
    resumeEvidenceIds: item.id === requirement.id ? [factId("Excel")] : evidenceByRequirement(item.value),
    matchReason: "简历事实直接支持该要求。",
  })) };
  const analysis = createMatchAnalysis(decisions, resumeData, combinedJob);
  assert.equal(analysis.partialMatches.some((item) => item.id === requirement.id), true);
});

test("keyword coverage is deterministic and derived from ResumeData", () => {
  const first = calculateKeywordCoverage(jobData, resumeData);
  const second = calculateKeywordCoverage(jobData, resumeData);
  assert.deepEqual(first, { coveredKeywords: ["Excel", "SQL", "Python"], missingKeywords: [], coveragePercentage: 100 });
  assert.deepEqual(second, first);
});

test("overall score is deterministic and never accepts an AI-provided score", () => {
  const analysis = createMatchAnalysis(output(), resumeData, jobData);
  const items = [...analysis.matchedRequirements, ...analysis.partialMatches, ...analysis.missingRequirements];
  assert.deepEqual(calculateOverallMatch(items, 100, 3), analysis.overallMatch);
  assert.deepEqual(createMatchAnalysis(output(), resumeData, jobData).overallMatch, analysis.overallMatch);
  assert.equal((output() as unknown as { score?: number }).score, undefined);
});

test("invalid ResumeData and JobData are rejected before analysis", async () => {
  const client = mockClient(JSON.stringify(output())).client;
  await assert.rejects(analyzeMatch(client, "deepseek-flash", "deepseek", { ...resumeData, rawText: "" }, jobData), /ResumeData 无效/);
  await assert.rejects(analyzeMatch(client, "deepseek-flash", "deepseek", resumeData, { ...jobData, rawText: "" }), /JobData 无效/);
  assert.equal(analyzeMatchRequestSchema.safeParse({ resumeData: {}, jobData }).success, false);
  assert.equal(analyzeMatchRequestSchema.safeParse({ resumeData, jobData: {} }).success, false);
});

function mockClient(result: string | Error, status = "completed") {
  let calls = 0;
  const client = new OpenAI({ apiKey: "fictional-placeholder", baseURL: "https://api.deepseek.com", maxRetries: 0,
    fetch: async (url, options) => {
      calls++;
      assert.equal(String(url), "https://api.deepseek.com/responses");
      const body = JSON.parse(String(options?.body));
      assert.equal(body.store, false);
      assert.equal(body.reasoning.effort, "none");
      assert.deepEqual(body.text.format, { type: "json_object" });
      const input = JSON.parse(body.input);
      assert.ok(Array.isArray(input.requirements));
      assert.ok(Array.isArray(input.resumeFacts));
      assert.deepEqual(input.allowedRequirementIds, input.requirements.map((item: { id: string }) => item.id));
      assert.deepEqual(input.allowedResumeEvidenceIds, input.resumeFacts.map((item: { id: string }) => item.id));
      assert.equal(JSON.stringify(input).includes("li.ming@example.com"), false);
      assert.match(body.instructions, /不能证明 SQL/);
      assert.match(body.instructions, /allowedResumeEvidenceIds/);
      if (result instanceof Error) throw result;
      return Response.json({ id: "resp_example", object: "response", status, model: "deepseek-flash", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: result, annotations: [] }] }] });
    },
  });
  return { client, calls: () => calls };
}

test("AI path sends only program IDs and builds the final deterministic analysis", async () => {
  const mock = mockClient(JSON.stringify(output()));
  const analysis = await analyzeMatch(mock.client, "deepseek-flash", "deepseek", resumeData, jobData);
  assert.equal(mock.calls(), 1);
  assert.equal(analysis.overallMatch.score, 100);
  assert.equal(analysis.keywordCoverage.coveragePercentage, 100);
});

test("malformed, incomplete and invalid AI output fail safely without retry", async () => {
  for (const [text, status] of [["not json", "completed"], [JSON.stringify({ matches: [] }), "completed"], [JSON.stringify(output()), "incomplete"]]) {
    const mock = mockClient(text, status);
    await assert.rejects(analyzeMatch(mock.client, "deepseek-flash", "deepseek", resumeData, jobData), Error);
    assert.equal(mock.calls(), 1);
  }
});

test("provider errors remain available to the shared safe error mapper", async () => {
  const mock = mockClient(new Error("fictional network failure"));
  let caught: unknown;
  try { await analyzeMatch(mock.client, "deepseek-flash", "deepseek", resumeData, jobData); } catch (error) { caught = error; }
  assert.ok(caught);
  assert.equal(getAIError(caught).error.includes("fictional"), false);
});

test("client accepts valid analysis and exposes HTTP, network and invalid JSON errors", async () => {
  const analysis = createMatchAnalysis(output(), resumeData, jobData);
  const ok = await requestMatchAnalysis(resumeData, jobData, undefined, async () => Response.json({ success: true, analysis }));
  assert.deepEqual(ok, analysis);
  await assert.rejects(requestMatchAnalysis(resumeData, jobData, undefined, async () => Response.json({ success: false, error: "测试错误" }, { status: 500 })), /测试错误/);
  await assert.rejects(requestMatchAnalysis(resumeData, jobData, undefined, async () => { throw new Error("offline"); }), MatchClientError);
  await assert.rejects(requestMatchAnalysis(resumeData, jobData, undefined, async () => new Response("invalid")), /无法读取/);
});

test("client rejects tampered scores and evidence", async () => {
  const analysis = createMatchAnalysis(output(), resumeData, jobData);
  const tampered = { ...analysis, overallMatch: { ...analysis.overallMatch, score: 99 } };
  await assert.rejects(requestMatchAnalysis(resumeData, jobData, undefined, async () => Response.json({ success: true, analysis: tampered })), /一致性验证/);
  const fakeStrength = { ...analysis, strengths: [{ requirementId: "fake", value: "不存在的候选人能力" }] };
  await assert.rejects(requestMatchAnalysis(resumeData, jobData, undefined, async () => Response.json({ success: true, analysis: fakeStrength })), /一致性验证/);
});

test("identical and similar requirement text retain distinct stable requirement IDs", () => {
  const duplicateText = "5 年以上产品经理经验";
  const text = `${jobRaw}\n${duplicateText}\n${duplicateText}\n5 年产品经理相关经验`;
  const duplicateJob = createJobData({
    ...jobExtraction,
    responsibilities: [sourced(duplicateText), sourced(duplicateText), sourced("5 年产品经理相关经验")],
  }, text);
  const requirements = collectMatchRequirements(duplicateJob).filter((item) => item.category === "responsibility");
  assert.deepEqual(requirements.map((item) => item.value), [duplicateText, duplicateText, "5 年产品经理相关经验"]);
  assert.equal(new Set(requirements.map((item) => item.id)).size, 3);
});

test("duplicate requirement decisions, including cross-status duplicates, are rejected", () => {
  const duplicate = output();
  duplicate.matches.push({ ...duplicate.matches[0] });
  assert.throws(() => createMatchAnalysis(duplicate, resumeData, jobData),
    (error: unknown) => error instanceof MatchValidationError && error.rule === "duplicate_requirement" && error.field?.endsWith("requirementId") === true);

  const crossStatus = output();
  crossStatus.matches.push({ ...crossStatus.matches[0], status: "missing", resumeEvidenceIds: [], matchReason: "未找到证据。" });
  assert.throws(() => createMatchAnalysis(crossStatus, resumeData, jobData),
    (error: unknown) => error instanceof MatchValidationError && error.rule === "duplicate_requirement");
});

test("AI decision order does not change bucket order, identity or result", () => {
  const original = output();
  const reversed: AIMatchOutput = { matches: [...original.matches].reverse() };
  assert.deepEqual(createMatchAnalysis(reversed, resumeData, jobData), createMatchAnalysis(original, resumeData, jobData));
});

test("each requirement ID appears exactly once across matched, partial and missing buckets", () => {
  const requirements = collectMatchRequirements(jobData);
  const statuses = Object.fromEntries(requirements.map((item, index) =>
    [item.id, (["matched", "partial", "missing"] as const)[index % 3]]));
  const analysis = createMatchAnalysis(output(statuses), resumeData, jobData);
  const ids = [...analysis.matchedRequirements, ...analysis.partialMatches, ...analysis.missingRequirements].map((item) => item.id);
  assert.equal(ids.length, requirements.length);
  assert.equal(new Set(ids).size, requirements.length);
});

test("final MatchAnalysis rejects one requirement ID appearing in two buckets", () => {
  const valid = createMatchAnalysis(output(), resumeData, jobData);
  const duplicated = { ...valid, partialMatches: [valid.matchedRequirements[0]] };
  assert.throws(() => validateMatchAnalysis(duplicated, resumeData, jobData),
    (error: unknown) => error instanceof MatchValidationError && error.rule === "result_requirements");
});

test("one-click match wrapper retries one invalid AI contract response and no more", async () => {
  let calls = 0;
  const valid = JSON.stringify(output());
  const client = new OpenAI({ apiKey: "fictional-placeholder", baseURL: "https://api.deepseek.com", maxRetries: 0,
    fetch: async () => {
      calls++;
      const text = calls === 1 ? JSON.stringify({ matches: [{ requirementId: "missing-fields" }] }) : valid;
      return Response.json({ id: `resp_${calls}`, object: "response", status: "completed", model: "deepseek-flash", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }] });
    },
  });
  const analysis = await analyzeMatchWithRetry(client, "deepseek-flash", "deepseek", resumeData, jobData);
  assert.equal(calls, 2);
  assert.equal(analysis.matchedRequirements.length, collectMatchRequirements(jobData).length);

  let invalidCalls = 0;
  const invalidClient = new OpenAI({ apiKey: "fictional-placeholder", maxRetries: 0, fetch: async () => {
    invalidCalls++;
    return Response.json({ id: `resp_${invalidCalls}`, object: "response", status: "completed", model: "deepseek-flash", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "{}", annotations: [] }] }] });
  } });
  await assert.rejects(analyzeMatchWithRetry(invalidClient, "deepseek-flash", "deepseek", resumeData, jobData), MatchValidationError);
  assert.equal(invalidCalls, 2);
});

test("fabricated evidence triggers one allowlist-constrained repair and then succeeds", async () => {
  let calls = 0;
  const valid = output();
  const invalid = structuredClone(valid);
  invalid.matches[0].resumeEvidenceIds = ["resume_evidence_from_previous_run_001"];
  const client = new OpenAI({ apiKey: "fictional-placeholder", baseURL: "https://api.deepseek.com", maxRetries: 0,
    fetch: async (_url, options) => {
      calls++;
      const body = JSON.parse(String(options?.body));
      const input = JSON.parse(body.input);
      assert.deepEqual(input.allowedResumeEvidenceIds, collectResumeFacts(resumeData).map((fact) => fact.id));
      if (calls === 2) {
        assert.match(body.instructions, /受约束修复/);
        assert.match(body.instructions, /fabricated_resume_evidence/);
        assert.match(body.instructions, /matches\[0\]\.resumeEvidenceIds/);
      }
      const text = JSON.stringify(calls === 1 ? invalid : valid);
      return Response.json({ id: `resp_${calls}`, object: "response", status: "completed", model: "deepseek-flash", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }] });
    },
  });
  const analysis = await analyzeMatchWithRetry(client, "deepseek-flash", "deepseek", resumeData, jobData);
  assert.equal(calls, 2);
  assert.ok(analysis.matchedRequirements.every((item) => item.resumeEvidence.every((evidence) =>
    collectResumeFacts(resumeData).some((fact) => fact.id === evidence.evidenceId))));
});

test("repair still fails explicitly when fabricated evidence remains", async () => {
  let calls = 0;
  const invalid = output();
  invalid.matches[0].resumeEvidenceIds = ["resume_evidence_never_allowed_001"];
  const client = new OpenAI({ apiKey: "fictional-placeholder", maxRetries: 0, fetch: async () => {
    calls++;
    return Response.json({ id: `resp_${calls}`, object: "response", status: "completed", model: "deepseek-flash", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(invalid), annotations: [] }] }] });
  } });
  await assert.rejects(analyzeMatchWithRetry(client, "deepseek-flash", "deepseek", resumeData, jobData),
    (error: unknown) => error instanceof MatchValidationError && error.rule === "fabricated_resume_evidence");
  assert.equal(calls, 2);
});

test("matched and partial decisions require only current real evidence; missing requires none", () => {
  const requirements = collectMatchRequirements(jobData);
  const statuses = Object.fromEntries(requirements.map((item, index) =>
    [item.id, (index % 3 === 0 ? "matched" : index % 3 === 1 ? "partial" : "missing") as "matched" | "partial" | "missing"]));
  const analysis = createMatchAnalysis(output(statuses), resumeData, jobData);
  const allowed = new Set(collectResumeFacts(resumeData).map((fact) => fact.id));
  assert.ok([...analysis.matchedRequirements, ...analysis.partialMatches].every((item) =>
    item.resumeEvidence.length > 0 && item.resumeEvidence.every((evidence) => allowed.has(evidence.evidenceId))));
  assert.ok(analysis.missingRequirements.every((item) => item.resumeEvidence.length === 0));
});

test("fictional software-testing analysis cannot support a match with invented evidence", () => {
  const testResumeRaw = "示例候选人\n编写接口测试用例";
  const testResume = createResumeData({
    personalInfo: { name: sourced("示例候选人"), phone: null, email: null, location: null, website: null, linkedin: null, github: null, other: [] },
    summary: null, education: [], experience: [], projects: [],
    skills: [{ name: sourced("接口测试"), category: null, description: sourced("编写接口测试用例") }],
    certificates: [], other: [],
  }, testResumeRaw);
  const testJobRaw = "任职要求：熟悉接口测试\n掌握自动化测试框架";
  const testJob = createJobData({
    jobTitle: null, companyName: null, location: null, employmentType: null, salary: null,
    responsibilities: [], requiredSkills: [sourced("熟悉接口测试"), sourced("掌握自动化测试框架")],
    preferredSkills: [], unspecifiedSkills: [], educationRequirements: [], experienceRequirements: [],
    certifications: [], languageRequirements: [], otherRequirements: [], keywords: [],
  }, testJobRaw);
  const [interfaceRequirement, automationRequirement] = collectMatchRequirements(testJob);
  const interfaceEvidence = collectResumeFacts(testResume).find((fact) => fact.value === "接口测试")!;
  const valid = createMatchAnalysis({ matches: [
    { requirementId: interfaceRequirement.id, status: "matched", resumeEvidenceIds: [interfaceEvidence.id], matchReason: "存在直接证据。" },
    { requirementId: automationRequirement.id, status: "missing", resumeEvidenceIds: [], matchReason: "未找到证据。" },
  ] }, testResume, testJob);
  assert.equal(valid.matchedRequirements.length, 1);
  assert.equal(valid.missingRequirements.length, 1);

  const fabricated = { matches: [
    { requirementId: interfaceRequirement.id, status: "matched", resumeEvidenceIds: [interfaceEvidence.id], matchReason: "存在直接证据。" },
    { requirementId: automationRequirement.id, status: "matched", resumeEvidenceIds: ["resume_evidence_invented_001"], matchReason: "错误的虚构证据。" },
  ] };
  assert.throws(() => createMatchAnalysis(fabricated, testResume, testJob),
    (error: unknown) => error instanceof MatchValidationError && error.rule === "fabricated_resume_evidence");
});

test("one-click match wrapper does not retry provider or input failures", async () => {
  let providerCalls = 0;
  const providerClient = new OpenAI({ apiKey: "fictional-placeholder", maxRetries: 0, fetch: async () => {
    providerCalls++;
    return Response.json({ error: { message: "private upstream details", type: "api_error" } }, { status: 500 });
  } });
  await assert.rejects(analyzeMatchWithRetry(providerClient, "deepseek-flash", "deepseek", resumeData, jobData), OpenAI.APIError);
  assert.equal(providerCalls, 1);
  await assert.rejects(analyzeMatchWithRetry(providerClient, "deepseek-flash", "deepseek", { ...resumeData, rawText: "" }, jobData),
    (error: unknown) => error instanceof MatchAnalysisError && error.reason === "input_validation");
  assert.equal(providerCalls, 1);
});

test("request schemas and validation do not accept extra fields", () => {
  assert.equal(analyzeMatchRequestSchema.safeParse({ resumeData, jobData, apiKey: "never" }).success, false);
  assert.throws(() => validateMatchAnalysis({ ...createMatchAnalysis(output(), resumeData, jobData), extra: true }, resumeData, jobData));
});
