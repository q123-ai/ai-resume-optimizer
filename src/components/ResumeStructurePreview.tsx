"use client";

import { useEffect, useRef, useState } from "react";
import type { ResumeData } from "@/types/resume";
import { validateResumeData } from "@/lib/resume";

const labels: Record<string, string> = {
  personalInfo: "个人信息", summary: "个人简介", education: "教育经历", experience: "工作经历", projects: "项目经历", skills: "技能", certificates: "证书", other: "其他信息",
  name: "名称", phone: "电话", email: "邮箱", location: "地区", website: "网站", linkedin: "LinkedIn", github: "GitHub", school: "学校", degree: "学历", major: "专业", startDate: "开始日期", endDate: "结束日期", description: "描述", company: "公司", position: "岗位", role: "角色", technologies: "技术", category: "分组", issuer: "颁发方", date: "日期", title: "标题", content: "内容",
};

function PreviewValue({ value }: { value: unknown }) {
  if (value === null) return <span className="text-slate-400">原文未提供</span>;
  if (typeof value === "string") return <span className="whitespace-pre-wrap break-words">{value}</span>;
  if (Array.isArray(value)) return value.length ? (
    <ul className="space-y-3">{value.map((item, index) => <li key={typeof item === "object" && item !== null && "id" in item && typeof item.id === "string" ? item.id : index} className="rounded border border-slate-100 p-3"><PreviewValue value={item} /></li>)}</ul>
  ) : <span className="text-slate-400">原文未提供</span>;
  if (typeof value === "object" && value !== null) {
    if ("value" in value && "sourceText" in value && typeof value.value === "string" && typeof value.sourceText === "string") return (
      <div><p className="whitespace-pre-wrap break-words">{value.value}</p><details className="mt-1"><summary className="cursor-pointer text-xs text-blue-600">查看来源证据</summary><p className="mt-1 whitespace-pre-wrap break-words text-slate-500">{value.sourceText}</p></details></div>
    );
    return <dl className="space-y-2">{Object.entries(value).filter(([key]) => key !== "id" && key !== "rawText").map(([key, item]) => <div key={key}><dt className="mb-1 font-medium text-slate-500">{labels[key] || key}</dt><dd><PreviewValue value={item} /></dd></div>)}</dl>;
  }
  return null;
}

export default function ResumeStructurePreview({ rawText }: { rawText: string }) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<ResumeData | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function generate() {
    if (controller.current) return;
    controller.current = new AbortController();
    setIsLoading(true);
    setError("");
    setData(null);
    try {
      const response = await fetch("/api/ai/structure-resume", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rawText }), signal: controller.current.signal });
      const result: unknown = await response.json();
      if (typeof result !== "object" || result === null || !("success" in result)) throw new Error("invalid response");
      if (response.ok && result.success === true && "resumeData" in result) {
        const validated = validateResumeData(result.resumeData);
        if (validated.rawText !== rawText) throw new Error("mismatched source");
        setData(validated);
      } else {
        setError("error" in result && typeof result.error === "string" ? result.error : "结构化服务返回异常，请稍后重试。");
      }
    } catch (error: unknown) {
      if (!(error instanceof Error && error.name === "AbortError")) setError("无法获取有效的结构化结果，请检查网络后重试。");
    } finally {
      controller.current = null;
      setIsLoading(false);
    }
  }

  return (
    <section aria-label="结构化简历预览" className="mt-4 border-t border-slate-200 pt-4">
      <p className="text-xs leading-5 text-slate-500">点击后将解析文字发送到当前配置的 AI 服务（默认 DeepSeek），仅提取原文事实，不分析或优化简历。</p>
      <button type="button" disabled={isLoading} onClick={generate} className="mt-3 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-wait disabled:opacity-60">{isLoading ? "正在生成结构化简历……" : "生成结构化简历"}</button>
      <p role="status" className="mt-2 text-sm text-emerald-700">{isLoading ? "正在提取简历事实，请稍候……" : data ? "✓ 结构化结果已通过验证，请核对原文" : ""}</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      {data && <div className="mt-3 space-y-3 text-sm text-slate-700"><p className="text-xs leading-5 text-slate-500">验证只检查结构和原文片段，不能保证提取完整或语义判断正确。此处只预览，不代表已确认修改。</p>{Object.entries(data).filter(([key]) => key !== "rawText").map(([key, value]) => <details key={key} className="rounded-lg border border-slate-200 bg-white p-3" open={key === "personalInfo"}><summary className="cursor-pointer font-semibold">{labels[key]}</summary><div className="mt-3"><PreviewValue value={value} /></div></details>)}</div>}
    </section>
  );
}
