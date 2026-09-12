import { decodeEntities } from './html.ts'

/**
 * 范本里"待填写位"的占位标记。
 *
 * Word 导出的劳动合同范本用「下划线包住一串不换行空格」表示要填写的位置，例如
 * `<u><span>&nbsp;&nbsp;&nbsp;</span></u>`。这是结构性信号，比数空格可靠：
 * 实测某省范本 145 个下划线段落里 144 个内部只有空白，唯一含文字的那个被
 * "内部为空"这个条件自然排除。
 *
 * 这个标记同时是对接比对引擎的接口：范本条款里的 FILL 在比对时应被视为通配符，
 * 否则用户填好内容的合同会被误判成"条款被改写"。
 */
export const FILL = '{{FILL}}'

const UNDERLINE_RE = /<u[^>]*>(.*?)<\/u>/gis

function isBlankInner(inner: string): boolean {
  return decodeEntities(inner.replace(/<[^>]*>/g, '')).replace(/\s+/g, '') === ''
}

const FILL_RUN_RE = new RegExp(`(?:${FILL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*){2,}`, 'g')

/**
 * 把下划线包住的空白段替换成 FILL 标记；下划线里含真实文字的，去掉下划线保留文字。
 *
 * 相邻的多个标记会合并成一个：Word 常把一条下划线拆成多个 run，
 * 加载后就是 `{{FILL}}{{FILL}}{{FILL}}年` 这种形态——它们本来就是同一个填写位。
 * 不合并的话，填充后会得到「示例示例2026年」，日期等模式就匹配不上了。
 */
export function markBlanks(html: string): string {
  const marked = html.replace(UNDERLINE_RE, (_whole: string, inner: string) => (isBlankInner(inner) ? FILL : inner))
  return marked.replace(FILL_RUN_RE, FILL)
}
