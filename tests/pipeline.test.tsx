import { test } from "node:test";
import assert from "node:assert/strict";
import { AnalysisPipelineError, analyzeResumeAgainstJob, type AnalysisPipelineDependencies } from "../src/lib/analysis-pipeline";
import { createJobData } from "../src/lib/job";
import { collectMatchRequirements, collectResumeFacts, createMatchAnalysis } from "../src/lib/match";
import { AnalysisRequestGate, PipelineClientError, requestAnalysisPipeline } from "../src/lib/pipeline-client";
import { createResumeData } from "../src/lib/resume";
import type { JobExtraction } from "../src/types/job";
import type { ResumeExtraction } from "../src/types/resume";

// Fictional test content only. Parser libraries and external AI services are never called.
const resumeRaw = "示例候选人\n熟练使用 Excel";
const jobRaw = "任职要求：熟练使用 Excel\n关键词：Excel";
const sourced = (value: string) => ({ value, sourceText: value });
const resumeExtraction: ResumeExtraction = {
  personalInfo: { name: sourced("示例候选人"), phone: null, email: null, location: null, website: null, linkedin: null, github: null, other: [] },
  summary: null, education: [], experience: [], projects: [],
  skills: [{ name: sourced("Excel"), category: null, description: sourced("熟练使用 Excel") }],
  certificates: [], other: [],
};
const jobExtraction: JobExtraction = {
  jobTitle: null, companyName: null, location: null, employmentType: null, salary: null,
  responsibilities: [], requiredSkills: [sourced("任职要求：熟练使用 Excel")], preferredSkills: [], unspecifiedSkills: [],
  educationRequirements: [], experienceRequirements: [], certifications: [], languageRequirements: [], otherRequirements: [],
  keywords: [sourced("Excel")],
};
const resumeData = createResumeData(resumeExtraction, resumeRaw);
const jobData = createJobData(jobExtraction, jobRaw);
const requirement = collectMatchRequirements(jobData)[0];
const evidence = collectResumeFacts(resumeData).find((fact) => fact.value === "Excel")!;
const analysis = createMatchAnalysis({ matches: [{ requirementId: requirement.id, status: "matched", resumeEvidenceIds: [evidence.id], matchReason: "简历证据直接支持该技能要求。" }] }, resumeData, jobData);

type Calls = { parse: number; resume: number; job: number; match: number };
function dependencies(fail?: keyof Calls) {
  const calls: Calls = { parse: 0, resume: 0, job: 0, match: 0 };
  const deps: AnalysisPipelineDependencies = {
    parseResume: async (file) => {
      calls.parse++;
      if (fail === "parse") throw new Error("fictional parse failure");
      return { fileName: file.name, fileType: file.name.endsWith(".pdf") ? "pdf" : "docx", text: resumeRaw, characterCount: resumeRaw.length };
    },
    structureResume: async (rawText) => {
      calls.resume++;
      assert.equal(rawText, resumeRaw);
      if (fail === "resume") throw new Error("fictional resume failure");
      return resumeData;
    },
    structureJob: async (rawText) => {
      calls.job++;
      assert.equal(rawText, jobRaw);
      if (fail === "job") throw new Error("fictional job failure");
      return jobData;
    },
    analyzeMatch: async (resume, job) => {
      calls.match++;
      assert.equal(resume, resumeData);
      assert.equal(job, jobData);
      if (fail === "match") throw new Error("fictional match failure");
      return analysis;
    },
  };
  return { calls, deps };
}

