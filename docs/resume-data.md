# ResumeData 模型约定

ResumeData 是确认后的简历数据；ResumeExtraction 是未来 AI 提取 JSON 的形状，两者尚未接入解析接口或页面。

ResumeData 是语义数据，不是原始文档的替代品；rawText 也不是可恢复模板的文档副本。保留原模板导出的架构约定见下文。

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

## 原始文档与保留模板导出的架构预留

以下是未来实现约定，本阶段不新增格式解析、文件存储、编辑器或导出功能。

### 两个独立对象

- OriginalDocument：用户上传的原始文件字节及文件元信息。未来由程序附加文档版本标识、格式结构和文字定位信息；原文件保持不可变，修改从副本开始。
- ResumeData：供 AI 和用户理解的简历语义结构，保留原始解析快照 rawText 和 sourceText，不承担字体、图片、表格、页边距等格式保存职责。

当前上传组件在浏览器内存中保留 File，解析接口只在本次请求中读取文件并返回文字。没有 OriginalDocument 的持久化实现。未来同一次会话导出应保留最初 File，不能用 rawText 重建原文件；移除文件或重新上传时，需要使旧 ResumeData 和定位关系失效。跨刷新恢复若成为需求，再单独设计经用户授权的存储及清理策略。

### 来源证据与文档定位不同

sourceText 必须保留解析文本中的逐字片段，不由 AI 改写、清洗或替换；rawText 是不可变的解析快照。value 可供后续表达优化使用，但不能取代证据。

当前解析工具会合并文字、生成换行并去除首尾空白；这些输出不等于 DOCX XML 原文，也不含 PDF 的排版坐标。此过程不会破坏仍被保留的原始文件，因此本阶段不改解析逻辑。不能把 rawText 的字符偏移直接当成原文档位置。

未来格式读取程序需要建立独立的定位关系：原文档版本、语义字段/条目 ID、解析文字范围，以及 DOCX 中对应的 XML 部件、段落、表格单元格和文字 run 范围。该关系由程序生成和验证，不交给 AI 猜测，也不塞进 AI 提取 schema。仅 sourceText 相同或条目 ID 相同不能证明定位正确，重复文字需要上下文和唯一位置确认。

### 未来 DOCX 流程

1. 保留原始 DOCX；程序读取其文字与格式结构，同时获得 rawText，并建立来源定位关系。
2. rawText 转为 ResumeData；AI 提供独立的修改建议，附带目标字段、原文和建议文本，不改变 sourceText 或原始文件。
3. 用户逐项确认；仅接受的建议形成文字替换列表，拒绝的建议不应用。
4. 程序核对文件版本、目标位置和原文仍一致；遇到重复或无法唯一定位的内容停止该项自动替换，交由用户处理，不能全局搜索替换。
5. 在原 DOCX 副本中修改被确认的文字，尽量保留现有段落、表格、run 样式、图片和其他文档部件，然后导出并验证效果。

DOCX 的一句话可能横跨多个具有不同样式的 run，未来需要明确替换文字的样式归属并验证生成文档。文字长度变化也可能改变换行和页数，因此“保留模板”不等于保证像素级排版不变。PDF 的位置和字体处理需要独立方案，不能承诺与 DOCX 使用同样的定点替换方法。

本次仅明确对象边界和定位约束，不添加大型文档依赖，不实现 DOCX/PDF 修改或导出，也不新增用户页面。
