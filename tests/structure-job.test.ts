import { test } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { jobExtractionSchema, type JobExtraction } from "../src/types/job";
import { createJobData, createJobDataWithWarnings, validateJobData, JobValidationError } from "../src/lib/job";
import { getAIError, AIConfigurationError } from "../src/lib/ai";
import { structureJob, structureJobRequestSchema, JobStructureError } from "../src/lib/structure-job";
import { getJobInputError, JobClientError, requestStructuredJob } from "../src/lib/job-client";

// Fictional hiring information only. No real JD, personal information or keys.
const rawText = "  职位：示例数据分析员\n公司：示例科技公司\n地点：示例城市\n工作类型：全职\n薪资：8000-10000元\n岗位职责：制作业务报告\n任职要求：熟练使用 Excel\n有 Python 使用经验优先\n必须本科及以上\n必须有2年工作经验\nCPA 优先\n英语熟练优先\n出差安排待商议  ";
const sourced = (value: string) => ({ value, sourceText: value });
const extraction: JobExtraction = {
  jobTitle: sourced("示例数据分析员"), companyName: sourced("示例科技公司"), location: sourced("示例城市"), employmentType: sourced("全职"), salary: sourced("8000-10000元"),
  responsibilities: [sourced("制作业务报告")], requiredSkills: [sourced("熟练使用 Excel")], preferredSkills: [sourced("有 Python 使用经验优先")], unspecifiedSkills: [],
  educationRequirements: [{ ...sourced("必须本科及以上"), priority: "required" }], experienceRequirements: [{ ...sourced("必须有2年工作经验"), priority: "required" }],
  certifications: [{ ...sourced("CPA 优先"), priority: "preferred" }], languageRequirements: [{ ...sourced("英语熟练优先"), priority: "preferred" }], otherRequirements: [{ ...sourced("出差安排待商议"), priority: "unspecified" }],
  keywords: [sourced("Excel"), sourced("Python")],
};

function mockClient(output: string, status = "completed", expectedRawText = rawText) {
  let calls = 0;
  const client = new OpenAI({ apiKey: "fictional-placeholder", baseURL: "https://api.deepseek.com", maxRetries: 0,
    fetch: async (url, options) => {
      calls++;
      assert.equal(String(url), "https://api.deepseek.com/responses");
      const body = JSON.parse(String(options?.body));
      assert.equal(body.input, expectedRawText);
      assert.equal(body.store, false);
      assert.equal(body.reasoning.effort, "none");
      assert.deepEqual(body.text.format, { type: "json_object" });
      assert.ok(!("response_format" in body));
      assert.match(body.instructions, /JSON schema/);
      assert.match(body.instructions, /"additionalProperties":false/);
      assert.match(body.instructions, /"companyName"/);
      assert.match(body.instructions, /只返回一个 JSON object/);
      assert.match(body.instructions, /唯一事实来源/);
      return Response.json({ id: "resp_example", object: "response", status, model: "deepseek-flash", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: output, annotations: [] }] }] });
    },
  });
  return { client, calls: () => calls };
}

test("complete JD travels through Responses schema and Zod; rawText stays exactly server input", async () => {
  const mock = mockClient(JSON.stringify(extraction));
  const { data } = await structureJob(mock.client, "deepseek-flash", "deepseek", rawText);
  assert.equal(mock.calls(), 1);
  assert.equal(data.rawText, rawText);
  assert.deepEqual(data.jobTitle, sourced("示例数据分析员"));
  assert.deepEqual(data.salary, sourced("8000-10000元"));
});

test("missing company remains null without guessing", () => {
  const text = rawText.replace("公司：示例科技公司\n", "");
  assert.equal(createJobData({ ...extraction, companyName: null }, text).companyName, null);
  assert.throws(() => createJobData(extraction, text));
});

test("missing salary remains null without guessing", () => {
  const text = rawText.replace("薪资：8000-10000元\n", "");
  assert.equal(createJobData({ ...extraction, salary: null }, text).salary, null);
  assert.throws(() => createJobData(extraction, text));
});

