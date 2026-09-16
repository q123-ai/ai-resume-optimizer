import { jobDataSchema, jobExtractionSchema, type JobData } from "../types/job";

export class JobValidationError extends Error {
  constructor(public readonly stage: "schema" | "sourceText" | "level", public readonly field: string, public readonly rule: string) {
    super("JD 结果未通过结构、原文证据或要求级别验证，请重试并核对原文。");
  }
}

export type JobValidationWarning = {
  field: string;
  rule: "dropped_source_not_found" | "dropped_value_conflict";
};
export type JobValidationResult = { data: JobData; warnings: JobValidationWarning[] };

// Comparison-only normalization. Stored rawText/sourceText/value stay unchanged.
function normalize(text: string): string {
  return text.normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[，、]/g, ",").replace(/[；]/g, ";").replace(/[：]/g, ":")
    .replace(/[。]/g, ".").replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/\s+/gu, " ").trim();
}
const preference = /优先|加分|更佳|\bpreferred\b|\bdesirable\b|nice[ -]to[ -]have|a plus/i;
const qualificationContext = /任职要求|岗位要求|任职资格|必备条件|资格条件|学历要求|专业要求|资格证书要求|证书要求|硬性资格|必备|招聘条件|应聘条件|\brequired\b/i;
const explicitObligation = /必须|须(?!知)|需要|应当|具备|具有|熟悉|精通|熟练(?:掌握|使用)?|掌握|(?:岗位|人员|者)(?:需|应)(?!届)|(?:^|[\s：:、\d.])(?:需|应)(?!求|届)|需(?=具备|持有|满足|取得|符合)|应(?=具备|持有|满足|取得|符合)|要求(?=[：:\s]|应聘|申请|候选|有|具有|具备|满足|持有|取得|符合|达到)|\bmust\b/i;
function hasMandatoryBasis(text: string): boolean {
  // Other requirements is an organizational heading, never an obligation.
  const context = text.replace(/其他要求[：:]?/g, "");
  if (/无需|不需要|不要求|不必|非必须|非必需/.test(context)) return false;
  // Bare 具有/具备 is not enough; it needs a qualification context or command.
  return qualificationContext.test(context) || explicitObligation.test(context);
}
const conditional = /可(?:适当)?放宽|可以放宽|优秀.{0,12}放宽/;
const headingName = "任职要求|岗位要求|任职资格|必备条件|资格条件|专业要求|学历要求|学历|资格证书要求|证书要求|经验要求|其他要求|必备技能|加分技能|优先条件|preferred qualifications|required qualifications";
const headingPattern = new RegExp(`^(?:[#\\s\\d、.（）()一二三四五六七八九十-]*)(${headingName})[：:\\s]*$`, "i");
const inlineHeadingPattern = new RegExp(`^(?:[#\\s\\d、.（）()一二三四五六七八九十-]*)(${headingName})[：:]\\s*(.+)$`, "i");

function contextFor(source: string, rawText: string): string[] {
  const contexts: string[] = [];
  let heading = "";
  for (const line of rawText.split(/\r\n?|\n/)) {
    const inlineHeading = inlineHeadingPattern.exec(line);
    let content = line;
    if (inlineHeading) {
      heading = inlineHeading[1];
      content = inlineHeading[2];
    } else if (headingPattern.test(line)) {
      heading = line;
      content = "";
    } else {
      const otherSection = /^[^：:]{1,40}[：:]\s*(.*)$/.exec(line.trim());
      if (otherSection) {
        heading = "";
        content = otherSection[1];
      }
    }
    // Comma-separated clauses keep adjacent mandatory/preferred items apart.
    for (const clause of content.split(/[，,；;。]/)) {
      if (normalize(clause).includes(source)) contexts.push(`${heading} ${clause}`);
    }
  }
  return contexts.length ? contexts : [source];
}