for (const [name, type] of [["resume.pdf", "application/pdf"], ["resume.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]] as const) {
  test(`one-click pipeline accepts a valid ${name.split(".").pop()?.toUpperCase()} and returns MatchAnalysis`, async () => {
    const { calls, deps } = dependencies();
    const result = await analyzeResumeAgainstJob(new File(["fictional bytes"], name, { type }), jobRaw, deps);
    assert.deepEqual(result, analysis);
    assert.deepEqual(calls, { parse: 1, resume: 1, job: 1, match: 1 });
  });
}

test("invalid resume file and empty JD stop before every pipeline stage", async () => {
  const invalidFile = dependencies();
  await assert.rejects(analyzeResumeAgainstJob(new File(["x"], "resume.txt", { type: "text/plain" }), jobRaw, invalidFile.deps), (error: unknown) => error instanceof AnalysisPipelineError && error.stage === "resume_read");
  assert.deepEqual(invalidFile.calls, { parse: 0, resume: 0, job: 0, match: 0 });
  const emptyJD = dependencies();
  await assert.rejects(analyzeResumeAgainstJob(new File(["x"], "resume.pdf", { type: "application/pdf" }), "  ", emptyJD.deps), (error: unknown) => error instanceof AnalysisPipelineError && error.stage === "job_structure");
  assert.deepEqual(emptyJD.calls, { parse: 0, resume: 0, job: 0, match: 0 });
});

test("each failed stage prevents every later stage from running", async () => {
  const expected: Array<[keyof Calls, Calls, string]> = [
    ["parse", { parse: 1, resume: 0, job: 0, match: 0 }, "resume_read"],
    ["resume", { parse: 1, resume: 1, job: 0, match: 0 }, "resume_structure"],
    ["job", { parse: 1, resume: 1, job: 1, match: 0 }, "job_structure"],
    ["match", { parse: 1, resume: 1, job: 1, match: 1 }, "match_analysis"],
  ];
  for (const [failure, calls, stage] of expected) {
    const setup = dependencies(failure);
    await assert.rejects(analyzeResumeAgainstJob(new File(["x"], "resume.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), jobRaw, setup.deps),
      (error: unknown) => error instanceof AnalysisPipelineError && error.stage === stage);
    assert.deepEqual(setup.calls, calls);
  }
});

test("request gate rejects duplicate starts and invalidates stale file or JD requests", () => {
  const gate = new AnalysisRequestGate();
  const first = gate.start();
  assert.ok(first);
  assert.equal(gate.start(), null);
  gate.invalidate();
  assert.equal(first.controller.signal.aborted, true);
  assert.equal(gate.isCurrent(first), false);
  const afterFileChange = gate.start();
  assert.ok(afterFileChange);
  assert.notEqual(afterFileChange.id, first.id);
  gate.invalidate();
  assert.equal(afterFileChange.controller.signal.aborted, true);
  const afterJDChange = gate.start();
  assert.ok(afterJDChange);
  assert.equal(gate.finish(first), false);
  assert.equal(gate.isCurrent(afterJDChange), true);
  assert.equal(gate.finish(afterJDChange), true);
});

test("a failed run is discarded and the next run executes the full pipeline from current inputs", async () => {
  const calls: Calls = { parse: 0, resume: 0, job: 0, match: 0 };
  const receivedResumeTexts: string[] = [];
  const deps: AnalysisPipelineDependencies = {
    parseResume: async (file) => {
      calls.parse++;
      const text = file.name.startsWith("first") ? "第一次虚构简历" : resumeRaw;
      return { fileName: file.name, fileType: "docx", text, characterCount: text.length };
    },
    structureResume: async (text) => {
      calls.resume++;
      receivedResumeTexts.push(text);
      if (calls.resume === 1) throw new Error("fictional first-run failure");
      return resumeData;
    },
    structureJob: async (text) => { calls.job++; assert.equal(text, jobRaw); return jobData; },
    analyzeMatch: async (resume, job) => { calls.match++; assert.equal(resume, resumeData); assert.equal(job, jobData); return analysis; },
  };
  const type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  await assert.rejects(analyzeResumeAgainstJob(new File(["x"], "first.docx", { type }), jobRaw, deps),
    (error: unknown) => error instanceof AnalysisPipelineError && error.stage === "resume_structure");
  assert.deepEqual(calls, { parse: 1, resume: 1, job: 0, match: 0 });
  const result = await analyzeResumeAgainstJob(new File(["x"], "second.docx", { type }), jobRaw, deps);
  assert.deepEqual(result, analysis);
  assert.deepEqual(receivedResumeTexts, ["第一次虚构简历", resumeRaw]);
  assert.deepEqual(calls, { parse: 2, resume: 2, job: 1, match: 1 });
});

test("resume structuring receives identical resume text for matching, partial and unrelated JDs", async () => {
  const jobTexts = [
    "任职要求：熟练使用 Excel",
    "任职要求：了解 Excel 和 Python",
    "岗位要求：负责示例餐品制作",
  ];
  const resumeInputs: string[] = [];
  const resumeSnapshots: typeof resumeData[] = [];
  const deps: AnalysisPipelineDependencies = {
    parseResume: async (file) => ({ fileName: file.name, fileType: "docx", text: resumeRaw, characterCount: resumeRaw.length }),
    structureResume: async (text) => { resumeInputs.push(text); return resumeData; },
    structureJob: async () => jobData,
    analyzeMatch: async (resume) => { resumeSnapshots.push(resume); return analysis; },
  };
  const file = new File(["fictional bytes"], "resume.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  for (const jobText of jobTexts) await analyzeResumeAgainstJob(file, jobText, deps);
  assert.deepEqual(resumeInputs, [resumeRaw, resumeRaw, resumeRaw]);
  assert.deepEqual(resumeSnapshots, [resumeData, resumeData, resumeData]);
});

test("pipeline client sends the newest file and JD once and validates the response", async () => {
  const file = new File(["new fictional resume"], "new-resume.pdf", { type: "application/pdf" });
  let calls = 0;
  const result = await requestAnalysisPipeline(file, jobRaw, undefined, async (url, options) => {
    calls++;
    assert.equal(url, "/api/ai/analyze-resume");
    assert.equal(options?.method, "POST");
    const form = options?.body;
    assert.ok(form instanceof FormData);
    assert.equal((form.get("file") as File).name, "new-resume.pdf");
    assert.equal(form.get("jobText"), jobRaw);
    return Response.json({ success: true, analysis });
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, analysis);
});

test("pipeline client shows HTTP, network, malformed JSON and malformed analysis errors", async () => {
  const file = new File(["x"], "resume.pdf", { type: "application/pdf" });
  await assert.rejects(requestAnalysisPipeline(file, jobRaw, undefined, async () => Response.json({ success: false, error: "简历内容解析失败，请重试。" }, { status: 422 })), /简历内容解析失败/);
  await assert.rejects(requestAnalysisPipeline(file, jobRaw, undefined, async () => { throw new Error("offline"); }), PipelineClientError);
  await assert.rejects(requestAnalysisPipeline(file, jobRaw, undefined, async () => new Response("invalid")), /无法读取/);
  await assert.rejects(requestAnalysisPipeline(file, jobRaw, undefined, async () => Response.json({ success: true, analysis: {} })), /验证失败/);
});
