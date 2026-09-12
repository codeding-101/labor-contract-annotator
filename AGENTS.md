# 项目约定

> Grok 每次会话都会读这份文件。保持简短——内容越长，每轮请求的固定开销越大。
> 当前进度与下一步见 `README.md` 和 `docs/next-steps.md`。

## 这是什么

本地化、开源的劳动合同风险检查工具（求职作品集项目）。核心是**官方范本比对 + 规则引擎**，不是"调个大模型看合同"。设计文档见 `docs/product-design.md`。

## 命令

- 装依赖：`npm install`
- 全链路校验：`npm run check`（typecheck → test → 构建法条 → 数据校验）
- 构建法条：`npm run build:statutes`（从 `sources/` 快照生成 `data/statutes/*.json`）
- 构建范本：`npm run build:templates`（从 `sources/templates/` 快照生成 `data/templates/*.json`）
- 数据校验：`npm run validate:data`
- 单测：`npm test`（Node 内置 `node:test`）
- 评测比对引擎：`npm run eval:diff`（用已知答案的合同验四类分类，判错即退出码非 0）
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
- **`data/` 不入库**，是构建产物。克隆后跑 `npm run build:statutes` 与 `npm run build:templates` 复现。
- 主来源（`role: primary`）抽取必须干净（条号连续、无抽取问题）；交叉来源允许有问题，它存在的意义就是暴露主来源的问题。
- **范本里的待填写位是 `{{FILL}}` 标记**（由 `src/mark-blanks.ts` 从 `<u>` 包住的空白段识别出来）。比对范本与用户合同时，`{{FILL}}` 必须当作通配符，否则用户填好的内容会被误判成"条款被改写"。改动比对逻辑时不要把这个标记当普通文本。
- **切分 `{{FILL}}` 必须大小写不敏感**。`normalizeForCompare` 会转小写，`{{FILL}}` 变成 `{{fill}}`；用大写标记去 split 会切不开，整段标记被转义进正则，导致所有含填空位的条款都匹配不上。这个坑已经踩过一次，见 `src/diff-template.ts` 的注释与 `tests/diff-template.test.ts` 里对应的断言。
- 改比对引擎后必须跑 `npm run eval:diff`。它用范本自身派生"已知答案"的合同（删一条/加一条/改一条/留空），任何分类判错都说明对齐或分类逻辑被改坏了。
- **规则库在 `rules/`，是手工编写并提交进仓库的**（不是从快照构建的产物，不要给它写构建脚本）。三条硬约束：
  1. 每条规则的 `statuteRefs` 必须指向法条库里真实存在的条文 ID，`npm run validate:data` 会校验，引用不存在的条文直接失败。
  2. **规则里不复制法条原文**——报告要展示哪条就按 ID 从 `data/statutes` 取哪条，条文只有一份来源。
  3. 每条规则自带正反例（`cases`），`npm test` 逐条跑过；改规则必须同时改用例。
- `NUMERIC_COMPARE` 已在 schema 中定义但引擎未实现，遇到时会记进 `unsupported`。实现它需要先有事实抽取层（从合同抽出合同期限、试用期长度、工资额等），不要用关键词硬凑数值判定。
- 抽取器宁可少收不可错收：条号不连续即停止并报错。不要为了让数据"看起来完整"而放宽断言。

## 环境事实（本机已确认，不必再探测）

- 平台 Windows，shell 是 PowerShell。串联命令用 `;`，**不支持 `&&`**。
- 这个 shell 里**没有** `grep`、`head`、`tail`、`sed`、`awk`、`find`，用专用工具替代。
- **`Get-Content` 默认按 ANSI 解码**，读 UTF-8 中文 JSON 必须加 `-Encoding UTF8`，否则解析失败或乱码。
- **带中文的 `.ps1` 必须存成 UTF-8 with BOM**，否则 PS 5.1 按 ANSI 解析，会把后面的 `$` 和反引号一起吃掉。
- 中文输出经命令管道时会间歇性乱码。要看真实内容用文件读取工具，不要依赖终端回显。
- 本机 `core.autocrlf=true`。**凡是内容哈希参与校验的文件，必须在 `.gitattributes` 里标 `-text`**，否则克隆后换行符变化会让哈希失效。`sources/**` 已这样处理，不要删。
- Node v24.19.0（原生跑 TS）、TypeScript v7、npm 11。
- 官方劳动合同范本普遍是 **Word 97-2003 二进制 `.doc`**（不是 `.docx`、也不在网页正文里）。读取用 `word-extractor`（纯 JS，不依赖本机装 Word 或 LibreOffice），封装在 `src/read-doc.ts`。但它对段落边界的还原不可靠，接入 `.doc` 来源前要先验证段落边界。`.docx` 需要另加读取器（mammoth），尚未接。
- **`web_search` 在本机不可用，不要依赖它，也不要去"修"它。** 已查明的完整情况：

  - 本机代理是**通的**：Clash 系客户端（进程名 `nano`，PID 会变）监听 `127.0.0.1:65532`，Windows 系统代理已指向它（`ProxyEnable=1`）。经该代理访问 google 返回 200、访问 `cli-chat-proxy.grok.com` 有服务器响应，说明隧道正常。
  - **但 CLI 自身的请求不走系统代理**：交互式会话的 `billing` 请求持续报 `error sending request for url (https://cli-chat-proxy.grok.com/...)`。系统代理只对认它的程序生效。给进程显式设 `HTTP_PROXY`/`HTTPS_PROXY=http://127.0.0.1:65532` 后，该报错消失——所以环境变量这条路是有效的。彻底的办法是在 Clash 里开 **TUN 模式**（透明接管所有进程），那样 `billing` 与 `[ui] fork_secondary_model` 也会一并恢复。
  - **即使传输通了，web_search 的返回也不可信**：实测（`grok -p ... --tools web_search`）两次调用都 `success: true`、都无传输错误，但返回的是**模型自述的自然语言，没有任何来源网址**，且两次结果互相矛盾（一次编出具体气温风力，一次说无法提供该日期预报）。这是"看起来成功、实为无依据"的假成功。
  - **不要把 `[models] web_search` 改成 `deepseek-flash`**：那只会让它走同一个无来源的兜底路径。

  **能用的是 `web_fetch`**（客户端自己抓目标网址，用 `cn.bing.com`，`www.bing.com` 会跨域重定向）。抓官方页面用 `Invoke-WebRequest -OutFile` 直接落字节最可靠。需要"搜索"时，请人用浏览器找 URL 再交给 `web_fetch`，比让工具编要可靠。
- 代理端口 `65532` 绑定在 `0.0.0.0`（监听全部网卡）。若非有意让局域网共享，建议关掉客户端的 allow-lan，否则同网段的人可以借道你的代理。
- `flk.npc.gov.cn`（国家法律法规数据库）是 SPA，`/api/detail` 取不到数据。法条来源目前靠政府网站静态页。
- 浏览器验证：playwright MCP 已配好。**改界面必须真的在浏览器里走一遍**，不要只看构建是否通过。

## 不要做的事

- 不要提交 `node_modules/`、`data/`、`tmp/`。
- 不要用 `any`、`@ts-ignore` 掩盖类型错误——先说明问题，让人决定。
- 不要为了让构建通过而放宽断言或删掉检查。
- 不要手工敲入法条或范本数据——先落快照再抽取，保证可复现。