test("required and preferred stay distinct; ambiguous requirements stay unspecified", () => {
  const data = createJobData(extraction, rawText);
  assert.equal(data.requiredSkills[0].value, "熟练使用 Excel");
  assert.equal(data.preferredSkills[0].value, "有 Python 使用经验优先");
  assert.equal(data.certifications[0].priority, "preferred");
  assert.equal(data.otherRequirements[0].priority, "required");
  assert.deepEqual(createJobData({ ...extraction, requiredSkills: extraction.preferredSkills, preferredSkills: [] }, rawText).preferredSkills, extraction.preferredSkills);
  assert.equal(createJobData({ ...extraction, certifications: [{ ...extraction.certifications[0], priority: "required" }] }, rawText).certifications[0].priority, "preferred");
});

test("normalizes explicit English and Chinese preferences", () => {
  for (const sourceText of ["SQL 加分", "SQL preferred", "SQL nice-to-have", "SQL is a plus"]) {
    const data = createJobData({ ...extraction, requiredSkills: [{ value: "SQL", sourceText }], preferredSkills: [] }, rawText + "\n" + sourceText);
    assert.equal(data.requiredSkills.length, 0);
    assert.equal(data.preferredSkills[0].value, "SQL");
  }
});

test("omitting a preference qualifier from evidence still uses its original line", () => {
  assert.equal(createJobData({ ...extraction, requiredSkills: [sourced("Python")], preferredSkills: [] }, rawText).preferredSkills[0].value, "Python");
  assert.equal(createJobData({ ...extraction, certifications: [{ ...sourced("CPA"), priority: "required" }] }, rawText).certifications[0].priority, "preferred");
});

test("empty, wrong-type, too long and extra-field JD inputs are rejected without SDK requests", async () => {
  const mock = mockClient(JSON.stringify(extraction));
  for (const text of ["", "  ", "x".repeat(20_001)]) {
    await assert.rejects(structureJob(mock.client, "deepseek-flash", "deepseek", text));
  }
  for (const rawText of [null, undefined, 123]) assert.equal(structureJobRequestSchema.safeParse({ rawText }).success, false);
  assert.equal(structureJobRequestSchema.safeParse({ rawText, resume: "not allowed" }).success, false);
  assert.equal(mock.calls(), 0);
});

test("invalid AI JSON has a safe error and no automatic retry", async () => {
  const mock = mockClient("invalid json");
  await assert.rejects(structureJob(mock.client, "deepseek-flash", "deepseek", rawText), /不是有效 JSON/);
  assert.equal(mock.calls(), 1);
});

test("a single complete Markdown JSON fence is accepted without changing evidence", async () => {
  for (const fence of ["json", "JSON", ""]) {
    const output = `\ufeff \n\`\`\`${fence}\r\n${JSON.stringify(extraction, null, 2)}\r\n\`\`\`\n `;
    const mock = mockClient(output);
    const { data } = await structureJob(mock.client, "deepseek-flash", "deepseek", rawText);
    assert.equal(data.rawText, rawText);
    assert.deepEqual(data.requiredSkills, extraction.requiredSkills);
    assert.equal(mock.calls(), 1);
  }
});

test("Chinese, headings, numbering, blank lines, quotes and escapes survive JD extraction", async () => {
  const detail = '# 岗位职责\n\n1. 制作“业务报告”。\n2. 维护 "Excel" 文件，路径 C:\\示例\\报告。';
  const input = rawText + "\n\n" + detail;
  const result = { ...extraction, responsibilities: [sourced(detail)] };
  const mock = mockClient(JSON.stringify(result), "completed", input);
  const { data } = await structureJob(mock.client, "deepseek-flash", "deepseek", input);
  assert.equal(data.rawText, input);
  assert.deepEqual(data.responsibilities, result.responsibilities);
});

test("extra prose, multiple objects, broken fences and malformed JSON are rejected without repair", async () => {
  const json = JSON.stringify(extraction);
  for (const output of ["以下是结果：" + json, json + "\n解析完成。", json + json, `\`\`\`json\n${json}`, `\`\`\`json\n${json}\n\`\`\`\n说明`, '[{}]', 'null', '{"jobTitle":"含未转义\n换行"}', json.slice(0, -2)]) {
    const mock = mockClient(output);
    await assert.rejects(structureJob(mock.client, "deepseek-flash", "deepseek", rawText), JobStructureError);
    assert.equal(mock.calls(), 1);
  }
});

