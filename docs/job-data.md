# 第 8 阶段：JobData 与 JD 结构化

只把用户粘贴的 JD 看懂并结构化，不比较 ResumeData，不评分、不推荐技能、不修改简历。

## 数据模型

Zod 是唯一结构定义，TypeScript 类型从 schema 推导。jobExtractionSchema 是 AI 输出，jobDataSchema 在此基础上附加程序负责的 rawText。

- jobTitle、companyName、location、employmentType、salary：原文信息，缺失为 null，不推断。
- responsibilities：工作职责。
- requiredSkills / preferredSkills / unspecifiedSkills：程序按原文确定的必备、加分和级别未明确技能。
- educationRequirements、experienceRequirements、certifications、languageRequirements、otherRequirements：学历、经验、证书、语言和其他要求；每项具有 priority（required / preferred / unspecified）。
- keywords：原文已有关键词，不生成同义词或常见行业技能。
- rawText：服务器收到的 JD 原文，不由 AI 生成或回填。

所有事实字段，包括关键词和基本信息，都用 `{ value, sourceText }`。列表缺失时由程序补为 []，缺失单值补为 null。sourceText 是严格的原文证据；value 是从证据中提取的简洁语义，可以是“功能测试”“问题定位”等概念，不要求逐字复制整句。技能级别无法明确判断时放入 unspecifiedSkills，不丢弃要求。

“熟练使用 Excel”在任职要求语境可提取为 requiredSkills；“Python 经验优先”为 preferredSkills；“CPA 优先”为 preferred 证书。程序保守拒绝把含优先、加分、preferred、nice-to-have 等措辞的证据标为 required；也检查匹配证据的原文行，避免只摘录“CPA”而漏掉同一行“优先”时错误升级。

## 数据流和接口

首页现有 textarea → 点击“AI 解析岗位 JD” → POST /api/ai/structure-job → 现有通用 AI client → Responses API JSON mode → JSON.parse → JobData Zod 和证据校验 → 前端再次验证 → 折叠预览。

输入 JSON 只允许 rawText 字段，必须为 trim 后非空的字符串，最多 20000 个 JavaScript 字符；请求体最多 128000 字节。验证使用 trim，但保留原输入的空格、换行和标点。AI schema 禁止 rawText，程序通过 createJobData(extracted, receivedRawText) 附加原文。

sourceText 必须能在 rawText 中定位。比较过程统一 Unicode NFKC、CRLF/LF、连续空白、全角空格及常见中英文逗号、分号、冒号、句号和引号；原始 rawText、sourceText、value 均不改写。value 只要求非空、类型及长度合理，并允许从完整句子提取核心概念。程序会拒绝能够确定的技术词矛盾，例如 sourceText 只有 Python 而 value 声称 Java；无法由确定性程序证明的中文语义关系不会因为不是子串而随机失败。

字段职责按语义区分：职位、公司、地点、工作类型和薪资允许规范化表达，但必须有 sourceText；职责和各类要求允许语义压缩，仍保留完整证据；skills 允许从证据提取技能概念并由程序规范化 level；keywords 是辅助检索概念，每项仍必须有证据。所有字段都禁止从行业常识补充事实。

## 验证分层与中文要求

JobValidationError 仅包含 stage（schema / sourceText / level）、安全字段路径（如 educationRequirements[0].sourceText）和固定规则代码，不包含字段值、Zod 原始错误消息或 JD 片段。开发环境将这些信息附在中文错误提示中；生产环境只返回通用提示。不写永久日志。单个无效 skill 或 keyword 会被丢弃并返回只含字段路径和固定规则的 warning；前端开发环境显示降级数量，不显示 JD 内容。

Zod 负责形状；证据层先严格验证 sourceText 与 value；级别层随后根据原文作确定性规范化。preferred 识别优先、加分、更佳等措辞并优先于 required；可放宽例外归为 unspecified；required 识别必须、须、需、需要、应、应当、精通、熟练使用/掌握等明确措辞，或任职要求、学历要求、专业要求、资格证书要求等资格上下文；其余归为 unspecified。单独的“具有/具备”、“其他要求”标题和“标签”不能作为强制依据。模型放错数组或 priority 时，程序只纠正级别，不修改 value/sourceText，也不因此拒绝整份 JD。

技能采用三个正式状态：requiredSkills、preferredSkills、unspecifiedSkills。学历、经验、证书、语言及其他要求继续使用 priority 的 required / preferred / unspecified。相同输入会得到相同分类；确定性结果不依赖模型某次把项目放在哪个级别容器。任职要求、岗位要求、任职资格和必备条件等标题提供 required 上下文；优先/加分措辞优先判为 preferred；无充分依据时为 unspecified。

