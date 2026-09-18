import "server-only";
import type { JobData } from "../types/job";
import type { MatchAnalysis } from "../types/match";
import type { ResumeData } from "../types/resume";
import { structureJobRequestSchema } from "./structure-job";
import { validateResumeFile, type ParsedResume } from "./parse-resume";

export type PipelineStage = "resume_read" | "resume_structure" | "job_structure" | "match_analysis";

export class AnalysisPipelineError extends Error {
  constructor(public readonly stage: PipelineStage, message: string, public readonly cause: unknown, public readonly status?: number) {
    super(message);
  }
}

export type AnalysisPipelineDependencies = {
  parseResume(file: File): Promise<ParsedResume>;
  structureResume(rawText: string): Promise<ResumeData>;
  structureJob(rawText: string): Promise<JobData>;
  analyzeMatch(resumeData: ResumeData, jobData: JobData): Promise<MatchAnalysis>;
};

export async function analyzeResumeAgainstJob(
  file: File,
  rawJobText: string,
  dependencies: AnalysisPipelineDependencies,
): Promise<MatchAnalysis> {
  try { validateResumeFile(file); }
  catch (error: unknown) { throw new AnalysisPipelineError("resume_read", "简历读取失败，请确认文件格式。", error); }
  const jobInput = structureJobRequestSchema.safeParse({ rawText: rawJobText });
  if (!jobInput.success) throw new AnalysisPipelineError("job_structure", "岗位信息无效，请检查岗位描述和长度。", jobInput.error, 400);

  let parsed: ParsedResume;
  try { parsed = await dependencies.parseResume(file); }
  catch (error: unknown) { throw new AnalysisPipelineError("resume_read", "简历读取失败，请确认文件格式。", error); }

  let resumeData: ResumeData;
  try { resumeData = await dependencies.structureResume(parsed.text); }
  catch (error: unknown) { throw new AnalysisPipelineError("resume_structure", "简历内容解析失败，请重试。", error); }

  let jobData: JobData;
  try { jobData = await dependencies.structureJob(jobInput.data.rawText); }
  catch (error: unknown) { throw new AnalysisPipelineError("job_structure", "岗位信息解析失败，请检查岗位描述。", error); }

  try { return await dependencies.analyzeMatch(resumeData, jobData); }
  catch (error: unknown) { throw new AnalysisPipelineError("match_analysis", "分析结果验证失败，请重新尝试。", error); }
}