test("valid fenced JSON cannot bypass Zod; one invalid auxiliary item is degraded", async () => {
  const malformed = mockClient(`\`\`\`json\n${JSON.stringify({ requiredSkills: "Excel" })}\n\`\`\``);
  await assert.rejects(structureJob(malformed.client, "deepseek-flash", "deepseek", rawText), /未通过结构/);
  const partial = mockClient(`\`\`\`json\n${JSON.stringify({ ...extraction, requiredSkills: [sourced("SQL")] })}\n\`\`\``);
  const result = await structureJob(partial.client, "deepseek-flash", "deepseek", rawText);
  assert.equal(result.data.requiredSkills.length, 0);
  assert.equal(result.warnings[0].rule, "dropped_source_not_found");
});

test("incomplete output message is rejected even if response reports completed and JSON looks valid", async () => {
  const client = new OpenAI({ apiKey: "fictional-placeholder", maxRetries: 0, fetch: async () => Response.json({ id: "resp_example", object: "response", status: "completed", model: "deepseek-flash", output: [{ type: "message", role: "assistant", status: "incomplete", content: [{ type: "output_text", text: JSON.stringify(extraction), annotations: [] }] }] }) });
  await assert.rejects(structureJob(client, "deepseek-flash", "deepseek", rawText), /截断或拒绝/);
});

test("Zod rejects wrong fields, wrong priorities, AI rawText and malformed shape", async () => {
  assert.equal(jobExtractionSchema.safeParse({ ...extraction, rawText: "AI-created" }).success, false);
  for (const result of [{ requiredSkills: "Excel" }, { ...extraction, certifications: [{ ...extraction.certifications[0], priority: "must" }] }, { ...extraction, rawText: "AI-created" }]) {
    const mock = mockClient(JSON.stringify(result));
    await assert.rejects(structureJob(mock.client, "deepseek-flash", "deepseek", rawText), JobValidationError);
  }
});

test("invalid auxiliary evidence is dropped without hiding its diagnostic", async () => {
  for (const skill of [sourced("SQL"), { value: "SQL", sourceText: "熟练使用 Excel" }, { value: "Excel", sourceText: " " }]) {
    const mock = mockClient(JSON.stringify({ ...extraction, requiredSkills: [skill] }));
    const result = await structureJob(mock.client, "deepseek-flash", "deepseek", rawText);
    assert.equal(result.data.requiredSkills.length, 0);
    assert.equal(result.warnings.length, 1);
  }
  assert.equal(createJobDataWithWarnings({ ...extraction, keywords: [sourced("Power BI")] }, rawText).warnings.length, 1);
});

test("incomplete, failed and empty AI responses do not become successful JobData", async () => {
  for (const [output, status] of [[JSON.stringify(extraction), "incomplete"], ["", "failed"], ["", "completed"]]) {
    const mock = mockClient(output, status);
    await assert.rejects(structureJob(mock.client, "deepseek-flash", "deepseek", rawText), /未返回完整/);
  }
});

test("provider HTTP failures retain existing distinct safe error mapping", async () => {
  for (const [status, code, expected] of [[401, "invalid_api_key", /Key 无效/], [402, "", /余额不足/], [429, "credit_balance_exhausted", /余额不足/], [429, "rate_limit_exceeded", /频率/], [404, "model_not_found", /模型不存在/], [403, "", /无权/], [500, "", /暂时不可用/]] as const) {
    let calls = 0;
    const client = new OpenAI({ apiKey: "fictional-placeholder", maxRetries: 0, fetch: async () => { calls++; return Response.json({ error: { message: "private upstream details", type: "api_error", code } }, { status }); } });
    await assert.rejects(structureJob(client, "deepseek-flash", "deepseek", rawText), (error: unknown) => {
      const mapped = getAIError(error);
      assert.match(mapped.error, expected);
      assert.ok(!mapped.error.includes("private upstream details"));
      return true;
    });
    assert.equal(calls, 1);
  }
  assert.match(getAIError(new AIConfigurationError("AI Provider 配置错误")).error, /配置错误/);
  assert.match(getAIError(new OpenAI.APIConnectionError({})).error, /网络及代理/);
  assert.equal(getAIError(new OpenAI.APIConnectionTimeoutError()).status, 504);
});

