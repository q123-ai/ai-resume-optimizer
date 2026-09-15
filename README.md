# AI Resume Optimizer

AI 简历优化工具。当前阶段仅初始化 Next.js、TypeScript 和 Tailwind CSS，保留默认首页。

## 本地开发

在项目根目录运行：

```bash
npm install
npm run dev
```

浏览器访问 http://localhost:3000。按 Ctrl+C 停止服务。
默认首页位于 `src/app/page.tsx`，全局样式位于 `src/app/globals.css`。

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
