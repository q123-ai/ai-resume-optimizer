import { getAIClient, getAIConfig, getAIError } from "@/lib/ai";
import { analyzeMatchWithRetry, analyzeMatchRequestSchema, MatchAnalysisError } from "@/lib/analyze-match";
import { MatchValidationError } from "@/lib/match";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const failure = (error: string, status: number) => Response.json({ success: false, error }, { status, headers });
  if (!request.headers.get("content-type")?.includes("application/json")) return failure("请使用 JSON 提交结构化简历和岗位信息。", 415);
  const reader = request.body?.getReader();
  if (!reader) return failure("请先生成结构化简历和岗位信息。", 400);
  let body: unknown;
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1_000_000) {
        await reader.cancel();
        return failure("匹配分析请求过大，请使用较短的简历和岗位 JD。", 413);
      }
      chunks.push(chunk.value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return failure("无法读取匹配分析数据，请重新生成后重试。", 400);
  }
  const input = analyzeMatchRequestSchema.safeParse(body);
  if (!input.success) return failure("ResumeData 或 JobData 无效，请重新生成结构化结果。", 400);
  try {
    const config = getAIConfig();
    const analysis = await analyzeMatchWithRetry(getAIClient(), config.model, config.provider, input.data.resumeData, input.data.jobData);
    return Response.json({ success: true, analysis }, { headers });
  } catch (error: unknown) {
    if (error instanceof MatchValidationError) {
      const field = error.field ? `；字段：${error.field}` : "";
      const detail = process.env.NODE_ENV === "development" ? ` 验证规则：${error.rule}${field}。` : "";
      return failure(error.message + detail, 422);
    }
    if (error instanceof MatchAnalysisError) {
      const detail = process.env.NODE_ENV === "development" ? ` 分类：${error.reason}。` : "";
      return failure(error.message + detail, 422);
    }
    const result = getAIError(error);
    return failure(result.error, result.status);
  }
}