function obviousValueConflict(value: string, sourceText: string): boolean {
  const tokens = (text: string) => normalize(text).match(/[A-Za-z][A-Za-z0-9+#.]*/g)?.map((token) => token.toLowerCase()) ?? [];
  const valueTokens = tokens(value);
  const sourceTokens = new Set(tokens(sourceText));
  return valueTokens.length > 0 && sourceTokens.size > 0 && valueTokens.some((token) => !sourceTokens.has(token));
}

function evidenceRule(value: SourcedText, rawText: string): "source_not_found" | "value_conflict" | null {
  const source = normalize(value.sourceText);
  if (!source || !normalize(rawText).includes(source)) return "source_not_found";
  if (!normalize(value.value)) return "value_conflict";
  return obviousValueConflict(value.value, value.sourceText) ? "value_conflict" : null;
}

function checkEvidence(value: unknown, rawText: string, path = ""): void {
  if (Array.isArray(value)) value.forEach((item, index) => checkEvidence(item, rawText, `${path}[${index}]`));
  else if (typeof value === "object" && value !== null) {
    if ("sourceText" in value && "value" in value && typeof value.sourceText === "string" && typeof value.value === "string") {
      const rule = evidenceRule(value as SourcedText, rawText);
      if (rule === "source_not_found") throw new JobValidationError("sourceText", `${path}.sourceText`, rule);
      if (rule === "value_conflict") throw new JobValidationError("sourceText", `${path}.value`, rule);
    }
    Object.entries(value).forEach(([key, item]) => checkEvidence(item, rawText, path ? `${path}.${key}` : key));
  }
}

type Priority = "required" | "preferred" | "unspecified";
type SourcedText = { value: string; sourceText: string };

function deterministicPriority(item: SourcedText, rawText: string): Priority {
  const source = normalize(item.sourceText);
  const contexts = contextFor(source, rawText);
  if (preference.test(source) || contexts.some((context) => preference.test(context))) return "preferred";
  const conditionalSentence = rawText.split(/[\n；;。]/).some((sentence) => normalize(sentence).includes(source) && conditional.test(sentence));
  if (conditional.test(source) || contexts.some((context) => conditional.test(context)) || conditionalSentence) return "unspecified";
  if (hasMandatoryBasis(source) || contexts.some(hasMandatoryBasis)) return "required";
  return "unspecified";
}

function normalizeLevels(data: JobData): JobData {
  const skills = [...data.requiredSkills, ...data.preferredSkills, ...data.unspecifiedSkills];
  const grouped: Record<Priority, SourcedText[]> = { required: [], preferred: [], unspecified: [] };
  const seen = new Set<string>();
  for (const skill of skills) {
    const key = `${normalize(skill.value)}\0${normalize(skill.sourceText)}`;
    if (!seen.has(key)) grouped[deterministicPriority(skill, data.rawText)].push(skill);
    seen.add(key);
  }
  const normalizeRequirements = <T extends SourcedText & { priority: Priority }>(items: T[]) =>
    items.map((item) => ({ ...item, priority: deterministicPriority(item, data.rawText) }));
  return {
    ...data,
    requiredSkills: grouped.required,
    preferredSkills: grouped.preferred,
    unspecifiedSkills: grouped.unspecified,
    educationRequirements: normalizeRequirements(data.educationRequirements),
    experienceRequirements: normalizeRequirements(data.experienceRequirements),
    certifications: normalizeRequirements(data.certifications),
    languageRequirements: normalizeRequirements(data.languageRequirements),
    otherRequirements: normalizeRequirements(data.otherRequirements),
  };
}

function sanitizeAuxiliary(data: JobData): JobValidationResult {
  const warnings: JobValidationWarning[] = [];
  let invalid = 0;
  const keep = (items: SourcedText[], field: string) => items.filter((item, index) => {
    const rule = evidenceRule(item, data.rawText);
    if (!rule) return true;
    invalid++;
    warnings.push({ field: `${field}[${index}]`, rule: rule === "source_not_found" ? "dropped_source_not_found" : "dropped_value_conflict" });
    return false;
  });
  const sanitized: JobData = {
    ...data,
    requiredSkills: keep(data.requiredSkills, "requiredSkills"),
    preferredSkills: keep(data.preferredSkills, "preferredSkills"),
    unspecifiedSkills: keep(data.unspecifiedSkills, "unspecifiedSkills"),
    keywords: keep(data.keywords, "keywords"),
  };
  const countSourced = (value: unknown): number => {
    if (Array.isArray(value)) return value.reduce((total, item) => total + countSourced(item), 0);
    if (typeof value !== "object" || value === null) return 0;
    if ("sourceText" in value && "value" in value) return 1;
    return Object.values(value).reduce((total, item) => total + countSourced(item), 0);
  };
  const groundedCount = countSourced(sanitized);
  if (groundedCount === 0) throw new JobValidationError("sourceText", "root", "no_grounded_content");
  if (invalid >= 3 && invalid > groundedCount) throw new JobValidationError("sourceText", "root", "too_many_invalid_evidence");
  return { data: sanitized, warnings };
}

const knownFields = new Set([...Object.keys(jobDataSchema.shape), "value", "sourceText", "priority"]);
function schemaFailure(path: readonly PropertyKey[], code: string): JobValidationError {
  const field = path.map((key) => typeof key === "number" ? `[${key}]` : knownFields.has(String(key)) ? String(key) : "field").join(".").replace(/\.\[/g, "[") || "root";
  return new JobValidationError("schema", field, code);
}

export function validateJobData(input: unknown): JobData {
  return validateJobDataWithWarnings(input).data;
}

export function validateJobDataWithWarnings(input: unknown): JobValidationResult {
  const result = jobDataSchema.safeParse(input);
  if (!result.success) throw schemaFailure(result.error.issues[0].path, result.error.issues[0].code);
  const sanitized = sanitizeAuxiliary(result.data);
  checkEvidence(sanitized.data, sanitized.data.rawText);
  return { data: normalizeLevels(sanitized.data), warnings: sanitized.warnings };
}

export function createJobData(input: unknown, rawText: string): JobData {
  return createJobDataWithWarnings(input, rawText).data;
}

export function createJobDataWithWarnings(input: unknown, rawText: string): JobValidationResult {
  const result = jobExtractionSchema.safeParse(input);
  if (!result.success) throw schemaFailure(result.error.issues[0].path, result.error.issues[0].code);
  return validateJobDataWithWarnings({ ...result.data, rawText });
}
