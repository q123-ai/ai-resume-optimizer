import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { createResumeData, validateResumeData } from "../src/lib/resume";
import { resumeExtractionSchema, type ResumeExtraction } from "../src/types/resume";

// Entirely fictional data; never replace with a real user's resume.
const rawText = "张三\nexample@example.com\n示例大学 本科 2023.09 至今\n示例科技有限公司\n示例项目\nExcel\n示例证书\n志愿活动";
const sourced = (value: string) => ({ value, sourceText: value });
const empty: ResumeExtraction = {
  personalInfo: { name: null, phone: null, email: null, location: null,
    website: null, linkedin: null, github: null, other: [] },
  summary: null, education: [], experience: [], projects: [], skills: [], certificates: [], other: [],
};
const extracted: ResumeExtraction = {
  ...empty,
  personalInfo: { ...empty.personalInfo, name: sourced("张三"), email: sourced("example@example.com") },
  education: [{ school: sourced("示例大学"), degree: sourced("本科"), major: null,
    startDate: sourced("2023.09"), endDate: sourced("至今"), description: [] }],
  experience: [{ company: sourced("示例科技有限公司"), position: null,
    startDate: null, endDate: null, location: null, description: [] }],
  projects: [{ name: sourced("示例项目"), role: null, startDate: null,
    endDate: null, description: [], technologies: [] }],
  skills: [{ name: sourced("Excel"), category: "办公软件", description: null }],
  certificates: [{ name: sourced("示例证书"), issuer: null, date: null, description: [] }],
  other: [{ title: "其他活动", content: sourced("志愿活动") }],
};

test("missing sections stay empty; rawText belongs to the program", () => {
  const data = createResumeData(empty, rawText);
  assert.equal(data.summary, null);
  assert.deepEqual(data.experience, []);
  assert.equal(data.rawText, rawText);
  assert.equal(resumeExtractionSchema.safeParse({ ...empty, rawText }).success, false);
});

test("program generates unique IDs for all entries; validation preserves them", () => {
  const data = createResumeData(extracted, rawText);
  const entries = [...data.education, ...data.experience, ...data.projects,
    ...data.skills, ...data.certificates, ...data.other];
  assert.equal(new Set(entries.map((entry) => entry.id)).size, 6);
  assert.equal(validateResumeData(JSON.parse(JSON.stringify(data))).education[0].id, data.education[0].id);
  assert.equal(resumeExtractionSchema.safeParse({ ...extracted, education: data.education }).success, false);
  assert.throws(() => validateResumeData({ ...data, skills: [{ ...data.skills[0], id: data.education[0].id }] }));
});

test("dates retain original text and field evidence", () => {
  const data = createResumeData(extracted, rawText);
  assert.deepEqual(data.education[0].startDate, sourced("2023.09"));
  assert.deepEqual(data.education[0].endDate, sourced("至今"));
  const dated = { ...extracted, certificates: [{ ...extracted.certificates[0], date: sourced("2024年3月") }] };
  assert.equal(createResumeData(dated, rawText + "\n2024年3月").certificates[0].date?.value, "2024年3月");
});

test("rejects missing/fabricated/blank source excerpts and malformed fields", () => {
  const data = createResumeData(extracted, rawText);
  assert.throws(() => validateResumeData({ ...data, summary: sourced("原文不存在的内容") }));
  assert.throws(() => validateResumeData({ ...data, summary: { value: "内容", sourceText: " " } }));
  assert.equal(resumeExtractionSchema.safeParse({ ...empty, summary: { value: "内容" } }).success, false);
  assert.equal(resumeExtractionSchema.safeParse({ ...empty, skills: "Excel" }).success, false);
  assert.equal(resumeExtractionSchema.safeParse({ ...empty, unknownField: true }).success, false);
});

test("IDs survive editing and reordering without regeneration", () => {
  const data = createResumeData({ ...extracted, skills: [...extracted.skills,
    { name: sourced("Python"), category: null, description: null }] }, rawText + "\nPython");
  const originalIds = data.skills.map((entry) => entry.id);
  data.skills.reverse();
  data.skills[0].category = "编程语言";
  assert.deepEqual(validateResumeData(data).skills.map((entry) => entry.id), originalIds.reverse());
});

test("extraction schema exports strict JSON Schema without AI-owned IDs", () => {
  const schema = z.toJSONSchema(resumeExtractionSchema);
  assert.equal(schema.additionalProperties, false);
  assert.equal("rawText" in (schema.properties ?? {}), false);
  assert.ok(schema.required?.includes("summary"));
});
