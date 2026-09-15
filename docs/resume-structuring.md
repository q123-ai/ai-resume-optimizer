# 第 7 阶段：原文转结构化简历

流程：选择文件 → 点击“测试解析简历” → 获得 rawText → 点击“生成结构化简历” → DeepSeek Responses API → Zod 和逐字证据验证 → 结构化预览。

只有点击生成按钮才把简历文字发送到配置的 AI Provider；不发送文件、JD、匹配要求或其他信息。不进行分析、优化或自动改写。

## 接口和验证

POST /api/ai/structure-resume 接收 JSON `{ "rawText": "..." }`。仅允许此字段，非空文本最多 30000 个 JavaScript 字符，请求体最多 256000 字节。成功返回 `{ success: true, resumeData }`，失败返回 `{ success: false, error }`，不暴露原文、AI 原始错误或验证堆栈。

复用现有 AI_PROVIDER、AI_API_KEY、AI_BASE_URL、AI_MODEL 和官方 openai SDK。使用 Responses API 的 json_schema 输出，schema 从 resumeExtractionSchema 生成。DeepSeek 支持该格式；真实兼容性由首次真实测试确认。

请求设置 store:false，DeepSeek 关闭思考，最大输出 8000 tokens，单次请求超时 60 秒，无自动重试。失败不会改为无约束输出；不完整 JSON、拒绝/截断、schema 不匹配或无原文证据均报错。

程序验证每个 sourceText 是 rawText 的连续逐字片段，且每个提取 value 是其 sourceText 的逐字片段。此阶段不归一化或改写日期与事实。AI 不生成 rawText 和 ID；通过提取验证后程序生成条目 UUID，前端再次验证返回结果及原文快照一致性。此预览不是用户确认流程或修改建议。

逐字检查不能证明分类、语义或完整性正确；比如原文包含某技能，不代表掌握该技能。首次真实测试请核对个人信息、学校、岗位、项目、日期、英文技能和来源证据，检查遗漏和错误分类。不存在的信息应为 null 或 []。

## 隐私和原始模板

不打印、记录、写盘或持久化简历文字和 AI 结果，不创建数据库。前端预览只在组件状态内保存；换文件、移除文件或重新解析后清除预览并取消旧前端请求。取消客户端请求不保证已发出的 Provider 请求被撤销。

原始 File 与 ResumeData 独立。rawText/sourceText 保持不可变，不能用语义数据重建原模板。遵守 docs/resume-data.md 的 OriginalDocument 架构约定；本阶段不实现定位、DOCX/PDF 格式读取或导出。

自动测试仅使用虚构数据和模拟 fetch，不读取 .env.local，不调用真实 DeepSeek。运行 ESLint、TypeScript、生产构建及 tests 中现有三组测试。

本地直接 `npm run dev` 即可（DeepSeek 已验证直连；用未设置代理变量的新终端）。打开 http://127.0.0.1:3000 完成上述流程，逐项展开预览和“查看来源证据”。原“开始 AI 分析”按钮仍未启用，不做 JD 或匹配分析。

官方参考：[DeepSeek Responses API](https://api-docs.deepseek.com/api/create-response/)。
