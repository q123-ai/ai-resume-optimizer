"use client";

import { useRef, useState } from "react";
import type { ParseResumeResponse } from "@/types/parse-resume";
import type { ResumeData } from "@/types/resume";
import ResumeStructurePreview from "./ResumeStructurePreview";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MIME_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

type ResumeUploaderProps = {
  disabled?: boolean;
  showDevelopmentTools?: boolean;
  onFileChange?: (file: File | null) => void;
  onStructuredResumeChange?: (data: ResumeData | null) => void;
};

export default function ResumeUploader({ disabled = false, showDevelopmentTools = false, onFileChange, onStructuredResumeChange }: ResumeUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parseResult, setParseResult] = useState<Extract<ParseResumeResponse, { success: true }> | null>(null);
  const parsingRef = useRef(false);

  function selectFile(files: FileList | null) {
    setIsDragging(false);
    if (parsingRef.current || disabled) return;
    if (!files?.length) return;
    setSelectedFile(null);
    setParseResult(null);
    onFileChange?.(null);
    onStructuredResumeChange?.(null);
    if (files.length > 1) {
      setError("请一次只选择一份简历。");
      return;
    }

    const file = files[0];
    const extension = file.name.match(/\.([^.]+)$/)?.[1].toLowerCase();
    if (
      (extension !== "pdf" && extension !== "docx") ||
      (file.type !== "" && file.type.toLowerCase() !== "application/octet-stream" && file.type.toLowerCase() !== MIME_TYPES[extension])
    ) {
      setError("仅支持 PDF 或 DOCX 格式的简历。");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("文件大小不能超过 10MB。");
      return;
    }

    setSelectedFile(file);
    setParseResult(null);
    onFileChange?.(file);
    onStructuredResumeChange?.(null);
    setError("");
  }

  function removeFile() {
    setSelectedFile(null);
    setParseResult(null);
    onFileChange?.(null);
    onStructuredResumeChange?.(null);
    setError("");
    setIsDragging(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function parseResume() {
    if (!selectedFile || parsingRef.current) return;
    parsingRef.current = true;
    setIsParsing(true);
    setError("");
    setParseResult(null);
    onStructuredResumeChange?.(null);
    try {
      const form = new FormData();
      form.append("file", selectedFile);
      const response = await fetch("/api/parse-resume", { method: "POST", body: form });
      if (response.status === 413) {
        setError("文件过大，超过当前服务接收上限，请选择较小的简历文件。");
        return;
      }
      const result: unknown = await response.json();
      if (typeof result !== "object" || result === null || !("success" in result)) {
        setError("服务器返回异常，请稍后重试。");
        return;
      }
      if (result.success === false && "error" in result && typeof result.error === "string") {
        setError(result.error);
      } else if (
        response.ok && result.success === true &&
        "fileName" in result && typeof result.fileName === "string" &&
        "fileType" in result && (result.fileType === "pdf" || result.fileType === "docx") &&
        "text" in result && typeof result.text === "string" &&
        "characterCount" in result && typeof result.characterCount === "number"
      ) {
        setParseResult({ success: true, fileName: result.fileName, fileType: result.fileType, text: result.text, characterCount: result.characterCount });
      } else {
        setError("服务器返回异常，请稍后重试。");
      }
    } catch {
      setError("无法连接解析服务或读取结果，请稍后重试。");
    } finally {
      parsingRef.current = false;
      setIsParsing(false);
    }
  }

  return (
    <div>
      <h2 id="resume-title" className="text-base font-semibold">① 上传你的简历</h2>
      <p id="resume-help" className="mt-2 text-sm text-slate-500">支持 PDF / DOCX，最大 10MB</p>
      <input
        ref={inputRef}
        id="resume-file"
        type="file"
        disabled={isParsing || disabled}
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        aria-label="选择简历文件"
        aria-describedby={`resume-help${error ? " resume-error" : ""}`}
        className="hidden"
        onChange={(event) => {
          selectFile(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      <div
        role="group"
        aria-labelledby="resume-title"
        onDragEnter={(event) => {
          event.preventDefault();
          if (!parsingRef.current && !disabled && event.dataTransfer.types.includes("Files")) setIsDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          selectFile(event.dataTransfer.files);
        }}
        className={`relative mt-5 rounded-xl border-2 border-dashed transition-colors ${isDragging ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-slate-50/70"}`}
      >
        <button
          type="button"
          disabled={isParsing || disabled}
          onClick={() => inputRef.current?.click()}
          aria-label={selectedFile ? "重新选择简历文件" : "选择简历文件"}
          aria-describedby={`resume-help${error ? " resume-error" : ""}`}
          className="flex min-h-72 w-full cursor-pointer flex-col items-center justify-center rounded-xl px-5 py-8 text-center outline-none hover:bg-blue-50/50 focus-visible:ring-3 focus-visible:ring-blue-500 disabled:cursor-wait"
        >
          <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-white text-blue-600 shadow-sm">
            <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {selectedFile ? <path d="m5 12 4 4L19 6" /> : <path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4" />}
            </svg>
          </span>
          {selectedFile ? (
            <>
              <span className="max-w-full font-medium break-all text-slate-700">{selectedFile.name}</span>
              <span className="mt-2 text-sm text-slate-500">{selectedFile.name.split(".").pop()?.toUpperCase()} · {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</span>
              <span className="mt-3 text-sm font-medium text-emerald-700">✓ 文件已选择</span>
              <span className="mt-3 text-xs text-slate-400">点击或拖拽可重新选择</span>
            </>
          ) : (
            <>
              <span className="font-medium text-slate-700">拖拽简历到这里</span>
              <span className="mt-2 text-sm font-medium text-blue-600">或点击选择文件</span>
              <span className="mt-6 text-xs text-slate-400">点击开始 AI 分析后才发送到服务器，仅用于本次分析</span>
            </>
          )}
        </button>
        {selectedFile && (
          <button type="button" disabled={isParsing || disabled} onClick={removeFile} className="mx-auto mb-5 block cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-wait disabled:opacity-50">移除文件</button>
        )}
      </div>
      <p className="sr-only" role="status">{selectedFile ? `文件已选择：${selectedFile.name}` : "未选择简历文件"}</p>
      {error && <p id="resume-error" role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      {showDevelopmentTools && selectedFile && <details className="mt-4 rounded-lg border border-dashed border-slate-200 p-3"><summary className="cursor-pointer text-xs text-slate-500">开发调试工具</summary>
        <button type="button" disabled={isParsing || disabled} onClick={parseResume} className="mt-3 w-full cursor-pointer rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-wait disabled:opacity-60">
          {isParsing ? "正在解析简历……" : "测试解析简历"}
        </button>
        <p role="status" className="mt-3 text-sm text-slate-600">{isParsing ? "正在解析简历……" : parseResult ? "✓ 简历解析成功" : ""}</p>
      </details>}
      {showDevelopmentTools && parseResult && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm break-all text-slate-600">{parseResult.fileName} · {parseResult.characterCount} 个字符</p>
          <details className="mt-3">
            <summary className="cursor-pointer rounded text-sm font-medium text-blue-600 focus-visible:outline-2 focus-visible:outline-blue-600">查看解析文本</summary>
            <pre className="mt-3 max-h-80 overflow-auto rounded bg-slate-50 p-3 font-sans text-sm leading-6 whitespace-pre-wrap break-words text-slate-700">{parseResult.text}</pre>
          </details>
          <ResumeStructurePreview rawText={parseResult.text} onDataChange={onStructuredResumeChange} />
        </div>
      )}
    </div>
  );
}
