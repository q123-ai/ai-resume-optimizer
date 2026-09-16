import { validateJobDataWithWarnings } from "./job";
import type { JobData } from "../types/job";
import type { JobValidationWarning } from "./job";

export class JobClientError extends Error {}

export function getJobInputError(rawText: string): string | null {
  if (!rawText.trim()) return "请先输入岗位 JD。";
  if (rawText.length > 20_000) return "岗位 JD 最多 20000 个字符。";
  return null;
}

export async function requestStructuredJob(
  rawText: string,
  signal?: AbortSignal,
  request: typeof fetch = fetch,
): Promise<{ data: JobData; warnings: JobValidationWarning[] }> {
  let response: Response;
  try {
    response = await request("/api/ai/structure-job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText }),
      signal,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new JobClientError("无法连接 JD 结构化服务，请检查网络后重试。");
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new JobClientError("JD 结构化服务返回了无法读取的结果，请稍后重试。");
  }
  if (typeof result !== "object" || result === null || !("success" in result)) {
    throw new JobClientError("JD 结构化服务返回格式异常，请稍后重试。");
  }
  if (!response.ok || result.success !== true || !("jobData" in result)) {
    throw new JobClientError("error" in result && typeof result.error === "string" ? result.error : "JD 结构化服务请求失败，请稍后重试。");
  }

  const validation = validateJobDataWithWarnings(result.jobData);
  const data = validation.data;
  if (data.rawText !== rawText) throw new JobClientError("JD 结构化结果与当前原文不一致，请重试。");
  const warnings = "warnings" in result && Array.isArray(result.warnings)
    ? result.warnings.filter((warning): warning is JobValidationWarning =>
      typeof warning === "object" && warning !== null &&
      "field" in warning && typeof warning.field === "string" &&
      "rule" in warning && (warning.rule === "dropped_source_not_found" || warning.rule === "dropped_value_conflict"))
    : [];
  return { data, warnings: [...warnings, ...validation.warnings] };
}
