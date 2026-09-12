import { cnToInt } from './cn-number.ts'

export type TemplateArticle = {
  articleNo: number
  articleLabel: string
  text: string
}

export type TemplateSection = {
  sectionNo: string
  sectionTitle: string
  articles: TemplateArticle[]
}

export type TemplateExtraction = {
  /** 正文之前的全部块（标题、注意事项、甲乙双方信息栏、序言等），原样保留。 */
  frontMatter: string[]
  /** 从 frontMatter 中识别出的「注意事项」条目。 */
  notes: string[]
  sections: TemplateSection[]
  /** 正文结束之后的块（签署栏之后的内容，含附件与页脚）。 */
  trailing: string[]
  trailingBlockCount: number
  /** 判定正文结束的块；为 null 说明主线一直走到文档末尾。 */
  bodyEndBlock: string | null
  issues: string[]
}

const ARTICLE_RE = /^第([一二三四五六七八九十百千零〇0-9]+)条[\s　]*(.*)$/
const SECTION_RE = /^([一二三四五六七八九十]+)、[\s　]*(.*)$/

/** 续段里属于列表项的行（另起一行显示）。 */
const LIST_ITEM_RE = /^(?:\d+[.．]|[（(][一二三四五六七八九十\d]+[）)])/

/** 条文正文里不应出现以节标题开头的行，出现即说明有节标题漏处理、被当成了续段。 */
const LEAKED_SECTION_RE = /^[一二三四五六七八九十]+、/m

const MIN_ARTICLE_LENGTH = 4
const MAX_TRAILING_BLOCKS = 40
const MAX_NOTE_LENGTH = 300

/**
 * 政务网站的页脚标志词。命中两个以上即认为正文结束。
 * 要求两个是为了避免正文里偶然出现「举报」之类的词就被判成页脚。
 */
const FOOTER_MARKERS = [
  '版权声明',
  '网站地图',
  '联系我们',
  'ICP备',
  '公网安备',
  '网站标识码',
  '主办',
  '承办',
  '联系方式',
]

const SIGNATURE_RE = /(盖章|签字)/

function truncate(text: string, max = 60): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

function looksLikeFooter(block: string): boolean {
  let hits = 0
  for (const marker of FOOTER_MARKERS) {
    if (block.includes(marker)) hits += 1
  }
  return hits >= 2
}

/** 签署栏：同时出现甲乙双方与签章字样。注意事项里也有"签字盖章"，但不会同时出现甲乙方。 */
function looksLikeSignature(block: string): boolean {
  if (!SIGNATURE_RE.test(block)) return false
  const sides = Number(block.includes('甲方')) + Number(block.includes('乙方'))
  return sides >= 2
}

/** 正文结束判定：签署栏或页脚。 */
function isBodyEnd(block: string): boolean {
  return looksLikeSignature(block) || looksLikeFooter(block)
}

/**
 * Word 导出的范本常把一句话拆到多个段落（例如「执行以下第」与「种工时制度：」分属两块）。
 * 列表项另起一行，其余直接续写，避免在句中插进假的换行。
 * 比较时反正会归一化空白，这里只影响产物的可读性。
 */
function joinContinuation(previous: string, block: string): string {
  if (previous === '') return block
  return LIST_ITEM_RE.test(block) ? `${previous}\n${block}` : `${previous}${block}`
}

/**
 * 找出真正的节标题（本范本用「一、」「二、」编号章节）。
 *
 * 关键：注意事项也编号成「一、」「二、」，附件同样如此，所以不能只看形状。
 * 采用前视规则——一个「X、…」块只有在它之后、下一个「X、…」块之前出现了
 * 「第X条」，才算节标题。实测这条规则能干净地把注意事项与两个附件排除掉。
 */
function findSectionStarts(blocks: string[]): Set<number> {
  const candidates: number[] = []
  for (let i = 0; i < blocks.length; i += 1) {
    if (SECTION_RE.test(blocks[i] ?? '')) candidates.push(i)
  }

  const starts = new Set<number>()
  for (let k = 0; k < candidates.length; k += 1) {
    const from = candidates[k]
    if (from === undefined) continue
    const until = candidates[k + 1] ?? blocks.length
    for (let j = from + 1; j < until; j += 1) {
      if (ARTICLE_RE.test(blocks[j] ?? '')) {
        starts.add(from)
        break
      }
    }
  }
  return starts
}

type FoundArticle = { articleNo: number; articleLabel: string; startIndex: number; text: string }

/**
 * 从按文档顺序排列的文本块中抽取劳动合同范本的结构。
 *
 * 与法条抽取器分开实现，因为两者的结构模型不同：法条是「章/节 + 条文」，
 * 范本是「注意事项 + 甲乙双方信息栏 + 序言 + 节（一、二、）+ 条文（第X条）+ 附件」，
 * 而且范本多一层"哪些块属于正文"的判定。
 */
