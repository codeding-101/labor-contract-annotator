import { cnToInt } from './cn-number.ts'

export type ExtractedArticle = {
  articleNo: number
  articleLabel: string
  chapter: string | null
  section: string | null
  text: string
}

export type ExtractionResult = {
  articles: ExtractedArticle[]
  /** 正文（第一条）之前的全部文本块，原样保留，用于溯源该页面自述的版本信息。 */
  preamble: string[]
  /** 截断前的实际前言段数，避免「被截断了但看不出来」。 */
  preambleBlockCount: number
  /** 判定正文结束的页脚块（若有）。正文之后的页脚不并入最后一条，另行记录。 */
  trailingBoundary: string | null
  issues: string[]
}

const CHAPTER_RE = /^第([一二三四五六七八九十百千零〇0-9]+)章[\s　]*(.*)$/
const SECTION_RE = /^第([一二三四五六七八九十百千零〇0-9]+)节[\s　]*(.*)$/
const ARTICLE_RE = /^第([一二三四五六七八九十百千零〇0-9]+)条[\s　]*(.*)$/

/**
 * 条文正文里不应出现以标题开头的行；出现即说明有标题漏处理、被当成了续段。
 * 覆盖 章/节/编/篇：解析器只实现章与节的识别，其余层级一旦出现必须报错，
 * 而不是被静默并进条文正文。
 */
const LEAKED_HEADING_RE = /^第[一二三四五六七八九十百千零〇0-9]+[章节编篇][\s　]*(.*)$/m

/** 正文短于此长度视为抽取异常，而不是合法条文。 */
const MIN_ARTICLE_LENGTH = 4

/** 前言块的记录上限。前言只用于溯源，超限只截断并记录实际段数。 */
export const MAX_PREAMBLE_BLOCKS = 40

const MAX_NOTE_LENGTH = 300

/**
 * 中国政务网站的页脚/导航标志词。命中两个以上才判定为正文结束——
 * 要求两个是为了避免正文里偶然出现「举报」「联系我们」时被误判为页脚而截断条文。
 */
const FOOTER_MARKERS = [
  '版权声明',
  '网站地图',
  '联系我们',
  'ICP备',
  '公网安备',
  '网站标识码',
  '主办单位',
  '承办单位',
  '开办单位',
  '联系方式',
  '举报',
]

function looksLikeFooterBoundary(block: string): boolean {
  let hits = 0
  for (const marker of FOOTER_MARKERS) {
    if (block.includes(marker)) hits += 1
  }
  return hits >= 2
}

/**
 * 正文结束标志：这些**单独出现**即可判定正文结束。
 *
 * 与上面的"一个块里出现多个页脚词"互补——政务网站的页脚常把每个条目各自成块，
 * 那时按块计数永远凑不够两个词，页脚就会被并进最后一条（实测中国人大网把
 * 「编 辑：…」「责 编：…」「-->」「相关文章」并进了《劳动法》第一百零七条）。
 */
const BODY_END_RES: readonly RegExp[] = [
  /^编\s*辑[：:]/,
  /^责\s*编[：:]/,
  /^责任编辑/,
  /^相关文章$/,
  /^相关稿件$/,
  /^上一篇/,
  /^下一篇/,
  /^打印本页$/,
  /^【打印】/,
  /^【我要纠错】/,
  /^扫一扫/,
  /^链接[：:]/,
  /^中国政府网/,
  /^版权所有/,
  /^主办单位/,
  /^承办单位/,
  /^关闭窗口$/,
  /^关闭本页$/,
  /^分享到/,
  /^来源[：:]/,
  /^-->$/,
  // 页脚必备字样，法律法规正文里不可能出现，命中即可判定正文结束
  /ICP备/,
  /公网安备/,
  /网站标识码/,
]

function looksLikeBodyEnd(block: string): boolean {
  if (BODY_END_RES.some((pattern) => pattern.test(block))) return true
  return looksLikeFooterBoundary(block)
}

type Heading = { kind: 'chapter' | 'section'; label: string; rest: string }

function matchHeading(block: string): Heading | null {
  const chapter = CHAPTER_RE.exec(block)
  if (chapter) return { kind: 'chapter', label: chapter[1] ?? '', rest: (chapter[2] ?? '').trim() }
  const section = SECTION_RE.exec(block)
  if (section) return { kind: 'section', label: section[1] ?? '', rest: (section[2] ?? '').trim() }
  return null
}