字段级容错仅用于 skills 和 keywords。单项 sourceText 不存在、空白或存在可确定的技术词冲突时，该项被丢弃；职责、职位、公司、地点、薪资、学历、经验、证书、语言及其他要求属于核心数据，证据失败仍会使整份结果失败。没有任何有效证据，或至少三条辅助证据无效且无效数超过有效事实数时，也会整体失败，防止与输入明显无关的结果被接受。

程序按原文标点分句/分项检查，并支持独立标题和“任职要求：……”这类行内标题；不让同一行相邻加分技能污染必需技能。“优秀可放宽”等例外归为 unspecified。普通技能标签保留为 unspecifiedSkills。广泛引用跨多项原文或复杂条件时会保守归为 unspecified，但伪造、改写或不存在的证据仍会拒绝整份结果。

成功响应 `{ success: true, jobData, warnings }`；失败 `{ success: false, error }`。复用 getAIError 区分配置、Key、余额、频率、网络、超时、模型及其他 API 错误。无效 JSON、严重 Zod/证据失败和不完整结果返回安全中文提示，不暴露原始输出或错误堆栈。没有自动重试；一次合理响应直接完成验证与清理。

## 调用与隐私

复用 openai SDK 和现有 AI_PROVIDER、AI_API_KEY、AI_BASE_URL、AI_MODEL，不创建第二个 client。store:false，DeepSeek 关闭思考，输出上限 8000 tokens，60 秒超时。DeepSeek 使用 Responses 支持的 text.format={type:"json_object"}，不传 Chat Completions 的 response_format；JSON schema 和空值示例附在系统指令中。其他 compatible Provider 保留 json_schema 格式，所有 Provider 的结果仍经过相同 Zod 和证据验证。

## JSON 稳定性修复

旧实现直接 JSON.parse(output_text)，完整的 Markdown JSON 代码块也会报错；已有失败响应未被保存，无法确认某次真实失败究竟是代码块、附加说明或其他非法语法，不能归因于输入空行或标题。

Prompt 明确只返回一个 JSON object，不使用 Markdown、code fence、解释或前后说明，并要求转义字符串中的换行、引号和反斜杠。同时使用官方 JSON mode，不仅依赖 Prompt。

解析仅去除输出首尾空白/BOM 及完整单个外层代码块（json 标记大小写或无标记），不修改 JSON 字符串内容。前后说明、多对象、破损代码块、未转义控制字符和损坏 JSON 均拒绝；不截取任意大括号，不自动补括号或转义，不丢弃事实来修补语法。

Responses 使用 status、output message status 和 refusal 检查完整性；不依赖 Chat Completions 的 finish_reason。输出不完整、拒绝或为空时不尝试解析，不完整但恰好语法有效的结果也不能通过。8000-token 上限可能导致较长结果截断；本次未盲目提高上限或自动重试。官方也说明 JSON mode 可能出现空内容，仍需处理失败并进行真实验证。

不读取或修改 .env.local，不把 JD 或结果写入磁盘、日志、数据库或 fixture。只有用户点击按钮才将 JD 发送到配置的 Provider。前端状态只保留本次结果；输入变化清除旧预览，请求期间禁用输入和按钮避免重复及过期结果。JSON 预览仅开发环境显示。

## 验证和真实测试

自动测试仅使用虚构 JD 和模拟 fetch。覆盖完整/缺失信息、优先级、无效输入、JSON/schema/证据失败、原文快照、不存在的技能、截断及 API 错误映射；不真实调用 DeepSeek。

启动 `npm run dev`，打开 http://127.0.0.1:3000，在右侧现有 JD 输入框粘贴岗位信息，点击“AI 解析岗位 JD”。展开字段、“查看来源证据”及开发 JSON 预览，核对必备与加分要求。

## 已知限制

证据验证不能证明语义、分类或提取完整性，也无法识别所有 AI 引用真实片段却错误理解否定、备选、复杂条件的情况。优先级保护只是保守的常见措辞和上下文检查，不是完整语言解析器；若证据引用过宽，把必需与加分内容混在一起，也可能被拒绝。模型必须提供包含限定词的准确证据，不能保证算法发现所有省略限定词的情况。真实测试仍须人工检查。

不新增 ID、复杂日期/薪资解析、匹配算法或文档导出。本阶段不改 OriginalDocument、ResumeData 或解析逻辑。

官方参考：[DeepSeek Responses API](https://api-docs.deepseek.com/api/create-response/)、[Responses 兼容性](https://api-docs.deepseek.com/guides/responses_api/)、[JSON Output](https://api-docs.deepseek.com/guides/json_mode/)。