test("evidence allows whitespace comparison differences without rewriting rawText or sourceText", () => {
  const original = rawText + "\r\n专业要求：\r\n经济学类、  财政学类。";
  const sourceText = "专业要求：\n经济学类、 财政学类。";
  const data = createJobData({ ...extraction, educationRequirements: [{ value: "经济学类、 财政学类", sourceText, priority: "required" }] }, original);
  assert.equal(data.rawText, original);
  assert.equal(data.educationRequirements[0].sourceText, sourceText);
});

test("professional and other requirement numbered lists with headings are accepted", () => {
  const text = rawText + "\n# 专业要求：\n1、经济学类、财政学类\n其他要求：\n2、财务类岗位须具备 CPA\n3、优秀的学历可放宽至专科";
  const data = createJobData({ ...extraction, educationRequirements: [{ ...sourced("经济学类、财政学类"), priority: "required" }], otherRequirements: [{ ...sourced("财务类岗位须具备 CPA"), priority: "required" }, { ...sourced("优秀的学历可放宽至专科"), priority: "unspecified" }] }, text);
  assert.equal(data.otherRequirements[1].priority, "unspecified");
});

test("mandatory and preferred clauses on the same line do not contaminate each other", () => {
  const text = rawText + "\n财务类岗位须具备 VBA，Power BI 使用经验优先。";
  const data = createJobData({ ...extraction, requiredSkills: [sourced("VBA")], preferredSkills: [sourced("Power BI")] }, text);
  assert.equal(data.requiredSkills[0].value, "VBA");
  assert.equal(createJobData({ ...extraction, requiredSkills: [sourced("Power BI")], preferredSkills: [] }, text).preferredSkills[0].value, "Power BI");
});

test("unmarked or conditional requirements normalize to unspecified", () => {
  for (const text of ["行业动态：VBA", "学历要求：专科，优秀的可放宽"] ) {
    const value = text.includes("VBA") ? "VBA" : "专科";
    const data = createJobData({ ...extraction, requiredSkills: [sourced(value)], preferredSkills: [], unspecifiedSkills: [] }, rawText + "\n" + text);
    assert.equal(data.unspecifiedSkills[0].value, value);
  }
});

test("schema and evidence failures are independently identifiable without data values", () => {
  const cases = [
    [{ ...extraction, salary: 123 }, "schema", "salary"],
    [{ ...extraction, responsibilities: [sourced("不存在的示例职责")] }, "sourceText", "responsibilities[0].sourceText"],
  ] as const;
  for (const [input, stage, field] of cases) assert.throws(() => createJobData(input, rawText), (error: unknown) => error instanceof JobValidationError && error.stage === stage && error.field === field && !error.message.includes("不存在的示例技能"));
});

test("common punctuation differences ground safely while fabricated evidence is rejected", () => {
  const punctuation = "岗位职责:制作业务报告";
  assert.equal(createJobData({ ...extraction, responsibilities: [{ value: "业务报告", sourceText: punctuation }] }, rawText).responsibilities[0].sourceText, punctuation);
  for (const sourceText of ["专业要求：金融学", "制作经营分析报告"]) {
    assert.throws(() => createJobData({ ...extraction, responsibilities: [{ value: sourceText, sourceText }] }, rawText), (error: unknown) => error instanceof JobValidationError && error.stage === "sourceText");
  }
});

test("A: financial roles must possess a certificate is an explicit required basis", () => {
  const source = "财务类岗位须具备会计从业资格证书";
  for (const sourceText of [source, source + "；"]) {
    const data = createJobData({ ...extraction, otherRequirements: [{ value: source, sourceText, priority: "required" }] }, rawText + "\n其他要求：\n" + sourceText);
    assert.equal(data.otherRequirements[0].priority, "required");
    assert.equal(data.otherRequirements[0].sourceText, sourceText);
  }
});

test("B: certificate holders preferred remains preferred and cannot become required", () => {
  const source = "具有会计从业资格证书者优先";
  const input = { ...extraction, certifications: [{ ...sourced(source), priority: "preferred" }] };
  const text = rawText + "\n" + source;
  assert.equal(createJobData(input, text).certifications[0].priority, "preferred");
  assert.equal(createJobData({ ...input, certifications: [{ ...sourced(source), priority: "required" }] }, text).certifications[0].priority, "preferred");
});

