import type { ParseResumeResponse } from "@/types/parse-resume";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MIME_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

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
    if (file.size > MAX_FILE_SIZE) {
      return respond({ success: false, error: "文件大小不能超过 10MB。" }, 413);
    }
    const extension = file.name.match(/\.([^.]+)$/)?.[1].toLowerCase();
    if (
      (extension !== "pdf" && extension !== "docx") ||
      (file.type !== "" && file.type.toLowerCase() !== "application/octet-stream" && file.type.toLowerCase() !== MIME_TYPES[extension])
    ) {
      return respond({ success: false, error: "仅支持 PDF 或 DOCX 格式的简历。" }, 415);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    let text: string;
    if (extension === "pdf") {
      const { getDocumentProxy, extractText } = await import("unpdf");
      try {
        // Only read uploaded bytes in memory; suppress parser diagnostics.
        const document = await getDocumentProxy(new Uint8Array(buffer), { verbosity: 0 });
        try {
          const result = await extractText(document, { mergePages: false });
          text = result.text.join("\n\n").trim();
        } finally {
          await document.loadingTask.destroy();
        }
      } catch {
        return respond({ success: false, error: "PDF 解析失败，文件可能已损坏或受密码保护，请换一份文件。" }, 422);
      }
      if (!text) {
        return respond({ success: false, error: "该 PDF 可能是扫描版或图片型简历，暂时无法提取文字。" }, 422);
      }
    } else {
      const { extractRawText } = await import("mammoth");
      try {
        // extractRawText uses Mammoth's default externalFileAccess: false.
        text = (await extractRawText({ buffer })).value.trim();
      } catch {
        return respond({ success: false, error: "DOCX 解析失败，文件可能已损坏，请换一份文件。" }, 422);
      }
      if (!text) {
        return respond({ success: false, error: "该 DOCX 没有可提取的文字，请检查简历内容。" }, 422);
      }
    }
    return respond({ success: true, fileName: file.name, fileType: extension, text, characterCount: Array.from(text).length });
  } catch {
    return respond({ success: false, error: "服务器暂时无法解析简历，请稍后重试。" }, 500);
  }
}
