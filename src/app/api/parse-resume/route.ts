import type { ParseResumeResponse } from "@/types/parse-resume";
import { parseResumeFile, ResumeParseError } from "@/lib/parse-resume";

export const runtime = "nodejs";

function respond(body: ParseResumeResponse, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return respond({ success: false, error: "无法读取上传文件，请重新选择简历。" }, 400);
    }
    const files = form.getAll("file");
    const file = files[0];
    if (!(file instanceof File) || files.length !== 1) {
      return respond({ success: false, error: "请上传一份 PDF 或 DOCX 简历文件。" }, 400);
    }
    const result = await parseResumeFile(file);
    return respond({ success: true, ...result });
  } catch (error: unknown) {
    if (error instanceof ResumeParseError) return respond({ success: false, error: error.message }, error.status);
    return respond({ success: false, error: "服务器暂时无法解析简历，请稍后重试。" }, 500);
  }
}
