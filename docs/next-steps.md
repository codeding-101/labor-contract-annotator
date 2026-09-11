# 交接与下一步

> 这份文件记录"当前做到哪、下一步做什么、为什么这么做"，以及已经踩过的环境坑。
> 新会话接手时先读 `README.md` 和本文件，就够继续了。

---

## 当前状态

法条数据层已完成并验证。产物：`data/statutes/labor-contract-law.json`（《劳动合同法》第 1–98 条）。**该目录不入库**，由 `sources/` 下的冻结快照重新构建。

已验证的事实（不是推断）：

- 新克隆后 `npm install && npm run check` 全绿；重建出的 98 条条文内容摘要与本地构建结果完全一致。
- 两个来源快照的 SHA256 跨机器、跨克隆一致——`.gitattributes` 里 `sources/** -text` 是必须的，否则 `core.autocrlf=true` 会把 LF 转成 CRLF，让哈希全部失效。
- 交叉校验：两个独立官方来源在 97/98 条上文字一致；唯一差异是第 63 条（博湖县页面多一个前引号，属源页面真实缺陷，**故意不修**）。

未开始：范本库、比对引擎、规则引擎、应用界面。

---

## 下一步：先做范本库，再做比对引擎

**顺序很重要，不要反过来。** 比对引擎的核心是"差异分类"（范本有合同没有 / 范本没有合同多了 / 关键条款被改写 / 填空留白）。这四类的判定逻辑必须照着**真实范本的结构**来设计——凭空设计算法、回头再拿范本套，几乎一定返工。

所以下一步的具体动作是：

1. **收集 3 个省市的官方劳动合同示范文本**（建议北京、上海、广东）。多数人社厅网站直接提供 Word/PDF 下载。
2. **沿用现有管线**：页面/文件冻结进 `sources/templates/<region>/`，在 `sources/sources.json`（或新建 `sources/templates.json`）里声明来源、发布机关、发布日期、生效区间、行政区划代码。
3. **写范本抽取器**，产出符合 `ContractTemplateSchema` 的 `data/templates/*.json`。范本是**表单式**结构（甲方乙方、期限、报酬、工时、社保……），和法条的"第X条"结构不同，抽取逻辑要单写，不要硬套 `extract-statute.ts`。
4. 先做 1 个省跑通全链路，再复制到另外 2 个。**不要一上来做 30 个省**——作品集看的是机制深度，不是覆盖广度。

范本库的 schema 已经写在 `src/schema.ts` 里（`ContractTemplateSchema` / `TemplateClauseSchema`），可以先照着实现，实现中发现设计不对就改 schema，不要迁就。

---

## 已确认的环境事实（别重新踩）

| 事项 | 结论 |
|---|---|
| Node 版本 | v24.19.0，**原生支持 TypeScript 类型擦除**，所以 `node src/x.ts` 直接能跑，测试用内置 `node:test`，零测试框架依赖。代价：必须写"可擦除语法"（不能用 enum、namespace、参数属性） |
| 依赖 | 只有 `zod`（运行时）+ `typescript`、`@types/node`（开发） |
| TypeScript | v7，`tsc --noEmit` 正常 |
| **换行符陷阱** | 本机 `core.autocrlf=true`。凡是内容哈希要参与校验的文件，必须在 `.gitattributes` 里标 `-text` |
| PowerShell 读 UTF-8 | `Get-Content` 默认按 ANSI 解码，读中文 JSON 会失败或乱码。**必须加 `-Encoding UTF8`** |
| PowerShell 写 .ps1 | 带中文的脚本必须存成 **UTF-8 with BOM**，否则 PS 5.1 按 ANSI 解析，会把后面的 `$` 和反引号一起吃掉 |
| 中文经命令管道 | 输出经管道时会间歇性乱码（如上）。要看真实内容用文件读取工具，别依赖终端回显 |
| shell | PowerShell，**不支持 `&&`**，串联用 `;` |
| 联网 | `web_search` 工具当前报错不可用；`web_fetch` 可用（Bing 需用 `cn.bing.com`）。抓官方页面用 `Invoke-WebRequest -OutFile` 直接落字节更可靠 |
| 国家法律法规数据库 | `flk.npc.gov.cn` 是 SPA，`/api/detail` 的 GET 返回页面壳、POST 返回 405，暂时取不到结构化数据。立法条数据目前靠政府网站的静态页面 |

---

## 有用的命令

```bash
npm run check                                        # typecheck → test → 构建 → 数据校验
npm run build:statutes                               # 快照 → data/statutes/*.json
npm run validate:data                                # 校验产物 + 重算快照哈希
npm run diff:sources -- labor-contract-law           # 列出各来源不一致的条文
npm run diff:sources -- labor-contract-law 63        # 看第 63 条的逐来源文本对照
```

---

## 未决问题（暂时不影响推进）

1. **第 63 条的差异要不要找第三个来源裁定**。目前按"保留差异、如实报告"处理。若将来要对外宣称准确率，需要一个权威来源或人工裁定。
2. **条文坐标**。当前只抽文本，没有页码/位置信息。将来做报告页的原文高亮，PDF 路径需要补这层。
3. **地方性规则**（最低工资标准、加班费基数口径）。表结构已在设计文档里，尚未建数据。
4. **图片扫描件的本地 OCR**。这是本地化架构的固有短板，计划放在靠后阶段，且必须配人工核对界面。
5. **应用层形态**：纯前端网页 → 单文件下载（已定），桌面壳未定。

---

## 一处需要留意的设计约定

法条库里**只放能追溯到官方原文的内容**，规则库里的每条规则都必须绑定真实存在的法条 ID（`statuteRefs`）。追溯不到的规则不写。这不是洁癖——作者不是法学专业，这条约束是把"个人法律判断"从系统里彻底移除的唯一办法。改这块代码时请保持这个约束。
