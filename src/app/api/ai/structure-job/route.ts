import { getAIClient, getAIConfig, getAIError } from "@/lib/ai";
import { JobValidationError } from "@/lib/job";
import { JobStructureError, structureJob, structureJobRequestSchema } from "@/lib/structure-job";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const failure = (error: string, status: number) => Response.json({ success: false, error }, { status, headers });
  if (!request.headers.get("content-type")?.includes("application/json")) return failure("请使用 JSON 提交岗位 JD。", 415);
  const reader = request.body?.getReader();
  if (!reader) return failure("请先输入岗位 JD。", 400);
  let body: unknown;
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 128_000) {
        await reader.cancel();
        return failure("JD 请求过大，请使用较短 JD。", 413);
      }
      chunks.push(chunk.value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return failure("无法读取岗位 JD，请重新输入后重试。", 400); }
  const input = structureJobRequestSchema.safeParse(body);
  if (!input.success) return failure("JD 必须是非空字符串，最多 20000 个字符，只提交 rawText 字段。", 400);
  try {
    const config = getAIConfig();
    const result = await structureJob(getAIClient(), config.model, config.provider, input.data.rawText);
    return Response.json({ success: true, jobData: result.data, warnings: result.warnings }, { headers });
  } catch (error: unknown) {
    if (error instanceof JobValidationError) {
      const detail = process.env.NODE_ENV === "development" ? ` 验证层：${error.stage}；字段：${error.field}；规则：${error.rule}。` : "";
      return failure(error.message + detail, 422);
    }
    if (error instanceof JobStructureError) return failure(error.message, 422);
    const result = getAIError(error);
    return failure(result.error, result.status);
  }
}