test("C: education relaxation exceptions cannot become unconditional required", () => {
  for (const source of ["优秀者可适当放宽学历要求", "特别优秀的可放宽学历要求"]) {
    const text = rawText + "\n" + source;
    assert.equal(createJobData({ ...extraction, otherRequirements: [{ ...sourced(source), priority: "unspecified" }] }, text).otherRequirements[0].priority, "unspecified");
    assert.equal(createJobData({ ...extraction, otherRequirements: [{ ...sourced(source), priority: "required" }] }, text).otherRequirements[0].priority, "unspecified");
  }
});

test("explicit qualification verbs determine required even under a neutral heading", () => {
  for (const source of ["具有良好的沟通能力", "具备良好的沟通能力", "熟悉示例行业动态"]) {
    const text = rawText + "\n其他要求：\n" + source;
    assert.equal(createJobData({ ...extraction, otherRequirements: [{ ...sourced(source), priority: "unspecified" }] }, text).otherRequirements[0].priority, "required");
    assert.equal(createJobData({ ...extraction, otherRequirements: [{ ...sourced(source), priority: "required" }] }, text).otherRequirements[0].priority, "required");
  }
});

test("F: explicit required wording cannot rescue fabricated source evidence", () => {
  const source = "财务类岗位须具备原文没有的示例证书";
  assert.throws(() => createJobData({ ...extraction, otherRequirements: [{ ...sourced(source), priority: "required" }] }, rawText), (e: unknown) => e instanceof JobValidationError && e.stage === "sourceText" && e.rule === "source_not_found");
});

test("Chinese obligation variants and qualification headings are recognized deterministically", () => {
  for (const source of ["必须具备示例证书", "需具备示例证书", "需要示例证书", "应具备示例证书", "应当持有示例证书", "需持有示例证书", "财务类岗位应持有示例证书", "要求具备示例证书"]) {
    assert.equal(createJobData({ ...extraction, otherRequirements: [{ ...sourced(source), priority: "required" }] }, rawText + "\n" + source).otherRequirements[0].priority, "required");
  }
  for (const heading of ["任职要求", "学历要求", "专业要求", "资格证书要求"]) {
    const source = "具备示例资格";
    assert.equal(createJobData({ ...extraction, otherRequirements: [{ ...sourced(source), priority: "required" }] }, rawText + `\n${heading}：\n${source}`).otherRequirements[0].priority, "required");
  }
  const preferred = "有示例经验者更佳";
  assert.equal(createJobData({ ...extraction, otherRequirements: [{ ...sourced(preferred), priority: "preferred" }] }, rawText + "\n" + preferred).otherRequirements[0].priority, "preferred");
});

test("skill levels A-C are derived from evidence instead of the AI-selected array", () => {
  const cases = [
    ["必须熟练使用 Excel", "requiredSkills"],
    ["熟练使用 Excel", "requiredSkills"],
    ["Excel 熟练者优先", "preferredSkills"],
  ] as const;
  for (const [source, expected] of cases) {
    const data = createJobData({ ...extraction, requiredSkills: [sourced(source)], preferredSkills: [], unspecifiedSkills: [] }, rawText + "\n" + source);
    assert.equal(data[expected][0].value, source);
  }
});

test("D/G: plain skill tags survive as unspecified even when AI calls them required", () => {
  const sourceText = "标签：Golang、Java、C++、MySQL、Spring、Python";
  const skills = ["Golang", "Java", "C++", "MySQL", "Spring", "Python"].map((value) => ({ value, sourceText }));
  const data = createJobData({ ...extraction, requiredSkills: skills, preferredSkills: [], unspecifiedSkills: [] }, rawText + "\n" + sourceText);
  assert.equal(data.requiredSkills.length, 0);
  assert.deepEqual(data.unspecifiedSkills.map(({ value }) => value), ["Golang", "Java", "C++", "MySQL", "Spring", "Python"]);
});

test("E: an inline qualification heading deterministically marks its skills required", () => {
  const text = rawText + "\n任职要求：熟悉 Python；具备数据分析能力";
  const data = createJobData({ ...extraction, requiredSkills: [], preferredSkills: [], unspecifiedSkills: [sourced("熟悉 Python"), sourced("具备数据分析能力")] }, text);
  assert.deepEqual(data.requiredSkills.map(({ value }) => value), ["熟悉 Python", "具备数据分析能力"]);
  assert.equal(data.unspecifiedSkills.length, 0);
});

