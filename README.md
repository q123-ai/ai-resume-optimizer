# AI Resume Optimizer

AI 简历优化工具。当前已实现中文首页、PDF/DOCX 文件选择及服务器端原始文本解析，尚未接入 AI。

## 本地开发

在项目根目录运行：

```bash
npm install
npm run dev
```

浏览器访问 http://localhost:3000。按 Ctrl+C 停止服务。
首页位于 `src/app/page.tsx`，全局样式位于 `src/app/globals.css`。解析库要求 Node.js 22 或以上，当前开发环境使用 Node.js 24。

## 简历文本解析

选择文件后点击“测试解析简历”，文件以 multipart/form-data 的 `file` 字段提交至 `POST /api/parse-resume`。成功后可展开“查看解析文本”。

PDF 使用 unpdf，DOCX 使用 Mammoth。只提取原始文字，不识别经历类别，不支持 OCR；扫描版 PDF 会显示无法提取文字的提示。

文件和解析结果仅在内存中处理，不永久保存，不记录完整简历或发送到第三方服务。移除或更换文件会清除页面中的解析结果。

本地文件上限为 10MB。Vercel Functions 的请求体上限为 4.5MB（包含 multipart 开销），所以直接部署后的可接收文件会更小；部署阶段需要另行决定大文件方案。本阶段没有添加外部存储。

## 检查与生产运行

```bash
npm run lint
npm run build
npm run start
```

TypeScript 已开启 `strict: true`。构建包含类型检查。

## 环境变量与事实原则

当前阶段不需要 API Key。以后敏感配置放在 `.env.local`，不得写入前端代码或提交到 Git。
简历优化必须基于用户提供的事实。没有证据的能力只能标记为缺失或建议补充，不得编造技能、经历、学历、数字或成果。
