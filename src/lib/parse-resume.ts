import "server-only";

export const MAX_RESUME_FILE_SIZE = 10 * 1024 * 1024;
const MIME_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export type ResumeFileType = keyof typeof MIME_TYPES;
export type ParsedResume = {
  fileName: string;
  fileType: ResumeFileType;
  text: string;
  characterCount: number;
};

export class ResumeParseError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export function validateResumeFile(file: File): ResumeFileType {
  if (file.size > MAX_RESUME_FILE_SIZE) throw new ResumeParseError("文件大小不能超过 10MB。", 413);
  const extension = file.name.match(/\.([^.]+)$/)?.[1].toLowerCase();
  if (
    (extension !== "pdf" && extension !== "docx") ||
    (file.type !== "" && file.type.toLowerCase() !== "application/octet-stream" && file.type.toLowerCase() !== MIME_TYPES[extension])
  ) {
    throw new ResumeParseError("仅支持 PDF 或 DOCX 格式的简历。", 415);
  }
  return extension;
}

export async function parseResumeFile(file: File): Promise<ParsedResume> {
  const extension = validateResumeFile(file);
  const buffer = Buffer.from(await file.arrayBuffer());
  let text: string;
  if (extension === "pdf") {
    const { getDocumentProxy, extractText } = await import("unpdf");
    try {
      const document = await getDocumentProxy(new Uint8Array(buffer), { verbosity: 0 });
      try {
        const result = await extractText(document, { mergePages: false });
        text = result.text.join("\n\n").trim();
      } finally {
        await document.loadingTask.destroy();
      }
    } catch {
      throw new ResumeParseError("PDF 解析失败，文件可能已损坏或受密码保护，请换一份文件。", 422);
    }
    if (!text) throw new ResumeParseError("该 PDF 可能是扫描版或图片型简历，暂时无法提取文字。", 422);
  } else {
    const { extractRawText } = await import("mammoth");
    try {
      text = (await extractRawText({ buffer })).value.trim();
    } catch {
      throw new ResumeParseError("DOCX 解析失败，文件可能已损坏，请换一份文件。", 422);
    }
    if (!text) throw new ResumeParseError("该 DOCX 没有可提取的文字，请检查简历内容。", 422);
  }
  return { fileName: file.name, fileType: extension, text, characterCount: Array.from(text).length };
}
