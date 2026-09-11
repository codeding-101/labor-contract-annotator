const DROP_ELEMENTS = /<(script|style|noscript|iframe)[^>]*>[\s\S]*?<\/\1>/gi
const BLOCK_BOUNDARY = /<\/(p|div|h[1-6]|li|tr|td|th|section|article|blockquote|dd|dt)>/gi
const LINE_BREAK = /<br\s*\/?>/gi
const SEPARATOR = '\u0000'

const ENTITIES: Readonly<Record<string, string>> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&ldquo;': '“',
  '&rdquo;': '”',
  '&lsquo;': '‘',
  '&rsquo;': '’',
  '&mdash;': '—',
  '&hellip;': '…',
}

export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&[a-z]+;/gi, (match) => ENTITIES[match.toLowerCase()] ?? match)
}

/**
 * 把 HTML 拆成按文档顺序排列的文本块，每块对应一个段落/标题/换行。
 *
 * 之所以不引入 HTML 解析库：官方页面的结构差异很大（有的是标准 p/h3，有的是 Word
 * 导出的行内样式），而法条抽取只依赖「按文档顺序的文本块」这一件事。块内空白折叠，
 * 块间关系保留，足够支撑条号连续性校验。
 */
export function htmlToBlocks(html: string): string[] {
  const marked = html
    .replace(DROP_ELEMENTS, '')
    .replace(LINE_BREAK, SEPARATOR)
    .replace(BLOCK_BOUNDARY, SEPARATOR)

  return decodeEntities(marked.replace(/<[^>]*>/g, ''))
    .split(SEPARATOR)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .filter((block) => block !== '')
}
