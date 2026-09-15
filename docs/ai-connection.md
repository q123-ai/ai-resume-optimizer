# AI Provider 连接测试

当前默认 Provider 是 DeepSeek；仍复用 openai@7.15.0 SDK 的 Responses API。服务器模块 src/lib/ai.ts 集中读取通用配置，不回退读取旧 OPENAI_* 变量。

## 手动配置

在自己的 .env.local 中手动配置以下格式，真实 Key 仅由你本地填写，不要发送到聊天中：

```dotenv
AI_PROVIDER=deepseek
AI_API_KEY=
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-flash
```

删除不再使用的旧 OPENAI_* 配置由你自行决定；它们已不被项目使用。切换其他 OpenAI-compatible Provider 时，明确填写 Provider 名称、HTTPS base URL 和模型即可，无需更换 SDK。

## 保留 Clash 代理并重启

在运行旧开发服务器的终端按 Ctrl+C，然后在项目根目录 PowerShell 中执行：

```powershell
$env:HTTP_PROXY='http://127.0.0.1:7897'
$env:HTTPS_PROXY='http://127.0.0.1:7897'
$env:ALL_PROXY='http://127.0.0.1:7897'
$env:NO_PROXY='localhost,127.0.0.1,::1'
$env:NODE_USE_ENV_PROXY='1'
npm run dev -- --hostname 127.0.0.1
```

Node 24 的内置 fetch 在进程启动时启用环境变量代理。仅把代理变量放入 Next.js 随后加载的 .env.local，不能保证启动时的代理初始化。上述变量只影响该终端启动的进程，不修改系统代理或 Git 配置。

访问 http://127.0.0.1:3000，页面底部“使用流程”下方点击“测试 AI 连接”。浏览器只发送无请求体 POST /api/ai/health，不携带 Key。生产环境隐藏按钮，接口返回 404。

## 请求及错误

请求只要求返回 OK，不发送简历、JD 或个人信息。20 秒超时，关闭自动重试。DeepSeek 健康检查设置 reasoning.effort=none 关闭默认思考，最大输出 32 tokens。

设置 store:false；DeepSeek 官方描述 Responses API 为无状态，不在服务器保存 response/conversation。这不代表所有供应商的日志或数据政策都相同，后续处理简历前须重新评估。

缺少配置、Key 无效、HTTP 402 余额不足、insufficient_quota、credit_balance_exhausted、rate limit、网络/代理故障、超时、模型不存在、权限错误及其他 API 错误使用独立的安全中文提示。不会返回原始错误消息、Key、堆栈或请求头。

.env* 被 Git 忽略，唯一例外是无真实 Key 的 .env.example。客户端不导入服务器模块，server-only 防止误用。测试只使用虚构占位值和模拟 fetch，不调用真实 DeepSeek API。

官方参考：[Responses API](https://api-docs.deepseek.com/api/create-response/)、[错误码](https://api-docs.deepseek.com/quick_start/error_codes/)、[Node 代理支持](https://nodejs.org/download/release/latest-v24.x/docs/api/http.html#built-in-proxy-support)。
