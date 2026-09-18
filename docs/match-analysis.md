# 第 9 阶段：简历与岗位匹配分析

本阶段只比较已验证的 ResumeData 与 JobData，不修改简历、不生成优化文本，也不存储用户数据。

## 责任边界

程序将 JobData 展平为具有内部稳定 ID 的岗位要求，将 ResumeData 展平为具有内部 ID 的事实证据。个人联系方式不会进入发送给 AI 的匹配上下文。AI 只能输出 requirementId、resumeEvidenceIds、matched / partial / missing 和简短原因，不能提交新的候选人事实。服务器根据 ID 从原始结构化数据重建最终 requirement、resumeEvidence 和 sourceText。

AI 负责语义相关性判断，例如把“具备数据分析能力”和“使用 Excel 对经营数据进行统计分析”判断为相关。程序负责输入 Zod 校验、ID 完整性、证据存在性、缺失项不得携带证据、关键词覆盖、评分和最终响应一致性。未知证据 ID、重复或遗漏要求、非法状态和损坏 JSON 都会失败。

## MatchAnalysis

- overallMatch：0–100 的程序计算分数、high / medium / low 等级和可解释 breakdown。
- matchedRequirements / partialMatches / missingRequirements：每项保留 JD 原要求、priority、状态、简历证据和匹配原因。
- skillMatches：上述结果中 category=skill 的匹配、部分匹配和缺失分组。
- keywordCoverage：JobData 关键词的已覆盖、未覆盖及确定性百分比。
- strengths：已匹配岗位要求的名称，由程序生成。
- gaps：部分匹配和缺失要求的名称，由程序生成。

missing 项的 resumeEvidence 固定为空，前端显示“简历中未找到相关证据”。最终结果不接受 AI 自由生成的总体分、关键词百分比、优势或差距。

## 评分

required 权重 4，preferred 权重 2，unspecified 权重 1。matched 获得全部权重，partial 获得一半，missing 为零。存在岗位关键词时，要求得分占 90%，确定性关键词覆盖占 10%；没有关键词时要求得分占 100%。只有关键词而没有要求时使用关键词覆盖分。所有计算集中在 calculateOverallMatch，没有随机数。

关键词覆盖只使用 JobData 已验证关键词，并在 ResumeData 的非个人事实 value/sourceText 中做大小写、Unicode 和空白规范化后的确定性检查。英文技术词使用完整 token 匹配，避免把短词误命中其他单词。它不做自由同义词扩展，因此结果偏保守。

## 安全与限制

API 为 POST /api/ai/analyze-match，复用现有服务器 AI client、Responses API、store:false、安全错误映射和无重试策略。浏览器只调用本项目 API，不接触 API Key。服务端不记录完整简历、JD、AI 输出或证据。

语义匹配仍由模型判断，程序无法证明所有中文同义关系。对 JobData 中明确的单个英文技术关键词，若 AI 引用的证据没有该技术词，程序会保守降为 missing，例如 Excel 或 Python 不能证明 SQL。用户仍应人工核对匹配原因与展开的原文证据。
