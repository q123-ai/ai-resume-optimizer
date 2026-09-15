import { resumeDataSchema, resumeExtractionSchema, type ResumeData } from "../types/resume";

function checkSources(value: unknown, rawText: string): void {
  if (Array.isArray(value)) {
    value.forEach((item) => checkSources(item, rawText));
  } else if (typeof value === "object" && value !== null) {
    if ("sourceText" in value && typeof value.sourceText === "string" &&
        (!value.sourceText.trim() || !rawText.includes(value.sourceText))) {
      throw new Error("来源证据必须是原始简历中的非空原文片段。");
    }
    Object.values(value).forEach((item) => checkSources(item, rawText));
  }
}

// Validates shape, source excerpts and unique IDs. It cannot prove semantic truth.
export function validateResumeData(input: unknown): ResumeData {
  const data = resumeDataSchema.parse(input);
  checkSources(data, data.rawText);
  const entries = [...data.education, ...data.experience, ...data.projects,
    ...data.skills, ...data.certificates, ...data.other];
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new Error("简历条目的 ID 不能重复。");
  }
  return data;
}

// Call once when extraction is confirmed. Preserve these IDs on edits/reordering;
// creating a new ResumeData again is a new snapshot, not reconciliation.
export function createResumeData(input: unknown, rawText: string): ResumeData {
  const extracted = resumeExtractionSchema.parse(input);
  return validateResumeData({
    ...extracted,
    rawText,
    education: extracted.education.map((entry) => ({ ...entry, id: crypto.randomUUID() })),
    experience: extracted.experience.map((entry) => ({ ...entry, id: crypto.randomUUID() })),
    projects: extracted.projects.map((entry) => ({ ...entry, id: crypto.randomUUID() })),
    skills: extracted.skills.map((entry) => ({ ...entry, id: crypto.randomUUID() })),
    certificates: extracted.certificates.map((entry) => ({ ...entry, id: crypto.randomUUID() })),
    other: extracted.other.map((entry) => ({ ...entry, id: crypto.randomUUID() })),
  });
}