export function extractTemplate(blocks: string[]): TemplateExtraction {
  const issues: string[] = []
  const found: FoundArticle[] = []
  const sectionStarts = findSectionStarts(blocks)
  let bodyEndIndex = -1
  let bodyEndBlock: string | null = null
  let expected = 1
  let started = false

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i] ?? ''
    const match = ARTICLE_RE.exec(block)

    if (match !== null) {
      const label = match[1] ?? ''
      const articleNo = cnToInt(label)
      if (articleNo === null) {
        issues.push(`无法解析条号：${truncate(block)}`)
        continue
      }
      if (!started) {
        if (articleNo !== 1) continue // 正文之前的条号引用
        started = true
      } else if (articleNo === 1) {
        break // 页面重复贴了一份，收尾
      }
      if (articleNo !== expected) {
        issues.push(`条号不连续：期望第 ${expected} 条，实际遇到第 ${articleNo} 条`)
        break
      }
      found.push({ articleNo, articleLabel: `第${label}条`, startIndex: i, text: match[2] ?? '' })
      expected = articleNo + 1
      continue
    }

    const current = found[found.length - 1]
    if (current === undefined) continue

    if (isBodyEnd(block)) {
      bodyEndIndex = i
      bodyEndBlock = truncate(block, MAX_NOTE_LENGTH)
      break
    }

    // 节标题块不属于任何条文正文。必须跳过，否则会被当成续段并进上一条
    //（实测出现过第五条正文末尾挂上「四、劳动报酬」）。
    if (sectionStarts.has(i)) continue

    current.text = joinContinuation(current.text, block)
  }

  const bodyStarts = [...sectionStarts, ...found.map((article) => article.startIndex)]
  const bodyStart = bodyStarts.length === 0 ? blocks.length : Math.min(...bodyStarts)

  const frontMatter = blocks.slice(0, bodyStart)
  const notes = frontMatter
    .filter((block) => SECTION_RE.test(block))
    .map((block) => truncate(block, MAX_NOTE_LENGTH))

  const orderedSectionStarts = [...sectionStarts].sort((a, b) => a - b)
  const sections: TemplateSection[] = []
  const sectionByStart = new Map<number, TemplateSection>()
  for (const start of orderedSectionStarts) {
    const match = SECTION_RE.exec(blocks[start] ?? '')
    const section: TemplateSection = {
      sectionNo: match?.[1] ?? '',
      sectionTitle: (match?.[2] ?? '').trim(),
      articles: [],
    }
    sections.push(section)
    sectionByStart.set(start, section)
  }

  // 一次有序归并：条文按文档顺序出现，节标题也按序，游标只往前走。
  let owner: TemplateSection | null = null
  let cursor = 0
  for (const article of found) {
    while (cursor < orderedSectionStarts.length && (orderedSectionStarts[cursor] ?? 0) < article.startIndex) {
      owner = sectionByStart.get(orderedSectionStarts[cursor] ?? -1) ?? owner
      cursor += 1
    }
    if (owner === null) {
      issues.push(`第 ${article.articleNo} 条未归属到任何节标题`)
      continue
    }
    owner.articles.push({
      articleNo: article.articleNo,
      articleLabel: article.articleLabel,
      text: article.text,
    })
  }

  const lastArticleIndex = found[found.length - 1]?.startIndex ?? -1
  const trailingFrom = bodyEndIndex >= 0 ? bodyEndIndex : lastArticleIndex + 1
  const trailingBlocks = blocks.slice(trailingFrom)

  for (const article of found) {
    if (article.text.length < MIN_ARTICLE_LENGTH) {
      issues.push(`第 ${article.articleNo} 条正文过短（${article.text.length} 字）`)
    }
    const leaked = LEAKED_SECTION_RE.exec(article.text)
    if (leaked !== null) {
      issues.push(`第 ${article.articleNo} 条正文里混入了节标题：${truncate(leaked[0])}`)
    }
    // 行首断言抓不到"续段拼接时没换行"的情况，所以再按完整的节标题串比对一次。
    for (const section of sections) {
      const heading = `${section.sectionNo}、${section.sectionTitle}`
      if (section.sectionTitle !== '' && article.text.includes(heading)) {
        issues.push(`第 ${article.articleNo} 条正文里混入了节标题「${heading}」`)
      }
    }
    if (looksLikeSignature(article.text)) {
      issues.push(`第 ${article.articleNo} 条正文里混入了签署栏内容`)
    }
  }

  return {
    frontMatter: frontMatter.map((block) => truncate(block, MAX_NOTE_LENGTH)),
    notes,
    sections,
    trailing: trailingBlocks.slice(0, MAX_TRAILING_BLOCKS).map((block) => truncate(block, MAX_NOTE_LENGTH)),
    trailingBlockCount: trailingBlocks.length,
    bodyEndBlock,
    issues,
  }
}
