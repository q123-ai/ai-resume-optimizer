"use client";

import { useEffect, useRef, useState } from "react";
import type { MatchAnalysis } from "@/types/match";
import { getJobInputError } from "@/lib/job-client";
import { AnalysisRequestGate, PipelineClientError, requestAnalysisPipeline } from "@/lib/pipeline-client";
import JobInput from "./JobInput";
import MatchAnalysisPreview from "./MatchAnalysisPreview";
import ResumeUploader from "./ResumeUploader";

export default function AnalysisWorkspace() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [jobText, setJobText] = useState("");
  const [analysis, setAnalysis] = useState<MatchAnalysis | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const gate = useRef(new AnalysisRequestGate());
  useEffect(() => () => gate.current.invalidate(), []);

  function invalidateAnalysis() {
    gate.current.invalidate();
    setIsLoading(false);
    setAnalysis(null);
    setError("");
  }

  async function runAnalysis() {
    if (!selectedFile) {
      setError("请先选择一份 PDF 或 DOCX 简历。");
      return;
    }
    const inputError = getJobInputError(jobText);
    if (inputError) {
      setError(inputError);
      return;
    }
    const activeRun = gate.current.start();
    if (!activeRun) return;
    setIsLoading(true);
    setAnalysis(null);
    setError("");
    try {
      const result = await requestAnalysisPipeline(selectedFile, jobText, activeRun.controller.signal);
      if (gate.current.isCurrent(activeRun)) setAnalysis(result);
    } catch (error: unknown) {
      if (gate.current.isCurrent(activeRun) && !(error instanceof Error && error.name === "AbortError")) {
        setError(error instanceof PipelineClientError ? error.message : "无法获取有效的匹配分析，请稍后重试。");
      }
    } finally {
      if (gate.current.finish(activeRun)) setIsLoading(false);
    }
  }

  const jobError = getJobInputError(jobText);
  const canAnalyze = selectedFile !== null && jobError === null && !isLoading;

  return (
    <>
      <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-2 lg:gap-10">
        <ResumeUploader disabled={isLoading} showDevelopmentTools={process.env.NODE_ENV === "development"} onFileChange={(file) => { invalidateAnalysis(); setSelectedFile(file); }} />
        <JobInput disabled={isLoading} showDevelopmentTools={process.env.NODE_ENV === "development"} onRawTextChange={(text) => { invalidateAnalysis(); setJobText(text); }} />
      </div>
      <div className="px-6 pb-7 text-center sm:px-8 sm:pb-8">
        <button type="button" disabled={!canAnalyze} onClick={runAnalysis} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-10 py-3.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-72">
          {isLoading ? "AI 正在分析，请稍候…" : "③ 开始 AI 分析"}
        </button>
        <p className="mt-3 text-xs text-slate-500">{!selectedFile ? "请先选择简历。" : jobError ? "请填写有效的岗位 JD。" : "你的简历内容仅用于本次分析。"}</p>
        {jobText.length > 20_000 && <p className="mt-2 text-sm text-red-600">岗位 JD 最多 20000 个字符。</p>}
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <p role="status" className="mt-2 text-sm text-emerald-700">{isLoading ? "AI 正在依次读取简历、理解岗位并分析匹配情况……" : analysis ? "✓ 匹配分析完成" : ""}</p>
      </div>
      {analysis && <MatchAnalysisPreview analysis={analysis} />}
    </>
  );
}
