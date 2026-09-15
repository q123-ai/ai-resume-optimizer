import { test } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { structureResume, structureResumeRequestSchema, ResumeStructureError } from "../src/lib/structure-resume";
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
      assert.equal(body.text.format.type, "json_schema");
      assert.equal(body.text.format.schema.additionalProperties, false);
      assert.ok(!("id" in body.text.format.schema.properties.education.items.properties));
      assert.ok(!("rawText" in body.text.format.schema.properties));
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
  const outputs = [
    "not json",
    JSON.stringify({ education: "invalid" }),
    JSON.stringify({ ...extraction, summary: sourced("原文不存在的成果") }),
    JSON.stringify({ ...extraction, summary: { value: "虚构成就", sourceText: "张三" } }),
    JSON.stringify({ ...extraction, rawText: "AI cannot own rawText" }),
  ];
  for (const output of outputs) {
    const mock = mockClient(output);
    await assert.rejects(structureResume(mock.client, "deepseek-flash", "deepseek", rawText), (error: unknown) => {
      assert.ok(error instanceof ResumeStructureError);
      assert.ok(!error.message.includes("虚构成就"));
      assert.ok(!error.message.includes("张三"));
      return true;
    });
    assert.equal(mock.calls(), 1);
  }
});

test("rejects truncated, empty and failed outputs", async () => {
  for (const [text, status] of [[JSON.stringify(extraction), "incomplete"], ["", "completed"], ["", "failed"]]) {
    const mock = mockClient(text, status);
    await assert.rejects(structureResume(mock.client, "deepseek-flash", "deepseek", rawText), ResumeStructureError);
  }
});

test("invalid request is rejected before SDK fetch", async () => {
  for (const value of [undefined, "", "  ", "x".repeat(30_001)]) assert.equal(structureResumeRequestSchema.safeParse({ rawText: value }).success, false);
  assert.equal(structureResumeRequestSchema.safeParse({ rawText, jd: "not allowed" }).success, false);
  const mock = mockClient(JSON.stringify(extraction));
  await assert.rejects(structureResume(mock.client, "deepseek-flash", "deepseek", ""));
  assert.equal(mock.calls(), 0);
});
