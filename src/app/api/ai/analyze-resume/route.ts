import { getAIClient, getAIConfig, getAIError } from "@/lib/ai";
import { analyzeResumeAgainstJob, AnalysisPipelineError, type AnalysisPipelineDependencies } from "@/lib/analysis-pipeline";
import { analyzeMatchWithRetry, MatchAnalysisError } from "@/lib/analyze-match";
import { JobValidationError } from "@/lib/job";
import { MatchValidationError } from "@/lib/match";
import { parseResumeFile, ResumeParseError } from "@/lib/parse-resume";
import { structureJob, JobStructureError } from "@/lib/structure-job";
import { structureResumeWithRetry, ResumeStructureError } from "@/lib/structure-resume";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 180;

function getFailureCategory(error: unknown): string {
  if (error instanceof ResumeStructureError) return error.reason;
  if (error instanceof MatchAnalysisError) return error.reason;
  if (error instanceof OpenAI.APIConnectionTimeoutError) return "timeout";
  if (error instanceof OpenAI.APIConnectionError) return "network";
  if (error instanceof OpenAI.APIError) return "api_error";
  if (error instanceof JobValidationError || error instanceof MatchValidationError) {
    return "schema_validation";
  }
  return "unknown";
}

function getFailureDetail(error: unknown): string {
  if (error instanceof MatchValidationError) {
    const field = error.field ? `；字段：${error.field}` : "";
    return `${field}；规则：${error.rule}`;
  }
  if (!(error instanceof ResumeStructureError)) return "";
  const field = error.field ? `；字段：${error.field}` : "";
  const rule = error.rule ? `；规则：${error.rule}` : "";
  return `${field}${rule}`;
}

function productionDependencies(): AnalysisPipelineDependencies {
  let ai: ReturnType<typeof getAIClient> | undefined;
  let config: ReturnType<typeof getAIConfig> | undefined;
  const resources = () => {
    config ??= getAIConfig();
    ai ??= getAIClient();
    return { client: ai, config };
  };
  return {
    parseResume: parseResumeFile,
    structureResume: async (rawText) => {
      const { client, config } = resources();
      return structureResumeWithRetry(client, config.model, config.provider, rawText);
    },
    structureJob: async (rawText) => {
      const { client, config } = resources();
      return (await structureJob(client, config.model, config.provider, rawText)).data;
    },
    analyzeMatch: async (resumeData, jobData) => {
      const { client, config } = resources();
      return analyzeMatchWithRetry(client, config.model, config.provider, resumeData, jobData);
    },
  };
}

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const failure = (error: string, status: number) => Response.json({ success: false, error }, { status, headers });
  let form: FormData;
  try { form = await request.formData(); }
  catch { return failure("无法读取分析请求，请重新选择简历并检查岗位描述。", 400); }
  const files = form.getAll("file");
  const file = files[0];
  const jobValues = form.getAll("jobText");
  const jobText = jobValues[0];
  if (!(file instanceof File) || files.length !== 1) return failure("请上传一份 PDF 或 DOCX 简历文件。", 400);
  if (typeof jobText !== "string" || jobValues.length !== 1) return failure("请填写目标岗位 JD。", 400);
  try {
    const analysis = await analyzeResumeAgainstJob(file, jobText, productionDependencies());
    return Response.json({ success: true, analysis }, { headers });
  } catch (error: unknown) {
    if (!(error instanceof AnalysisPipelineError)) return failure("分析服务暂时不可用，请稍后重试。", 500);
    const detail = process.env.NODE_ENV === "development"
      ? ` 阶段：${error.stage}；分类：${getFailureCategory(error.cause)}${getFailureDetail(error.cause)}。`
      : "";
    if (error.cause instanceof ResumeParseError) return failure(error.cause.message + detail, error.cause.status);
    if (error.status) return failure(error.message + detail, error.status);
    if (error.stage === "resume_read") return failure(error.message + detail, 422);
    if (error.cause instanceof ResumeStructureError || error.cause instanceof JobStructureError ||
        error.cause instanceof JobValidationError || error.cause instanceof MatchAnalysisError ||
        error.cause instanceof MatchValidationError) {
      return failure(error.message + detail, 422);
    }
    const providerError = getAIError(error.cause);
    return failure(providerError.error + detail, providerError.status);
  }
}
