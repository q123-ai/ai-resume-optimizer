# 第 9.5 阶段：一键 AI 分析

普通用户只需选择 PDF/DOCX、粘贴岗位 JD、点击“开始 AI 分析”。浏览器发送一次 multipart/form-data 请求到 POST /api/ai/analyze-resume，服务端按固定顺序执行：

1. parseResumeFile：验证文件并在内存中提取 rawText。
2. structureResume：生成并验证 ResumeData。
3. structureJob：生成并验证 JobData。
4. analyzeMatch：生成 MatchAnalysis；继续使用已有 evidence validation、关键词覆盖和评分。

任意阶段抛错后，编排函数立即退出，后续函数不会调用。解析、AI client、schema、评分和证据逻辑均复用现有模块。原 /api/parse-resume、/api/ai/structure-resume、/api/ai/structure-job 和 /api/ai/analyze-match 保留，开发环境可在折叠调试区域单独调用前置步骤。

前端只显示一个主 loading 状态，不伪造百分比或无法从单次 HTTP 响应确认的细分进度。请求锁保证同一时刻最多一个 pipeline 请求；更换文件或修改 JD 会 abort 当前请求、清除旧结果并使旧响应失效。按钮仅在合法文件已选择且 JD 非空、不超过 20000 字符时启用。

API Key 仍只由服务器 AI client 读取。文件和文本只在当前内存请求中使用，不保存到磁盘、数据库或日志。响应不包含 ResumeData、JobData 或原始文档，只返回经过验证的 MatchAnalysis。