test("F: repeated normalization of identical input is deterministic and idempotent", () => {
  const sourceText = "标签：Java、Python";
  const input = { ...extraction, requiredSkills: [{ value: "Java", sourceText }], preferredSkills: [], unspecifiedSkills: [] };
  const text = rawText + "\n" + sourceText;
  const first = createJobData(input, text);
  for (let index = 0; index < 5; index++) assert.deepEqual(createJobData(input, text), first);
  assert.deepEqual(validateJobData(first), first);
});

test("H: a preferred item put in requiredSkills is corrected, not rejected", () => {
  const source = "有 Tableau 经验者优先";
  const data = createJobData({ ...extraction, requiredSkills: [sourced(source)], preferredSkills: [], unspecifiedSkills: [] }, rawText + "\n" + source);
  assert.equal(data.requiredSkills.length, 0);
  assert.equal(data.preferredSkills[0].value, source);
});

test("I/J: invalid auxiliary items are removed and never normalized into accepted facts", () => {
  const missing = createJobDataWithWarnings({ ...extraction, requiredSkills: [sourced("原文不存在的技能")], preferredSkills: [], unspecifiedSkills: [] }, rawText);
  const conflict = createJobDataWithWarnings({ ...extraction, requiredSkills: [{ value: "Java", sourceText: "有 Python 使用经验优先" }], preferredSkills: [], unspecifiedSkills: [] }, rawText);
  assert.equal(missing.data.requiredSkills.length, 0);
  assert.equal(conflict.data.preferredSkills.length, 0);
  assert.equal(missing.warnings[0].rule, "dropped_source_not_found");
  assert.equal(conflict.warnings[0].rule, "dropped_value_conflict");
});

test("client request posts a non-empty JD and accepts unspecified skills", async () => {
  const sourceText = "标签：Java";
  const input = rawText + "\n" + sourceText;
  const jobData = createJobData({ ...extraction, requiredSkills: [], preferredSkills: [], unspecifiedSkills: [{ value: "Java", sourceText }] }, input);
  let calls = 0;
  const request: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(url, "/api/ai/structure-job");
    assert.equal(options?.method, "POST");
    assert.deepEqual(JSON.parse(String(options?.body)), { rawText: input });
    return Response.json({ success: true, jobData });
  };
  const result = await requestStructuredJob(input, undefined, request);
  assert.equal(calls, 1);
  assert.equal(result.data.unspecifiedSkills[0].value, "Java");
});

test("client exposes API 400 and 500 messages", async () => {
  for (const status of [400, 500]) {
    const request: typeof fetch = async () => Response.json({ success: false, error: `示例错误 ${status}` }, { status });
    await assert.rejects(requestStructuredJob(rawText, undefined, request), (error: unknown) => error instanceof JobClientError && error.message === `示例错误 ${status}`);
  }
});

test("client exposes network and invalid JSON failures", async () => {
  const networkFailure: typeof fetch = async () => { throw new TypeError("fictional network failure"); };
  const invalidJSON: typeof fetch = async () => new Response("not-json", { status: 502 });
  await assert.rejects(requestStructuredJob(rawText, undefined, networkFailure), /无法连接 JD 结构化服务/);
  await assert.rejects(requestStructuredJob(rawText, undefined, invalidJSON), /无法读取的结果/);
});

test("client rejects malformed success data instead of silently succeeding", async () => {
  const request: typeof fetch = async () => Response.json({ success: true, jobData: { rawText } });
  await assert.rejects(requestStructuredJob(rawText, undefined, request), JobValidationError);
});

test("empty and oversized JD input errors are explicit", () => {
  assert.equal(getJobInputError(""), "请先输入岗位 JD。");
  assert.equal(getJobInputError("  "), "请先输入岗位 JD。");
  assert.equal(getJobInputError("x".repeat(20_001)), "岗位 JD 最多 20000 个字符。");
  assert.equal(getJobInputError("示例 JD"), null);
});

