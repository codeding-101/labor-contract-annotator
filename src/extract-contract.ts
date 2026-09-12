import { cnToInt } from './cn-number.ts'
import type { ContractClause } from './diff-template.ts'

export type ContractExtraction = {
  clauses: ContractClause[]
  /** 抽取方式：按条号切分，或退化成按段落切分。 */
  method: 'ARTICLES' | 'PARAGRAPHS'
  /** 条号之前被略过的段落数（合同抬头、甲方乙方信息等），不算错误，但要如实记录。 */
  skippedBeforeFirstArticle: number
  issues: string[]
}

const ARTICLE_RE = /^第\s*([一二三四五六七八九十百千零〇0-9]+)\s*条[\s　、.．:：]*(.*)$/
const SECTION_RE = /^第\s*([一二三四五六七八九十百千零〇0-9]+)\s*[章节][\s　]*(.*)$/

/** 章节标题块的长度上限与标点限制，用来避免把「第三章的规定」这类正文误判成标题。 */
const MAX_HEADING_LENGTH = 20
const SENTENCE_PUNCTUATION = /[。，；：？！]/

function looksLikeHeading(block: string): boolean {
  return block.length <= MAX_HEADING_LENGTH && !SENTENCE_PUNCTUATION.test(block)
}

/**
 * 从用户提供的合同文本里抽出条款。
 *
 * 与范本抽取器（`extract-template.ts`）刻意不同：**这里不要求结构规整**。
 * 真实合同未必有「一、」节标题，条号也可能跳号、缺号、干脆不用条号。
 * 所以策略是：
 * 1. 能认出「第X条」就按条号切分，**但不校验连续性**——跳号是对方合同的写法问题，
 *    不该让整份合同抽取失败；
 * 2. 一条都认不出时退化成"一段即一条"，仍然能跑比对与规则（对齐本就允许条号对不上）；
 * 3. 条号之前的内容（抬头、双方信息）略过，但记录条数，不假装没看见。
 */
export function extractContract(text: string): ContractExtraction {
  const blocks = text
    .split(/\r?\n+/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .filter((block) => block !== '')

  if (blocks.length === 0) {
    return { clauses: [], method: 'PARAGRAPHS', skippedBeforeFirstArticle: 0, issues: ['合同内容为空'] }
  }

  const articles = blocks.filter((block) => ARTICLE_RE.test(block))
  if (articles.length === 0) {
    return {
      clauses: blocks.map((block, index) => ({
        sectionTitle: null,
        articleNo: null,
        label: `第${index + 1}段`,
        text: block,
      })),
      method: 'PARAGRAPHS',
      skippedBeforeFirstArticle: 0,
      issues: [],
    }
  }

  const issues: string[] = []
  const clauses: ContractClause[] = []
  let sectionTitle: string | null = null
  let current: ContractClause | null = null
  let skipped = 0

  for (const block of blocks) {
    const section = SECTION_RE.exec(block)
    if (section !== null && section[1] !== undefined && looksLikeHeading(block)) {
      sectionTitle = block
      continue
    }

    const article = ARTICLE_RE.exec(block)
    if (article !== null) {
      const articleNo = cnToInt(article[1] ?? '')
      current = {
        sectionTitle,
        articleNo,
        label: articleNo === null ? '未编号条款' : `第${article[1]}条`,
        text: article[2] ?? '',
      }
      clauses.push(current)
      continue
    }

    if (current === null) {
      skipped += 1
      continue
    }
    // 续段并入当前条款：合同里的换行多为排版折行，不是段落分隔
    current.text = current.text === '' ? block : `${current.text}${block}`
  }

  const tooShort = clauses.filter((clause) => clause.text.length < 4)
  if (tooShort.length === clauses.length) {
    issues.push('所有条款正文都过短，可能没有识别出真正的条款边界')
  }

  return { clauses, method: 'ARTICLES', skippedBeforeFirstArticle: skipped, issues }
}
