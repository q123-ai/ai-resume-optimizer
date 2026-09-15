import type { ReactNode } from "react";
import ResumeUploader from "@/components/ResumeUploader";

function Icon({ children, className = "h-5 w-5" }: { children: ReactNode; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const features = [
  { title: "岗位匹配分析", description: "分析简历与目标岗位之间的匹配程度，找出优势和不足。", icon: <><path d="M4 19V5M4 19h16M9 15v-4M14 15V7M19 15v-6" /></> },
  { title: "AI 针对性优化", description: "结合岗位职责和任职要求，优化简历中的表达和关键词。", icon: <><path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3ZM20 3v4M18 5h4" /></> },
  { title: "拒绝简历造假", description: "只优化已有真实经历，不编造不存在的技能、项目或工作成果。", icon: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></> },
];

const steps = ["上传简历", "粘贴岗位 JD", "AI 匹配分析", "针对性优化", "确认修改", "导出简历"];

export default function Home() {
  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900">
      <header className="border-b border-slate-200/70 bg-white">
        <nav aria-label="主导航" className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <a href="#" className="flex items-center gap-2.5 font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white">
              <Icon><path d="M7 3h7l4 4v14H6V3h1ZM14 3v5h4M9 12h6M9 16h4" /></Icon>
            </span>
            <span className="text-base sm:text-lg">AI 简历优化助手</span>
          </a>
          <div className="flex items-center gap-5 text-sm text-slate-600 sm:gap-8">
            <a href="#features" className="transition-colors hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600">产品功能</a>
            <a href="#workflow" className="transition-colors hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600">使用流程</a>
            <button type="button" disabled title="项目 GitHub 地址待配置" className="cursor-not-allowed text-slate-400">GitHub</button>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-16 sm:px-8">
        <section aria-labelledby="hero-title" className="mx-auto max-w-3xl pt-14 pb-10 text-center sm:pt-20 sm:pb-12">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3.5 py-1.5 text-xs font-medium text-blue-700">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            AI 驱动 · 岗位针对性优化
          </div>
          <h1 id="hero-title" className="text-3xl leading-snug font-semibold tracking-tight sm:text-5xl sm:leading-tight">让你的简历，<span className="text-blue-600">更懂招聘要求</span></h1>
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-slate-500 sm:text-base sm:leading-8">上传简历并粘贴目标岗位 JD，AI 将分析岗位要求与简历之间的匹配程度，并在不编造经历的前提下，为你生成更有针对性的简历。</p>
        </section>

        <section aria-label="简历优化工作区" className="rounded-2xl border border-slate-200 bg-white shadow-[0_8px_40px_-16px_rgba(15,23,42,0.15)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-6 py-4 sm:px-8">
            <span className="text-sm font-medium text-slate-700">从一份真实简历开始</span>
            <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs text-slate-500">分析功能尚未开放</span>
          </div>
          <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-2 lg:gap-10">
            <ResumeUploader />
            <div>
              <h2><label htmlFor="job-description" className="text-base font-semibold">② 粘贴目标岗位 JD</label></h2>
              <p id="jd-help" className="mt-2 text-sm text-slate-500">粘贴招聘信息中的岗位职责和任职要求。</p>
              <textarea id="job-description" name="job-description" aria-describedby="jd-help" className="mt-5 block min-h-72 w-full resize-y rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-3 focus:ring-blue-100" placeholder={"请粘贴目标岗位的完整 JD，例如：\n\n岗位职责：\n1. 负责经营数据分析……\n2. 制作业务分析报告……\n\n任职要求：\n1. 熟练使用 Excel……\n2. 具备良好的数据分析能力……"} />
            </div>
          </div>
          <div className="px-6 pb-7 text-center sm:px-8 sm:pb-8">
            <button type="button" disabled className="inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-blue-600 px-10 py-3.5 text-sm font-semibold text-white shadow-sm sm:w-auto sm:min-w-72">
              <Icon><path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z" /></Icon>
              开始 AI 分析
            </button>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-500">
              <Icon className="h-3.5 w-3.5"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Icon>
              你的简历内容仅用于本次分析。
            </p>
          </div>
        </section>

        <section id="features" aria-label="产品功能" className="grid scroll-mt-8 gap-4 pt-8 md:grid-cols-3">
          {features.map((feature, index) => (
            <article key={feature.title} className="rounded-xl border border-slate-200/80 bg-white p-6">
              <span className="mb-4 inline-flex rounded-lg bg-blue-50 p-2.5 text-blue-600"><Icon>{feature.icon}</Icon></span>
              <h2 className="text-base font-semibold"><span className="mr-2 text-slate-400">{["①", "②", "③"][index]}</span>{feature.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">{feature.description}</p>
            </article>
          ))}
        </section>

        <section id="workflow" aria-labelledby="workflow-title" className="scroll-mt-8 pt-14 pb-4 sm:pt-16">
          <h2 id="workflow-title" className="text-center text-xl font-semibold">使用流程</h2>
          <p className="mt-2 text-center text-sm text-slate-500">每一步优化，都由你掌握</p>
          <ol className="mt-8 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-6">
            {steps.map((step, index) => (
              <li key={step} className="relative flex flex-col items-center gap-3 text-center">
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-xs font-semibold text-blue-600">0{index + 1}</span>
                <span className="text-sm font-medium text-slate-600">{step}</span>
                {index < steps.length - 1 && <span aria-hidden="true" className="absolute top-2 right-0 hidden text-slate-300 lg:block">→</span>}
              </li>
            ))}
          </ol>
        </section>
      </main>
      <footer className="border-t border-slate-200/70 px-5 py-6 text-center text-xs text-slate-400">AI 简历优化助手 · 以真实经历，走向更合适的机会</footer>
    </div>
  );
}
