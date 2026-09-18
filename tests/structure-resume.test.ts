import { test } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { structureResume, structureResumeWithRetry, structureResumeRequestSchema, ResumeStructureError } from "../src/lib/structure-resume";
import type { ResumeExtraction } from "../src/types/resume";

// Entirely fictional. Never use real resume text or credentials in these tests.
const rawText = "张三\nexample@example.com\n示例大学 本科 2023.09 至今\n示例科技有限公司 实习生\n示例项目 Excel\n示例证书\n志愿活动";
const sourced = (value: string) => ({ value, sourceText: value });
const extraction: ResumeExtraction = {
  personalInfo: { name: sourced("张三"), phone: null, email: sourced("example@example.com"), location: null, website: null, linkedin: null, github: null, other: [] },
  summary: null,
  education: [{ school: sourced("示例大学"), degree: sourced("本科"), major: null, startDate: sourced("2023.09"), endDate: sourced("至今"), description: [] }],
  experience: [{ company: sourced("示例科技有限公司"), position: sourced("实习生"), startDate: null, endDate: null, location: null, description: [] }],
  projects: [{ name: sourced("示例项目"), role: null, startDate: null, endDate: null, description: [], technologies: [sourced("Excel")] }],
  skills: [{ name: sourced("Excel"), category: null, description: null }],
  certificates: [{ name: sourced("示例证书"), issuer: null, date: null, description: [] }],
  other: [{ title: null, content: sourced("志愿活动") }],
};

function mockClient(text: string, status = "completed") {
  let calls = 0;
  const client = new OpenAI({ apiKey: "fictional-placeholder", baseURL: "https://api.deepseek.com", maxRetries: 0,
    fetch: async (url, options) => {
      calls++;
      assert.equal(String(url), "https://api.deepseek.com/responses");
      const body = JSON.parse(String(options?.body));
      assert.equal(body.input, rawText);
      assert.equal(body.store, false);
      assert.equal(body.reasoning.effort, "none");
      assert.deepEqual(body.text.format, { type: "json_object" });
      assert.ok(!("response_format" in body));
      assert.match(body.instructions, /JSON schema/);
      assert.match(body.instructions, /"additionalProperties":false/);
      assert.match(body.instructions, /只返回一个 JSON object/);
      assert.match(body.instructions, /不得推断/);
      return Response.json({ id: "resp_example", object: "response", status, model: "deepseek-flash", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }] });
    },
  });
  return { client, calls: () => calls };
}

test("Chinese and English facts flow through SDK, Zod and program IDs without rewriting source", async () => {
  const mock = mockClient(JSON.stringify(extraction));
  const data = await structureResume(mock.client, "deepseek-flash", "deepseek", rawText);
  assert.equal(mock.calls(), 1);
  assert.equal(data.rawText, rawText);
  assert.deepEqual(data.personalInfo.name, sourced("张三"));
  assert.deepEqual(data.education[0].endDate, sourced("至今"));
  assert.equal(data.projects[0].technologies[0].value, "Excel");
  assert.equal(data.summary, null);
  assert.match(data.education[0].id, /^[a-f0-9-]{36}$/);
});

test("rejects invalid JSON, wrong schema, fabricated evidence and invented values without exposing text", async () => {
  const cases = [
    ["not json", "json_parse"],
    [JSON.stringify({ education: "invalid" }), "schema_validation"],
    [JSON.stringify({ ...extraction, summary: sourced("原文不存在的成果") }), "source_validation"],
    [JSON.stringify({ ...extraction, summary: { value: "虚构成就", sourceText: "张三" } }), "source_validation"],
    [JSON.stringify({ ...extraction, rawText: "AI cannot own rawText" }), "schema_validation"],
  ] as const;
  for (const [output, reason] of cases) {
    const mock = mockClient(output);
    await assert.rejects(structureResume(mock.client, "deepseek-flash", "deepseek", rawText), (error: unknown) => {
      assert.ok(error instanceof ResumeStructureError);
      assert.equal(error.reason, reason);
      assert.ok(!error.message.includes("虚构成就"));
      assert.ok(!error.message.includes("张三"));
      return true;
    });
    assert.equal(mock.calls(), 1);
  }
});

test("source-validation diagnostics expose only field path and rule", async () => {
  const mock = mockClient(JSON.stringify({ ...extraction, summary: { value: "虚构成就", sourceText: "张三" } }));
  await assert.rejects(structureResume(mock.client, "deepseek-flash", "deepseek", rawText), (error: unknown) => {
    assert.ok(error instanceof ResumeStructureError);
    assert.equal(error.reason, "source_validation");
    assert.equal(error.field, "summary.value");
    assert.equal(error.rule, "value_not_in_source");
    assert.ok(!error.message.includes("虚构成就"));
    assert.ok(!error.message.includes("张三"));
    return true;
  });
});