test("ten reasonable AI wordings from one grounded sentence all pass the full chain", async () => {
  const sourceText = "具备扎实的软件测试理论基础，熟悉常见测试工具和流程";
  const text = `任职要求：\n${sourceText}`;
  const values = ["软件测试", "软件测试理论", "测试工具和流程", "软件测试工具", "测试理论基础", "常见测试工具", "测试流程", "软件测试理论基础", "测试工具", "测试"];
  for (const value of values) {
    const mock = mockClient(JSON.stringify({ responsibilities: [{ value, sourceText }] }), "completed", text);
    const result = await structureJob(mock.client, "deepseek-flash", "deepseek", text);
    assert.equal(result.data.responsibilities[0].value, value);
    assert.equal(result.data.responsibilities[0].sourceText, sourceText);
    assert.equal(mock.calls(), 1);
  }
});

test("semantic extraction accepts concise Chinese concepts backed by full sentences", () => {
  const cases = [
    ["能够独立完成功能测试任务", ["功能测试"]],
    ["有较强的逻辑分析和问题定位能力", ["逻辑分析", "问题定位"]],
    ["具备良好的沟通能力和团队协作意识", ["沟通能力", "团队协作"]],
  ] as const;
  for (const [sourceText, values] of cases) {
    const data = createJobData({ responsibilities: values.map((value) => ({ value, sourceText })) }, sourceText);
    assert.deepEqual(data.responsibilities.map(({ value }) => value), values);
  }
});

test("source grounding normalizes CRLF, spaces, Unicode width and common punctuation only", () => {
  const original = "## 任职要求：\r\n熟悉　Python，掌握 SQL；能够编写测试。";
  const sourceText = "## 任职要求:\n熟悉 Python,掌握 SQL;能够编写测试.";
  const data = createJobData({ responsibilities: [{ value: "编写测试", sourceText }] }, original);
  assert.equal(data.rawText, original);
  assert.equal(data.responsibilities[0].sourceText, sourceText);
});

test("plain text, Markdown, mixed sections and missing fields use safe defaults", () => {
  for (const text of [
    "熟悉 Python，负责接口测试",
    "## 岗位要求\n- 熟悉 Python\n- 负责接口测试",
    "职责及要求：负责接口测试并熟悉 Python",
    "岗位要求：熟悉 Python",
    "标签：Python\n简短描述：测试岗位",
  ]) {
    const sourceText = text.includes("熟悉 Python") ? "熟悉 Python" : "Python";
    const data = createJobData({ unspecifiedSkills: [{ value: "Python", sourceText }] }, text);
    assert.ok(data.requiredSkills.length + data.unspecifiedSkills.length === 1);
    assert.equal(data.companyName, null);
    assert.deepEqual(data.certifications, []);
  }
});

test("one invalid keyword degrades, but predominantly fabricated auxiliary evidence fails", () => {
  const partial = createJobDataWithWarnings({ responsibilities: [sourced("制作业务报告")], keywords: [sourced("不存在的关键词")] }, rawText);
  assert.equal(partial.data.responsibilities.length, 1);
  assert.equal(partial.data.keywords.length, 0);
  assert.equal(partial.warnings.length, 1);
  const fabricated = ["虚构甲", "虚构乙", "虚构丙", "虚构丁"].map(sourced);
  assert.throws(() => createJobData({ jobTitle: sourced("示例数据分析员"), keywords: fabricated }, rawText), (error: unknown) => error instanceof JobValidationError && error.rule === "too_many_invalid_evidence");
});

test("missing core evidence and a completely ungrounded result still fail", () => {
  assert.throws(() => createJobData({ responsibilities: [sourced("原文没有的核心职责")] }, rawText), (error: unknown) => error instanceof JobValidationError && error.rule === "source_not_found");
  assert.throws(() => createJobData({}, rawText), (error: unknown) => error instanceof JobValidationError && error.rule === "no_grounded_content");
});

test("client preserves safe degradation warnings from the API", async () => {
  const jobData = createJobData({ responsibilities: [sourced("制作业务报告")] }, rawText);
  const request: typeof fetch = async () => Response.json({ success: true, jobData, warnings: [{ field: "keywords[0]", rule: "dropped_source_not_found" }] });
  const result = await requestStructuredJob(rawText, undefined, request);
  assert.deepEqual(result.warnings, [{ field: "keywords[0]", rule: "dropped_source_not_found" }]);
});
