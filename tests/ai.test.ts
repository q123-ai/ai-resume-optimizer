import { test } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { checkAIConnection, getAIClient, getAIConfig, getAIError, AIConfigurationError } from "../src/lib/ai";

test("missing key returns a safe configuration error", () => {
  const previous = process.env.AI_API_KEY;
  delete process.env.AI_API_KEY;
  try {
    assert.throws(getAIClient, AIConfigurationError);
    assert.equal(getAIError(new AIConfigurationError()).status, 503);
  } finally {
    if (previous !== undefined) process.env.AI_API_KEY = previous;
  }
});

test("SDK sends only the fixed health request, with storage disabled", async () => {
  const client = new OpenAI({
    apiKey: "fictional-test-placeholder",
    baseURL: "https://api.deepseek.com", maxRetries: 0,
    fetch: async (_url, init) => {
      assert.equal(String(_url), "https://api.deepseek.com/responses");
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body, { model: "deepseek-flash", input: "只返回 OK，不要添加其他内容。", max_output_tokens: 32, store: false, reasoning: { effort: "none" } });
      return Response.json({ id: "resp_example", object: "response", status: "completed", model: "deepseek-flash-test", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "OK", annotations: [] }] }] });
    },
  });
  assert.equal(await checkAIConnection(client, "deepseek-flash", "deepseek"), "deepseek-flash-test");
});

test("upstream failures have distinct safe messages", () => {
  const failures = [
    new OpenAI.AuthenticationError(401, {}, "private upstream details", new Headers()),
    new OpenAI.APIConnectionError({ message: "private upstream details" }),
    new OpenAI.APIConnectionTimeoutError(),
    new OpenAI.RateLimitError(429, {}, "private upstream details", new Headers()),
    new OpenAI.RateLimitError(429, { code: "insufficient_quota" }, "private upstream details", new Headers()),
    new Error("private upstream details"),
  ];
  const messages = failures.map((error) => getAIError(error).error);
  assert.equal(new Set(messages).size, failures.length);
  for (const message of messages) assert.ok(!message.includes("private upstream details"));
  assert.equal(getAIError(failures[2]).status, 504);
});

test("DeepSeek balance and quota failures are not classified as rate limits", () => {
  for (const error of [
    new OpenAI.APIError(402, {}, "private details", new Headers()),
    new OpenAI.RateLimitError(429, { type: "insufficient_quota", code: "credit_balance_exhausted" }, "private details", new Headers()),
  ]) assert.match(getAIError(error).error, /余额不足/);
});

test("model, permission, provider and generic API failures have safe distinct messages", () => {
  const messages = [
    new OpenAI.NotFoundError(404, { code: "model_not_found" }, "private details", new Headers()),
    new OpenAI.PermissionDeniedError(403, {}, "private details", new Headers()),
    new OpenAI.BadRequestError(400, {}, "private details", new Headers()),
    new OpenAI.InternalServerError(500, {}, "private details", new Headers()),
  ].map((error) => getAIError(error).error);
  assert.equal(new Set(messages).size, 4);
  for (const message of messages) assert.ok(!message.includes("private details"));
});

test("configuration rejects unsafe base URLs without exposing their contents", () => {
  const previous = process.env.AI_BASE_URL;
  process.env.AI_BASE_URL = "http://example.com/private-value";
  try {
    assert.throws(getAIConfig, AIConfigurationError);
  } finally {
    if (previous === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = previous;
  }
});
