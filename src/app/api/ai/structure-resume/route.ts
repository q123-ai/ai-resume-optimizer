import { getAIClient, getAIConfig, getAIError } from "@/lib/ai";
import { ResumeStructureError, structureResume, structureResumeRequestSchema } from "@/lib/structure-resume";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const failure = (error: string, status: number) => Response.json({ success: false, error }, { status, headers });
  if (!request.headers.get("content-type")?.includes("application/json")) return failure("请使用 JSON 提交解析后的简历文字。", 415);
  // Limit request bytes before JSON parsing; do not retain or log the content.
  const reader = request.body?.getReader();
  if (!reader) return failure("请先解析简历文件。", 400);
  let body: unknown;
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 256_000) {
        await reader.cancel();
        return failure("简历文字请求过大，请使用较短简历。", 413);
      }
      chunks.push(chunk.value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return failure("无法读取简历文字，请重新解析后重试。", 400);
  }
  const input = structureResumeRequestSchema.safeParse(body);
  if (!input.success) return failure("请提交非空的 rawText，最多 30000 个字符，不包含其他字段。", 400);
  try {
    const config = getAIConfig();
    const resumeData = await structureResume(getAIClient(), config.model, config.provider, input.data.rawText);
    return Response.json({ success: true, resumeData }, { headers });
  } catch (error: unknown) {
    if (error instanceof ResumeStructureError) return failure(error.message, 422);
    const result = getAIError(error);
    return failure(result.error, result.status);
  }
}
