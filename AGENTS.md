# 项目约定

> Grok 每次会话都会读这份文件。保持简短——内容越长，每轮请求的固定开销越大。
> 当前进度与下一步见 `README.md` 和 `docs/next-steps.md`。

## 这是什么

本地化、开源的劳动合同风险检查工具（求职作品集项目）。核心是**官方范本比对 + 规则引擎**，不是"调个大模型看合同"。设计文档见 `docs/product-design.md`。

## 命令

- 装依赖：`npm install`
- 全链路校验：`npm run check`（typecheck → test → 构建法条 → 数据校验）
- 构建法条：`npm run build:statutes`（从 `sources/` 快照生成 `data/statutes/*.json`）
- 数据校验：`npm run validate:data`
- 单测：`npm test`（Node 内置 `node:test`）
- 对照各来源条文差异：`npm run diff:sources -- labor-contract-law [条文号]`

**没有** ESLint / Prettier，**没有** vitest / jest。不要引入。依赖只有 `zod` 与 `typescript`。

## 代码约定

- 2 空格缩进、行尾不加分号、字符串用单引号。
- **必须写"可擦除语法"**：Node 24 直接跑 `.ts` 靠类型擦除，所以不能用 `enum`、`namespace`、构造函数参数属性。
- ESM 导入必须带扩展名：`import { x } from './y.ts'`。
- `tsconfig` 开了 `strict` + `noUncheckedIndexedAccess`，索引访问要处理 `undefined`。

## 架构约束（改代码时必须保持）

- **法条内容只从官方原文来。** 作者不是法学专业，系统里不允许出现依赖个人法律判断的内容：规则库里每条规则必须绑定真实存在的法条 ID（`statuteRefs`），追溯不到的规则不写。
- **`sources/` 下是官方页面的冻结快照，不要手改内容。** 要更新就重新抓取并同步哈希与声明。产物的哈希与快照绑定，改了快照不重新构建，`validate:data` 会失败——这是设计如此。
- **`data/` 不入库**，是构建产物。克隆后跑 `npm run build:statutes` 复现。
- 主来源（`role: primary`）抽取必须干净（条号连续、无抽取问题）；交叉来源允许有问题，它存在的意义就是暴露主来源的问题。
- 抽取器宁可少收不可错收：条号不连续即停止并报错。不要为了让数据"看起来完整"而放宽断言。

## 环境事实（本机已确认，不必再探测）

- 平台 Windows，shell 是 PowerShell。串联命令用 `;`，**不支持 `&&`**。
- 这个 shell 里**没有** `grep`、`head`、`tail`、`sed`、`awk`、`find`，用专用工具替代。
- **`Get-Content` 默认按 ANSI 解码**，读 UTF-8 中文 JSON 必须加 `-Encoding UTF8`，否则解析失败或乱码。
- **带中文的 `.ps1` 必须存成 UTF-8 with BOM**，否则 PS 5.1 按 ANSI 解析，会把后面的 `$` 和反引号一起吃掉。
- 中文输出经命令管道时会间歇性乱码。要看真实内容用文件读取工具，不要依赖终端回显。
- 本机 `core.autocrlf=true`。**凡是内容哈希参与校验的文件，必须在 `.gitattributes` 里标 `-text`**，否则克隆后换行符变化会让哈希失效。`sources/**` 已这样处理，不要删。
- Node v24.19.0（原生跑 TS）、TypeScript v7、npm 11。
- `web_search` 工具当前报错不可用；`web_fetch` 可用（用 `cn.bing.com`，`www.bing.com` 会跨域重定向）。抓官方页面用 `Invoke-WebRequest -OutFile` 直接落字节最可靠。
- `flk.npc.gov.cn`（国家法律法规数据库）是 SPA，`/api/detail` 取不到数据。法条来源目前靠政府网站静态页。
- 浏览器验证：playwright MCP 已配好。**改界面必须真的在浏览器里走一遍**，不要只看构建是否通过。

## 不要做的事

- 不要提交 `node_modules/`、`data/`、`tmp/`。
- 不要用 `any`、`@ts-ignore` 掩盖类型错误——先说明问题，让人决定。
- 不要为了让构建通过而放宽断言或删掉检查。
- 不要手工敲入法条或范本数据——先落快照再抽取，保证可复现。