test("accepts one complete outer JSON fence without weakening schema or evidence checks", async () => {
  for (const language of ["json", "JSON", ""]) {
    const mock = mockClient(`\ufeff \n\`\`\`${language}\r\n${JSON.stringify(extraction, null, 2)}\r\n\`\`\`\n `);
    const data = await structureResume(mock.client, "deepseek-flash", "deepseek", rawText);
    assert.equal(data.rawText, rawText);
    assert.equal(mock.calls(), 1);
  }
});

test("rejects prose, multiple objects, broken fences and truncated JSON without repair or retry", async () => {
  const json = JSON.stringify(extraction);
  for (const output of ["以下是结果：" + json, json + "\n完成。", json + json, `\`\`\`json\n${json}`, json.slice(0, -2)]) {
    const mock = mockClient(output);
    await assert.rejects(structureResume(mock.client, "deepseek-flash", "deepseek", rawText),
      (error: unknown) => error instanceof ResumeStructureError && error.reason === "json_parse");
    assert.equal(mock.calls(), 1);
  }
});

test("rejects truncated, empty and failed outputs", async () => {
  for (const [text, status] of [[JSON.stringify(extraction), "incomplete"], ["", "completed"], ["", "failed"]]) {
    const mock = mockClient(text, status);
    await assert.rejects(structureResume(mock.client, "deepseek-flash", "deepseek", rawText),
      (error: unknown) => error instanceof ResumeStructureError && error.reason === "incomplete_response");
  }
});

test("rejects an incomplete message even when the top-level response says completed", async () => {
  const client = new OpenAI({ apiKey: "fictional-placeholder", maxRetries: 0, fetch: async () => Response.json({
    id: "resp_example", object: "response", status: "completed", model: "deepseek-flash",
    output: [{ type: "message", role: "assistant", status: "incomplete", content: [{ type: "output_text", text: JSON.stringify(extraction), annotations: [] }] }],
  }) });
  await assert.rejects(structureResume(client, "deepseek-flash", "deepseek", rawText),
    (error: unknown) => error instanceof ResumeStructureError && error.reason === "incomplete_response");
});

test("one-click wrapper retries one contract-invalid model response with the same raw text", async () => {
  let calls = 0;
  const client = new OpenAI({ apiKey: "fictional-placeholder", baseURL: "https://api.deepseek.com", maxRetries: 0,
    fetch: async (_url, options) => {
      calls++;
      const body = JSON.parse(String(options?.body));
      assert.equal(body.input, rawText);
      const text = calls === 1 ? "not json" : JSON.stringify(extraction);
      return Response.json({ id: `resp_${calls}`, object: "response", status: "completed", model: "deepseek-flash", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }] });
    },
  });
  const data = await structureResumeWithRetry(client, "deepseek-flash", "deepseek", rawText);
  assert.equal(calls, 2);
  assert.equal(data.rawText, rawText);
});

test("one-click wrapper retries at most once and never retries provider failures", async () => {
  let invalidCalls = 0;
  const invalidClient = new OpenAI({ apiKey: "fictional-placeholder", maxRetries: 0, fetch: async () => {
    invalidCalls++;
    return Response.json({ id: `resp_${invalidCalls}`, object: "response", status: "completed", model: "deepseek-flash", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "invalid", annotations: [] }] }] });
  } });
  await assert.rejects(structureResumeWithRetry(invalidClient, "deepseek-flash", "deepseek", rawText),
    (error: unknown) => error instanceof ResumeStructureError && error.reason === "json_parse");
  assert.equal(invalidCalls, 2);

  let providerCalls = 0;
  const providerClient = new OpenAI({ apiKey: "fictional-placeholder", maxRetries: 0, fetch: async () => {
    providerCalls++;
    return Response.json({ error: { message: "private upstream details", type: "api_error" } }, { status: 500 });
  } });
  await assert.rejects(structureResumeWithRetry(providerClient, "deepseek-flash", "deepseek", rawText), OpenAI.APIError);
  assert.equal(providerCalls, 1);
});

test("invalid request is rejected before SDK fetch", async () => {
  for (const value of [undefined, "", "  ", "x".repeat(30_001)]) assert.equal(structureResumeRequestSchema.safeParse({ rawText: value }).success, false);
  assert.equal(structureResumeRequestSchema.safeParse({ rawText, jd: "not allowed" }).success, false);
  const mock = mockClient(JSON.stringify(extraction));
  await assert.rejects(structureResume(mock.client, "deepseek-flash", "deepseek", ""));
  assert.equal(mock.calls(), 0);
});
