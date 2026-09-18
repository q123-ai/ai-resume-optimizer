"use client";

import { useEffect, useRef, useState } from "react";
import type { JobData } from "@/types/job";
import type { JobValidationWarning } from "@/lib/job";
import { getJobInputError, JobClientError, requestStructuredJob } from "@/lib/job-client";

const labels: Record<string, string> = {
  jobTitle: "职位名称", companyName: "公司", location: "地点", employmentType: "工作类型", salary: "薪资", responsibilities: "工作职责", requiredSkills: "必备技能", preferredSkills: "加分技能", unspecifiedSkills: "级别未明确的技能", educationRequirements: "学历要求", experienceRequirements: "工作经验要求", certifications: "证书要求", languageRequirements: "语言要求", otherRequirements: "其他要求", keywords: "JD 关键词",
};
const priorities = { required: "必需", preferred: "加分", unspecified: "未明确" };

function Evidence({ value }: { value: unknown }) {
  if (value === null || (Array.isArray(value) && !value.length)) return <p className="text-slate-400">原文未提供</p>;
  if (Array.isArray(value)) return <ul className="space-y-3">{value.map((item, index) => <li key={index} className="border-l-2 border-slate-100 pl-3"><Evidence value={item} /></li>)}</ul>;
  if (typeof value === "object" && value !== null && "value" in value && "sourceText" in value && typeof value.value === "string" && typeof value.sourceText === "string") return (
    <div><p className="whitespace-pre-wrap break-words">{value.value}</p>{"priority" in value && (value.priority === "required" || value.priority === "preferred" || value.priority === "unspecified") && <span className="mt-1 inline-block rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{priorities[value.priority]}</span>}<details className="mt-1"><summary className="cursor-pointer text-xs text-blue-600">查看来源证据</summary><p className="mt-1 whitespace-pre-wrap break-words text-slate-500">{value.sourceText}</p></details></div>
  );
  return null;
}

type JobInputProps = {
  disabled?: boolean;
  showDevelopmentTools?: boolean;
  onRawTextChange?: (rawText: string) => void;
  onDataChange?: (data: JobData | null) => void;
};

export default function JobInput({ disabled = false, showDevelopmentTools = false, onRawTextChange, onDataChange }: JobInputProps) {
  const [rawText, setRawText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<JobData | null>(null);
  const [warnings, setWarnings] = useState<JobValidationWarning[]>([]);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function parseJob() {
    setData(null);
    onDataChange?.(null);
    setWarnings([]);
    setError("");
    const inputError = getJobInputError(rawText);
    if (inputError) { setError(inputError); return; }
    const activeController = new AbortController();
    controller.current?.abort();
    controller.current = activeController;
    setIsLoading(true);
    try {
      const result = await requestStructuredJob(rawText, activeController.signal);
      setData(result.data);
      onDataChange?.(result.data);
      setWarnings(result.warnings);
    } catch (error: unknown) {
      if (!(error instanceof Error && error.name === "AbortError")) setError(error instanceof JobClientError ? error.message : "无法获取有效的 JD 结果，请稍后重试。");
    } finally {
      if (controller.current === activeController) controller.current = null;
      setIsLoading(false);
    }
  }

  return (
    <div>
      <h2><label htmlFor="job-description" className="text-base font-semibold">② 粘贴目标岗位 JD</label></h2>
      <p id="jd-help" className="mt-2 text-sm text-slate-500">粘贴招聘信息中的岗位职责和任职要求。</p>
      <textarea id="job-description" name="job-description" value={rawText} disabled={isLoading || disabled} onChange={(event) => { const next = event.target.value; setRawText(next); onRawTextChange?.(next); setData(null); onDataChange?.(null); setWarnings([]); setError(""); }} aria-describedby={`jd-help${error ? " jd-error" : ""}`} className="mt-5 block min-h-72 w-full resize-y rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-3 focus:ring-blue-100 disabled:bg-slate-50" placeholder={"请粘贴目标岗位的完整 JD，例如：\n\n岗位职责：\n1. 负责经营数据分析……\n2. 制作业务分析报告……\n\n任职要求：\n1. 熟练使用 Excel……\n2. 具备良好的数据分析能力……"} />
      {showDevelopmentTools && <details className="mt-3 rounded-lg border border-dashed border-slate-200 p-3"><summary className="cursor-pointer text-xs text-slate-500">开发调试工具</summary>
        <p className="mt-2 text-xs leading-5 text-slate-500">单独调用现有 JobData 结构化接口，不进行简历匹配或优化。</p>
        <button type="button" disabled={isLoading || disabled} onClick={parseJob} className="mt-3 w-full rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-wait disabled:opacity-60">{isLoading ? "AI 正在识别岗位要求…" : "AI 解析岗位 JD"}</button>
        <p role="status" className="mt-2 text-sm text-emerald-700">{isLoading ? "AI 正在识别岗位要求…" : data ? "✓ JD 结构化成功，请核对原文" : ""}</p>
        {error && <p id="jd-error" role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
        {warnings.length > 0 && <p className="mt-2 text-sm text-amber-700">已忽略 {warnings.length} 条无法可靠验证的辅助信息；其余结果可继续核对。</p>}
        {data && <section aria-label="结构化 JD 预览" className="mt-3 space-y-3 text-sm text-slate-700"><p className="text-xs text-slate-500">结构与证据验证不能保证提取完整或语义正确，请人工检查要求级别。</p>{Object.entries(data).filter(([key]) => key !== "rawText").map(([key, value]) => <details key={key} className="rounded-lg border border-slate-200 bg-white p-3" open={key === "jobTitle"}><summary className="cursor-pointer font-semibold">{labels[key]}</summary><div className="mt-3"><Evidence value={value} /></div></details>)}<details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-blue-600">查看 JobData JSON</summary><pre className="mt-3 max-h-80 overflow-auto text-xs whitespace-pre-wrap break-all">{JSON.stringify(data, null, 2)}</pre></details></section>}
      </details>}
    </div>
  );
}
