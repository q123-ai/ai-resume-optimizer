import type { MatchAnalysis, MatchItem } from "../types/match";

const priorityLabels = { required: "必备", preferred: "加分", unspecified: "未明确" };

function Items({ items, empty }: { items: MatchItem[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-slate-400">{empty}</p>;
  return <ul className="space-y-3">{items.map((item) => (
    <li key={item.id} className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-slate-800">{item.requirement.value}</p>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{priorityLabels[item.priority]}</span>
      </div>
      <p className="mt-2 text-sm text-slate-600">{item.matchReason}</p>
      {item.status === "missing" ? <p className="mt-2 text-sm text-red-600">简历中未找到相关证据</p> : (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-blue-600">查看简历来源证据</summary>
          <ul className="mt-2 space-y-2">{item.resumeEvidence.map((evidence) => (
            <li key={`${item.id}:${evidence.evidenceId}`} className="rounded bg-slate-50 p-2 text-sm">
              <p>{evidence.value}</p>
              <p className="mt-1 whitespace-pre-wrap text-xs text-slate-500">{evidence.sourceText}</p>
            </li>
          ))}</ul>
        </details>
      )}
      <details className="mt-2"><summary className="cursor-pointer text-xs text-slate-500">查看 JD 原要求</summary><p className="mt-1 whitespace-pre-wrap text-xs text-slate-500">{item.requirement.sourceText}</p></details>
    </li>
  ))}</ul>;
}

export default function MatchAnalysisPreview({ analysis }: { analysis: MatchAnalysis }) {
  const { breakdown } = analysis.overallMatch;
  return (
    <section aria-labelledby="match-result-title" className="mt-6 border-t border-slate-200 px-6 py-7 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 id="match-result-title" className="text-lg font-semibold">岗位匹配分析</h2><p className="mt-1 text-sm text-slate-500">结论只基于当前结构化简历中的可验证证据。</p></div>
        <div className="text-right"><span className="text-4xl font-semibold text-blue-600">{analysis.overallMatch.score}</span><span className="text-sm text-slate-500"> / 100</span></div>
      </div>
      <details className="mt-4 rounded-lg bg-slate-50 p-3 text-sm"><summary className="cursor-pointer font-medium">查看评分明细</summary><div className="mt-2 grid gap-2 text-slate-600 sm:grid-cols-2"><p>必备要求：{breakdown.required.earnedWeight} / {breakdown.required.possibleWeight}</p><p>加分要求：{breakdown.preferred.earnedWeight} / {breakdown.preferred.possibleWeight}</p><p>未明确要求：{breakdown.unspecified.earnedWeight} / {breakdown.unspecified.possibleWeight}</p><p>关键词覆盖：{breakdown.keywordPercentage}%</p><p>要求贡献：{breakdown.requirementContribution} 分</p><p>关键词贡献：{breakdown.keywordContribution} 分</p></div></details>
      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <section><h3 className="mb-3 font-semibold text-emerald-700">已匹配要求</h3><Items items={analysis.matchedRequirements} empty="暂无完全匹配项" /></section>
        <section><h3 className="mb-3 font-semibold text-amber-700">部分匹配</h3><Items items={analysis.partialMatches} empty="暂无部分匹配项" /></section>
        <section><h3 className="mb-3 font-semibold text-red-700">缺失要求</h3><Items items={analysis.missingRequirements} empty="暂无缺失项" /></section>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-slate-200 p-4"><h3 className="font-semibold">技能匹配</h3><p className="mt-2 text-sm text-slate-600">匹配 {analysis.skillMatches.matchedSkills.length} · 部分 {analysis.skillMatches.partialSkills.length} · 缺失 {analysis.skillMatches.missingSkills.length}</p></section>
        <section className="rounded-lg border border-slate-200 p-4"><h3 className="font-semibold">关键词覆盖</h3><p className="mt-2 text-2xl font-semibold text-blue-600">{analysis.keywordCoverage.coveragePercentage}%</p><p className="mt-2 text-sm text-slate-600">已覆盖：{analysis.keywordCoverage.coveredKeywords.join("、") || "无"}</p><p className="mt-1 text-sm text-slate-600">未覆盖：{analysis.keywordCoverage.missingKeywords.join("、") || "无"}</p></section>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="rounded-lg bg-emerald-50 p-4"><h3 className="font-semibold text-emerald-800">优势</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-emerald-900">{analysis.strengths.length ? analysis.strengths.map((item) => <li key={item.requirementId}>{item.value}</li>) : <li>暂无已验证优势</li>}</ul></section>
        <section className="rounded-lg bg-amber-50 p-4"><h3 className="font-semibold text-amber-800">差距</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">{analysis.gaps.length ? analysis.gaps.map((item) => <li key={item.requirementId}>{item.value}</li>) : <li>暂无已识别差距</li>}</ul></section>
      </div>
      {process.env.NODE_ENV === "development" && <details className="mt-4 rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm text-blue-600">查看 MatchAnalysis JSON</summary><pre className="mt-3 max-h-96 overflow-auto text-xs whitespace-pre-wrap break-all">{JSON.stringify(analysis, null, 2)}</pre></details>}
    </section>
  );
}