function truncate(text: string, max = 60): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/**
 * 从按文档顺序排列的文本块中抽取法条。
 *
 * 关键设计：
 * - 只从「第一条」开始收集；之前的块全部进入 preamble，既避免把修正决定里的条号
 *   当成正文，也不静默丢弃页面对自身版本的说明。
 * - 章标题与节标题都要单独识别。漏掉任何一级，标题就会被当成续段并进上一条正文
 *  （实测出现过「第三节 非全日制用工」并进第六十七条）。
 * - 条文可跨多个块（同一条的多款往往各自成段且无条号），无条号的块并入当前条。
 * - 条号必须严格连续，遇到不连续立即停止并记录问题——宁可少收，不可错收。
 */
export function extractStatute(blocks: string[]): ExtractionResult {
  const articles: ExtractedArticle[] = []
  const preamble: string[] = []
  const issues: string[] = []

  let chapter: string | null = null
  let section: string | null = null
  let current: ExtractedArticle | null = null
  let trailingBoundary: string | null = null
  let expected = 1
  let started = false

  for (const rawBlock of blocks) {
    let block = rawBlock

    const heading = matchHeading(block)
    if (heading !== null) {
      if (ARTICLE_RE.exec(heading.rest) === null) {
        const label = heading.kind === 'chapter' ? `第${heading.label}章` : `第${heading.label}节`
        const text = heading.rest === '' ? label : `${label} ${heading.rest}`
        if (heading.kind === 'chapter') {
          chapter = text
          section = null
        } else {
          section = text
        }
        continue
      }
      // 真实页面会把标题和条文粘在同一块里，官方页面甚至会写错章号。
      // 此时丢弃这个标题，按条文继续处理，层级沿用上一个有效值。
      issues.push(`${heading.kind === 'chapter' ? '章' : '节'}标题内混入条文，已忽略该标题：${truncate(block)}`)
      block = heading.rest
    }

    const articleMatch = ARTICLE_RE.exec(block)
    if (articleMatch) {
      const label = articleMatch[1] ?? ''
      const articleNo = cnToInt(label)

      if (articleNo === null) {
        issues.push(`无法解析条号：${truncate(block)}`)
        continue
      }

      if (!started) {
        if (articleNo !== 1) {
          preamble.push(truncate(block, MAX_NOTE_LENGTH))
          continue
        }
        started = true
      } else if (articleNo === 1) {
        // 正文已结束，页面又出现一份「第一条」：视为重复内容，正常收尾
        break
      }

      if (articleNo !== expected) {
        issues.push(`条号不连续：期望第 ${expected} 条，实际遇到第 ${articleNo} 条`)
        break
      }

      current = {
        articleNo,
        articleLabel: `第${label}条`,
        chapter,
        section,
        text: articleMatch[2] ?? '',
      }
      articles.push(current)
      expected = articleNo + 1
      continue
    }

    if (!started) {
      preamble.push(truncate(block, MAX_NOTE_LENGTH))
      continue
    }

    if (current === null) {
      issues.push(`正文起始处出现孤立段落：${truncate(block)}`)
      continue
    }

    if (looksLikeBodyEnd(block)) {
      // 政务网站的页脚常紧跟最后一条出现。若当成续段并入，会污染最后一条的正文
      //（实测出现过把「网站地图 / 新ICP备…」并进「本法自2008年1月1日起施行」）。
      trailingBoundary = truncate(block, MAX_NOTE_LENGTH)
      break
    }

    current.text = current.text === '' ? block : `${current.text}\n${block}`
  }

  const preambleBlockCount = preamble.length
  if (preambleBlockCount > MAX_PREAMBLE_BLOCKS) {
    // 前言只用于溯源，截断不计入抽取问题：否则一个导航很多的官方页面会让构建无谓失败。
    preamble.length = MAX_PREAMBLE_BLOCKS
  }

  for (const article of articles) {
    if (article.text.length < MIN_ARTICLE_LENGTH) {
      issues.push(`第 ${article.articleNo} 条正文过短（${article.text.length} 字）`)
    }
    const leaked = LEAKED_HEADING_RE.exec(article.text)
    if (leaked !== null) {
      issues.push(`第 ${article.articleNo} 条正文里混入了标题：${truncate(leaked[0])}`)
    }
  }

  return { articles, preamble, preambleBlockCount, trailingBoundary, issues }
}
