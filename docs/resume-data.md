# ResumeData 模型约定

ResumeData 是确认后的简历数据；ResumeExtraction 是未来 AI 提取 JSON 的形状，两者尚未接入解析接口或页面。

## 字段

- personalInfo：姓名、电话、邮箱、地区、网站、LinkedIn、GitHub 和其他联系方式。
- summary：原简历已有的个人简介，没有就为 null，不能自动创建。
- education：学校、学历、专业、开始/结束日期、描述。
- experience：公司、岗位、日期、地区、描述。
- projects：项目名、角色、日期、描述、技术列表。
- skills：独立技能条目，含名称、可选分组和有证据的描述；不推断熟练度。
- certificates：证书名称、颁发方、日期、描述。
- other：不能归类的原文内容，避免丢失信息。
- rawText：由程序附加的原始解析文本，不由 AI 回填，不替代结构化字段。

所有已知事实使用 SourcedText：`{ value: string, sourceText: string }`。缺失单值为 null，缺失列表为 []；不要创建全为空的占位经历。描述用数组保留多条内容。技能 category 和 other.title 是展示分组/标题，不代表原文事实，不应当作匹配证据。

日期也是 SourcedText，value 保留如“2023.09”“2024年3月”“至今”。不强制 ISO 日期，不补全缺失月份或日期。

## 验证与 ID

1. 用 resumeExtractionSchema.safeParse 验证未知 JSON，检查类型、必需键和未知字段。规则中所有键都存在，未知单值显式为 null，方便结构化输出。
2. 提取结果确认后，用 createResumeData(extracted, originalRawText) 附加原文并生成程序 UUID。AI 提取 schema 不允许 rawText 或 id。
3. validateResumeData 验证完整数据、ID 唯一性，并检查每个 sourceText 是 rawText 的非空逐字片段。
4. 生成一次后，编辑、排序和再次验证都保留 ID；再次调用 createResumeData 是新快照，会生成新 ID。本阶段没有跨次提取的条目合并逻辑，也没有永久存储。

来源验证只是检查证据存在，不能证明 value 与证据语义一致。例如 AI 可能引用一段真实原文却曲解学历或技能。后续仍须进行事实核对、用户确认，并且禁止将 JD 中无证据的能力写入简历。sourceText 和 rawText 不随表达优化一起改写。

Zod schema 是唯一的结构定义，TypeScript 类型由它推导。resumeExtractionSchema 可用 Zod 的 toJSONSchema 导出；具体 AI 服务的 schema 限制在接入阶段再验证。本阶段不调用 AI。

## 最小开发测试

在项目根目录运行，生成物存放在 Git 忽略的 .next 中：

```bash
node node_modules/typescript/bin/tsc tests/resume.test.ts --outDir .next/resume-model-tests --module commonjs --moduleResolution node --target ES2022 --esModuleInterop --strict --skipLibCheck --types node
node --test .next/resume-model-tests/tests/resume.test.js
```

测试仅使用完全虚构的信息。任何真实简历、rawText、验证失败数据都不得写入代码、测试或日志。
