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
- **案例语料**（`sources/cases.json` + `src/extract-cases.ts`）为规则提供**带裁判结果的真实措辞**。企业劳动合同不公开，这类公开案例是最接近真实的验证材料——遇到就收，别只收法条与范本。
  - 规则用例可以标 `source: "<文档ID>-C<序号>"`，`validate:data` 会校验该案例真实存在；真实措辞必须能追到出处。
  - 新收案例后，先拿它去撞现有规则：**真实措辞最常见的价值是暴露漏报**。已经抓到三类：① 社保的「不为…缴纳」写法（关键词写死了）② 社保义务「转嫁给个人承担」（同一规则另一种失败形态）③ **整个风险类型缺失**（工资异议期约定，规则库里根本没有这一类，由北京案例三的裁判结果补上）。发现漏报就补通用的那一层，不要为单个措辞加特例；缺的是整类风险就新增规则，但必须有可引用的法条依据。
  - 案例文档的排版各家不同（标题形态、目录形态、小标题名称与是否带【】），`extract-cases.ts` 已支持三种真实形态；遇到第四种时先看 `npm run build:cases` 报的抽取问题，再按形态扩展，不要放宽成模糊匹配。
- **报告层只做标注，不做评价**（`src/build-report.ts`）。三条不可放松的约束：
  1. **不加综合评分、不加签署建议。** 早期版本有过评分（红15/黄5/蓝1＋高危封顶40），已按产品定位删除——宣称"不构成法律意见"的工具不该在最显眼处给出综合打分。`tests/build-report.test.ts` 里断言报告不含 `score` 与 `recommendation` 字段，**不要把它们加回来**。
  2. **无法判定的项单独成块、且不计入标注数**——没抽到信息既不算"有问题"也不算"没问题"，但必须让用户看到。
  3. **关键信息的措辞要区分「有值」与「只是提到了」**。没有事实键的项只能判断合同是否提及，措辞必须写明"未核对具体内容"，否则等于在暗示已经查过了。
- **隐私是硬约束，不是宣传语。** 三条不要破坏：
  1. **不许加任何 `fetch` / `XMLHttpRequest` / `sendBeacon` / `WebSocket`，也不许引外部字体或 CDN。** 文件一律走 File API 在内存里处理。
  2. 生产构建注入的内容安全策略（`web/vite.config.ts` 里的 `privacyPolicy`）**不能删**：`connect-src 'none'` 让浏览器禁止一切出网请求，这是"不上传"从"我们没写"升级为"浏览器拦住"的关键。只在构建时注入，别改成开发模式也注入（会拦掉 Vite 热更新）。
  3. 改完要在浏览器里复核：跑一遍流程后调 `browser_network_requests`（`static: true`），应当只有同源静态资源。当前基线是 6 个请求，全部同源。
- **收新法条来源后的标准动作**：① 看条数对不对（与该法实际条数、与交叉来源对比）② 看**最后一条正文是否干净**（页脚污染最常见的落点）③ 看前言里页面自述的版本与生效日期。已经踩过两个坑：空白类 HTML 实体未解码会让块首挂噪声、导致少收一条并伪造差异；页脚条目各自成块会让"两块页脚词"的判定失效。
- **网页端在 `web/`，是纯前端应用**（Vite + React + TS）。它是"文件不离开设备"能成立的实现层，两条约束：
  1. 它只能 import `src/` 下**不依赖 Node API** 的模块。`load-statutes.ts`、`build-*.ts`、`validate-data.ts`、`eval-diff.ts`、`diff-sources.ts`、`report-sample.ts` 都用了 `node:fs`，**浏览器里不能用**——网页端要自己的数据加载模块（`web/src/data.ts`），在构建期把 `data/` 与 `rules/` 打包进去。
  2. 因此 `web/` 构建前必须先在仓库根目录构建数据，否则找不到 JSON。
- **网页端的文件读取**：统一入口在 `web/src/document.ts`（按 MIME＋扩展名分发，各读取器按需加载）。PDF 走 `web/src/pdf.ts`（pdfjs），Word 走 `web/src/docx.ts`（mammoth 的 `extractRawText`，产出"一段一行"）；坐标重组行的逻辑在引擎的 `src/text-lines.ts`（纯函数、有单测）。**接新格式时的分工**：把"文件 → 文本行"放在 `web/`（那里才有库依赖），把"文本行 → 条款"留给引擎（`extract-contract.ts` 已足够宽容）。
  - 验证文件上传要用 Playwright 的 `browser_file_upload`（点「选择合同文件」会打开文件选择器，再传绝对路径）。测试用文件放在 `tmp/`（已 gitignore，不进仓库）；PDF 可从政府网站抓，`.docx` 范本可从省市人社厅网站的附件里找。
  - **扫描件与拍照图片读不出文字**，这条路径必须有明确报错，不能产出空报告——这是本地化架构的硬代价，不要用低准确率的 OCR 硬撑。
  - **遇到误报先找"有原则的判据"，不要无脑收紧 include。** 两个已验证的例子：条款主题是申诉渠道时（含投诉／申诉／举报）不该按"收费约定"报；出现「乙方员工」说明乙方是企业，那类违约金不是让劳动者承担。改完必须两头验：误报消失 **且** 真阳性仍在（跑一遍可疑示例）。
