import { checkAIConnection, getAIClient, getAIConfig, getAIError } from "@/lib/ai";

export const runtime = "nodejs";

export async function POST() {
  const headers = { "Cache-Control": "no-store" };
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ success: false, error: "此测试入口仅用于本地开发。" }, { status: 404, headers });
  }
  try {
    const config = getAIConfig();
    const model = await checkAIConnection(getAIClient(), config.model, config.provider);
    return Response.json({ success: true, message: "AI API 连接成功", model }, { headers });
  } catch (error: unknown) {
    const failure = getAIError(error);
    return Response.json({ success: false, error: failure.error }, { status: failure.status, headers });
  }
}
