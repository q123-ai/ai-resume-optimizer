import "server-only";
import OpenAI from "openai";

export class AIConfigurationError extends Error {}

export function getAIConfig() {
  const provider = process.env.AI_PROVIDER?.trim() || "deepseek";
  const baseURL = process.env.AI_BASE_URL?.trim() || "https://api.deepseek.com";
  const model = process.env.AI_MODEL?.trim() || "deepseek-flash";
  let url: URL;
  try { url = new URL(baseURL); } catch { throw new AIConfigurationError("AI_BASE_URL 配置错误，请填写有效的 HTTPS API 地址。"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new AIConfigurationError("AI_BASE_URL 必须是无认证信息、查询参数或片段的 HTTPS API 地址。");
  }
  if (provider !== "deepseek" && (!process.env.AI_BASE_URL?.trim() || !process.env.AI_MODEL?.trim())) {
    throw new AIConfigurationError("使用其他 AI Provider 时，请明确配置 AI_BASE_URL 和 AI_MODEL。");
  }
  return { provider, baseURL, model };
}

export function getAIClient() {
  const config = getAIConfig();
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) throw new AIConfigurationError("尚未配置 AI_API_KEY，请在本地 .env.local 中配置后重启开发服务器。");
  return new OpenAI({ apiKey, baseURL: config.baseURL, timeout: 20_000, maxRetries: 0 });
}

export async function checkAIConnection(client: OpenAI, model: string, provider: string) {
  const response = await client.responses.create({
    model,
    input: "只返回 OK，不要添加其他内容。",
    max_output_tokens: 32,
    store: false,
    ...(provider === "deepseek" ? { reasoning: { effort: "none" as const } } : {}),
  });
  if (response.status !== "completed" || response.output_text.trim() !== "OK") {
    throw new Error("Unexpected health check response");
  }
  return response.model;
}

export function getAIError(error: unknown): { status: number; error: string } {
  if (error instanceof AIConfigurationError) return { status: 503, error: error.message };
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return { status: 504, error: "连接 AI 服务超时，请检查服务器网络及代理后重试。" };
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return { status: 503, error: "无法连接 AI 服务，请检查服务器网络及代理配置。" };
  }
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401) return { status: 503, error: "AI API Key 无效，请检查服务器端配置。" };
    if (error.status === 402 || error.type === "insufficient_quota" || error.code === "insufficient_quota" || error.code === "credit_balance_exhausted" || error.code?.startsWith("billing_")) {
      return { status: 503, error: "AI API 余额不足或可用额度耗尽，请检查当前 Provider 的余额及账单。" };
    }
    if (error.status === 429) return { status: 429, error: "AI 请求频率达到限制，请稍后重试。" };
    if (error.code === "model_not_found") return { status: 503, error: "AI 模型不存在或不可访问，请检查 AI_MODEL 及模型权限。" };
    if (error.status === 404) return { status: 503, error: "AI 模型或 API 接口不存在，请检查 AI_MODEL 和 AI_BASE_URL。" };
    if (error.status === 403) return { status: 503, error: "当前账户无权访问 AI 服务，请检查项目及模型权限。" };
    if (error.status === 400 || error.status === 422) return { status: 503, error: "AI Provider 不接受当前请求，请检查模型及 Responses API 兼容性配置。" };
  }
  return { status: 500, error: "AI 服务暂时不可用，请稍后重试。" };
}
