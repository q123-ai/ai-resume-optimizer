import { matchAnalysisSchema, type MatchAnalysis } from "../types/match";

export class PipelineClientError extends Error {}

export type AnalysisRun = Readonly<{ id: number; controller: AbortController }>;

export class AnalysisRequestGate {
  private active: AnalysisRun | null = null;
  private nextId = 1;

  start(): AnalysisRun | null {
    if (this.active) return null;
    this.active = { id: this.nextId++, controller: new AbortController() };
    return this.active;
  }

  isCurrent(run: AnalysisRun): boolean {
    return this.active?.id === run.id && !run.controller.signal.aborted;
  }

  finish(run: AnalysisRun): boolean {
    if (this.active?.id !== run.id) return false;
    this.active = null;
    return true;
  }

  invalidate(): void {
    this.active?.controller.abort();
    this.active = null;
  }
}

export async function requestAnalysisPipeline(
  file: File,
  jobText: string,
  signal?: AbortSignal,
  request: typeof fetch = fetch,
): Promise<MatchAnalysis> {
  const form = new FormData();
  form.append("file", file);
  form.append("jobText", jobText);
  let response: Response;
  try { response = await request("/api/ai/analyze-resume", { method: "POST", body: form, signal }); }
  catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new PipelineClientError("无法连接分析服务，请检查网络后重试。");
  }
  let result: unknown;
  try { result = await response.json(); }
  catch { throw new PipelineClientError("分析服务返回了无法读取的结果，请稍后重试。"); }
  if (typeof result !== "object" || result === null || !("success" in result)) {
    throw new PipelineClientError("分析服务返回格式异常，请稍后重试。");
  }
  if (!response.ok || result.success !== true || !("analysis" in result)) {
    throw new PipelineClientError("error" in result && typeof result.error === "string" ? result.error : "分析请求失败，请稍后重试。");
  }
  const analysis = matchAnalysisSchema.safeParse(result.analysis);
  if (!analysis.success) throw new PipelineClientError("分析结果验证失败，请重新尝试。");
  return analysis.data;
}
