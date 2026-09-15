"use client";

import { useRef, useState } from "react";

export default function AIConnectionTest() {
  const busy = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function testConnection() {
    if (busy.current) return;
    busy.current = true;
    setIsLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/ai/health", { method: "POST" });
      const result: unknown = await response.json();
      if (typeof result !== "object" || result === null || !("success" in result)) {
        setMessage("AI 服务连接失败：服务器返回异常，请稍后重试。");
      } else if (response.ok && result.success === true) {
        setMessage("✓ AI 服务连接正常");
      } else {
        const reason = "error" in result && typeof result.error === "string" ? result.error : "服务暂时不可用，请稍后重试。";
        setMessage(`AI 服务连接失败：${reason}`);
      }
    } catch {
      setMessage("AI 服务连接失败：无法连接本地服务器，请检查网络后重试。");
    } finally {
      busy.current = false;
      setIsLoading(false);
    }
  }

  return (
    <section aria-label="开发测试" className="mt-8 border-t border-slate-200 pt-4 text-center text-xs text-slate-500">
      <span className="mr-3">开发测试</span>
      <button type="button" onClick={testConnection} disabled={isLoading} className="rounded px-2 py-1 text-blue-600 underline underline-offset-4 disabled:cursor-wait disabled:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
        {isLoading ? "正在连接 AI 服务……" : "测试 AI 连接"}
      </button>
      <p role="status" aria-live="polite" className="mt-2 break-words">{message}</p>
    </section>
  );
}
