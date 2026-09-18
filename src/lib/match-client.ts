import type { JobData } from "../types/job";
import type { MatchAnalysis } from "../types/match";
import type { ResumeData } from "../types/resume";
import { validateJobData } from "./job";
import { validateMatchAnalysis } from "./match";
import { validateResumeData } from "./resume";

export class MatchClientError extends Error {}

export async function requestMatchAnalysis(
  resumeInput: ResumeData,
  jobInput: JobData,
  signal?: AbortSignal,
  request: typeof fetch = fetch,
): Promise<MatchAnalysis> {
  let resumeData: ResumeData;
  let jobData: JobData;
  try { resumeData = validateResumeData(resumeInput); }
  catch { throw new MatchClientError("结构化简历无效，请重新生成后再分析。"); }
  try { jobData = validateJobData(jobInput); }
  catch { throw new MatchClientError("结构化 JD 无效，请重新解析后再分析。"); }

  let response: Response;
  try {
    response = await request("/api/ai/analyze-match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resumeData, jobData }),
      signal,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new MatchClientError("无法连接匹配分析服务，请检查网络后重试。");
  }
  let result: unknown;
  try { result = await response.json(); }
  catch { throw new MatchClientError("匹配分析服务返回了无法读取的结果，请稍后重试。"); }
  if (typeof result !== "object" || result === null || !("success" in result)) {
    throw new MatchClientError("匹配分析服务返回格式异常，请稍后重试。");
  }
  if (!response.ok || result.success !== true || !("analysis" in result)) {
    throw new MatchClientError("error" in result && typeof result.error === "string" ? result.error : "匹配分析请求失败，请稍后重试。");
  }
  try { return validateMatchAnalysis(result.analysis, resumeData, jobData); }
  catch { throw new MatchClientError("匹配分析结果未通过本地一致性验证，请重试。"); }
}