- **改界面必须在浏览器里真跑一遍**（Playwright MCP 已配好）。只截图不算验证：要走完整流程（填示例 → 分析 → 看报告），也要看空态与失败态，桌面与移动视口都要看，并确认控制台无错误。已经验证过的路径与结果记在 README 的「网页端」一节。
- **部署到 GitHub Pages**（`.github/workflows/deploy-web.yml`）。三条不要改坏：
  1. `web/vite.config.ts` 的 `base: './'` 是必须的——Pages 项目站点在 `/<仓库名>/` 下，绝对路径资源会 404。
  2. 工作流里**必须先跑仓库根目录的 `npm run check`**（数据是构建产物、不入库，网页端构建期要把它打包进去），再构建 `web/`。
  3. `web/public/.nojekyll` 让 Pages 跳过 Jekyll 处理，别删。
  改部署后本地验证的办法：`node tmp/serve-subpath.mjs web/dist 4180` 把产物挂在 `/labor-contract-guard/` 子路径下，再在浏览器里打开 `http://localhost:4180/labor-contract-guard/`——这模拟了 Pages 的布局，资源路径写错会立刻暴露。
- 主来源（`role: primary`）抽取必须干净（条号连续、无抽取问题）；交叉来源允许有问题，它存在的意义就是暴露主来源的问题。**交叉校验报出差异时，先判断是源页面缺陷还是自己抽取错**——用 `npm run diff:sources -- <lawId> [条文号]` 看两侧原文，不要直接当成"来源不一致"记下来。
- **范本里的待填写位是 `{{FILL}}` 标记**（由 `src/mark-blanks.ts` 从 `<u>` 包住的空白段识别出来）。比对范本与用户合同时，`{{FILL}}` 必须当作通配符，否则用户填好的内容会被误判成"条款被改写"。改动比对逻辑时不要把这个标记当普通文本。
- **切分 `{{FILL}}` 必须大小写不敏感**。`normalizeForCompare` 会转小写，`{{FILL}}` 变成 `{{fill}}`；用大写标记去 split 会切不开，整段标记被转义进正则，导致所有含填空位的条款都匹配不上。这个坑已经踩过一次，见 `src/diff-template.ts` 的注释与 `tests/diff-template.test.ts` 里对应的断言。
- 改比对引擎后必须跑 `npm run eval:diff`。它用范本自身派生"已知答案"的合同（删一条/加一条/改一条/留空），任何分类判错都说明对齐或分类逻辑被改坏了。
- **规则库在 `rules/`，是手工编写并提交进仓库的**（不是从快照构建的产物，不要给它写构建脚本）。三条硬约束：
  1. 每条规则的 `statuteRefs` 必须指向法条库里真实存在的条文 ID，`npm run validate:data` 会校验，引用不存在的条文直接失败。
  2. **规则里不复制法条原文**——报告要展示哪条就按 ID 从 `data/statutes` 取哪条，条文只有一份来源。
  3. 每条规则自带正反例（`cases`），`npm test` 逐条跑过；改规则必须同时改用例。
- `NUMERIC_COMPARE` / `RATIO_COMPARE` / `TIERED_COMPARE` 依赖 `src/extract-facts.ts` 抽出的事实。三条约束不要放松：
  1. **抽不到就是 `value: null`，不是 0，也不算合规。** 引擎据此产出 `undetermined`（无法判定），这是与"违规""合规"并列的第三种结果。不要为了让结果好看而给事实填默认值。
  2. **多选项条款先用 `pickOption` 消歧再抽**（范本大量用「下列第 N 种」）。不消歧会抓到没被选中的选项，得出错误事实。
  3. 事实键定义在 `src/schema.ts` 的 `FACT_KEYS`（rule 的 `field`/`ratioOf`/`dependsOn` 只能取这些值，写错键名 schema 会拦下）。新增事实要同时改 schema 与 `extract-facts.ts`。
- 改比对引擎或事实抽取后必须跑 `npm run eval:diff`：它除了验四类差异，还用**真实范本数据**（不是手写夹具）跑一遍事实抽取，任何一项抽出"未识别"都会失败。手写夹具会掩盖真实文本的形态问题——已经踩过一次（相邻填空位未合并）。
- `eval:diff` 里还有一道闸门：**把规则跑在官方范本派生的示例合同上，要求报出 0 条风险项**。范本本身是合规的，报出来就是关键词放宽过头导致的误报。**为了修漏报而放宽关键词后，务必看这道闸门有没有亮**——这是防"修一个漏报、制造十个误报"的唯一自动手段。
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
- **抓国内政务网站必须绕过系统代理。** Clash 是全局模式，会把国内站点也绕到境外节点出口，而政务网站对境外出口 IP 常常直接返回 **403**。实测同一个 URL：经代理 403、直连 200。所以用 `Invoke-WebRequest`（它默认走系统代理）会失败，要用 `HttpWebRequest` 并把 `Proxy` 设为 `$null`：

  ```powershell
  $req = [System.Net.HttpWebRequest]::Create($url)
  $req.Proxy = $null          # 关键：绕开系统代理
  $req.UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
  $resp = $req.GetResponse()
  ```
  抓快照要落原始字节（`$resp.GetResponseStream().CopyTo($fileStream)`），不要经 `Set-Content` 转一道，否则哈希对不上。
- `flk.npc.gov.cn`（国家法律法规数据库）是 SPA，`/api/detail` 取不到数据。法条来源目前靠政府网站静态页。
- 浏览器验证：playwright MCP 已配好。**改界面必须真的在浏览器里走一遍**，不要只看构建是否通过。

## 不要做的事

- 不要提交 `node_modules/`、`data/`、`tmp/`。
- 不要用 `any`、`@ts-ignore` 掩盖类型错误——先说明问题，让人决定。
- 不要为了让构建通过而放宽断言或删掉检查。
- 不要手工敲入法条或范本数据——先落快照再抽取，保证可复现。
