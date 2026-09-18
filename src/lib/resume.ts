import { resumeDataSchema, resumeExtractionSchema, type ResumeData } from "../types/resume";

export class ResumeValidationError extends Error {
  constructor(
    public readonly stage: "schema" | "sourceText" | "id",
    public readonly field: string,
    public readonly rule: string,
  ) {
    super("简历结果未通过结构或原文证据验证，请重试并核对原文。");
  }
}

type NormalizedText = { text: string; starts: number[]; ends: number[] };
const punctuation = new Map([
  ["，", ","], ["、", ","], ["；", ";"], ["：", ":"], ["。", "."],
  ["“", '"'], ["”", '"'], ["‘", "'"], ["’", "'"],
]);
const ignoredFormat = /[\u200B-\u200D\u2060\uFEFF]/u;
const bullet = /[•·●▪◦]/u;

// Comparison-only normalization with an index map back to the untouched rawText.
function normalizeWithMap(input: string): NormalizedText {
  const text: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const clusters = input.matchAll(/\P{M}\p{M}*|\p{M}+/gu);
  for (const match of clusters) {
    const start = match.index;
    const end = start + match[0].length;
    for (const character of match[0].normalize("NFKC")) {
      if (ignoredFormat.test(character)) continue;
      const normalized = bullet.test(character) || /\s/u.test(character)
        ? " "
        : punctuation.get(character) ?? character;
      if (normalized === " " && text.at(-1) === " ") {
        ends[ends.length - 1] = end;
        continue;
      }
      text.push(normalized);
      starts.push(start);
      ends.push(end);
    }
  }
  while (text[0] === " ") { text.shift(); starts.shift(); ends.shift(); }
  while (text.at(-1) === " ") { text.pop(); starts.pop(); ends.pop(); }
  return { text: text.join(""), starts, ends };
}

function findOriginalExcerpt(rawText: string, candidate: string): string | null {
  if (!candidate.trim()) return null;
  const exact = rawText.indexOf(candidate);
  if (exact >= 0) return rawText.slice(exact, exact + candidate.length);
  const raw = normalizeWithMap(rawText);
  const normalizedCandidate = normalizeWithMap(candidate).text;
  if (!normalizedCandidate) return null;
  const index = raw.text.indexOf(normalizedCandidate);
  if (index < 0) return null;
  return rawText.slice(raw.starts[index], raw.ends[index + normalizedCandidate.length - 1]);
}

function fieldPath(path: string, field: string): string {
  return path ? `${path}.${field}` : field;
}

function groundSources(value: unknown, rawText: string, path = ""): unknown {
  if (Array.isArray(value)) return value.map((item, index) => groundSources(item, rawText, `${path}[${index}]`));
  if (typeof value !== "object" || value === null) return value;
  const object = value as Record<string, unknown>;
  if (typeof object.sourceText === "string" && typeof object.value === "string") {
    const sourceText = findOriginalExcerpt(rawText, object.sourceText);
    if (!sourceText) throw new ResumeValidationError("sourceText", fieldPath(path, "sourceText"), "source_not_found");
    const groundedValue = findOriginalExcerpt(sourceText, object.value);
    if (!groundedValue) throw new ResumeValidationError("sourceText", fieldPath(path, "value"), "value_not_in_source");
    return { ...object, value: groundedValue, sourceText };
  }
  return Object.fromEntries(Object.entries(object).map(([key, item]) =>
    [key, groundSources(item, rawText, fieldPath(path, key))]));
}

const knownFields = new Set([
  ...Object.keys(resumeDataSchema.shape), "value", "sourceText", "id", "name", "phone", "email",
  "location", "website", "linkedin", "github", "school", "degree", "major", "startDate", "endDate",
  "description", "company", "position", "role", "technologies", "category", "issuer", "date", "title", "content",
]);
function schemaFailure(path: readonly PropertyKey[], code: string): ResumeValidationError {
  const field = path.map((key) => typeof key === "number" ? `[${key}]` : knownFields.has(String(key)) ? String(key) : "field")
    .join(".").replace(/\.\[/g, "[") || "root";
  return new ResumeValidationError("schema", field, code);
}

// Validates shape, source excerpts and unique IDs. It cannot prove semantic truth.
export function validateResumeData(input: unknown): ResumeData {
  const result = resumeDataSchema.safeParse(input);
  if (!result.success) throw schemaFailure(result.error.issues[0].path, result.error.issues[0].code);
  const data = groundSources(result.data, result.data.rawText) as ResumeData;
  const entries = [...data.education, ...data.experience, ...data.projects,
    ...data.skills, ...data.certificates, ...data.other];
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new ResumeValidationError("id", "id", "duplicate_id");
  }
  return data;
}

// Call once when extraction is confirmed. Preserve these IDs on edits/reordering;
// creating a new ResumeData again is a new snapshot, not reconciliation.
export function createResumeData(input: unknown, rawText: string): ResumeData {
  const result = resumeExtractionSchema.safeParse(input);
  if (!result.success) throw schemaFailure(result.error.issues[0].path, result.error.issues[0].code);
  const extracted = result.data;
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
