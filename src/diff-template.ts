import type { ContractTemplate } from './schema.ts'
import { FILL } from './mark-blanks.ts'
import { normalizeForCompare } from './normalize.ts'

export type DiffKind = 'MISSING_IN_CONTRACT' | 'EXTRA_IN_CONTRACT' | 'MODIFIED' | 'BLANK_LEFT'

/** 范本侧条款（扁平化后）。 */
export type TemplateClause = {
  sectionTitle: string | null
  articleNo: number
  articleLabel: string
  text: string
}

/** 合同侧条款。真实合同可能没有章节层级，也可能没有条号，所以这两项可空。 */
export type ContractClause = {
  sectionTitle: string | null
  articleNo: number | null
  label: string
  text: string
}

export type DiffItem = {
  kind: DiffKind
  sectionTitle: string | null
  templateLabel: string | null
  contractLabel: string | null
  templateText: string | null
  contractText: string | null
  /** 对齐方式，便于人工复核"为什么把这两条配到了一起"。 */
  matchMethod: string
  similarity: number | null
}

export type DiffResult = {
  items: DiffItem[]
  counts: Record<DiffKind, number>
  /** 对齐上且完全符合范本模式的条款数（未填写的空位不算）。 */
  matchedOk: number
  templateClauseCount: number
  contractClauseCount: number
}

const REGEX_METACHARACTERS = /[.*+?^${}()|[\]\\]/g

function escapeRegExp(text: string): string {
  return text.replace(REGEX_METACHARACTERS, '\\$&')
}

/**
 * 切分填空标记用的正则，大小写不敏感。
 *
 * 这不只是保险：normalizeForCompare 会把文本转小写，{{FILL}} 会变成 {{fill}}。
 * 若用大写标记去 split，就切不开，整段标记会被当作普通文本转义进正则，
 * 于是所有含填空位的条款都匹配不上——评测里"填空位全部填好"这个最该零差异的
 * 用例因此有 6 条被判成 MODIFIED。
 */
const FILL_SPLIT_RE = new RegExp(escapeRegExp(FILL), 'gi')

/**
 * 把范本条款编译成"能匹配填好内容的合同条款"的正则。
 *
 * 关键：范本里的 FILL 必须变成通配符。若按字面比较，用户填好的每一处内容
 * 都会被判成 MODIFIED，误报率会高到不可用。
 *
 * 做法是先归一化（去空白、统一全角标点、转小写），再按 FILL 切段、逐段转义、
 * 用 .+? 连接。不能先转义再替换 FILL——转义会把 {{FILL}} 变成 \{\{FILL\}\}，
 * 就再也匹配不上了。
 */
export function compileClausePattern(templateText: string): RegExp {
  const parts = normalizeForCompare(templateText).split(FILL_SPLIT_RE).map(escapeRegExp)
  return new RegExp(`^${parts.join('.+?')}$`)
}

function bigrams(text: string): Set<string> {
  const grams = new Set<string>()
  for (let i = 0; i + 1 < text.length; i += 1) {
    grams.add(text.slice(i, i + 2))
  }
  return grams
}

/** 二字符组的 Dice 系数。确定性、无依赖、对中文友好。 */
export function similarity(a: string, b: string): number {
  const left = bigrams(normalizeForCompare(a))
  const right = bigrams(normalizeForCompare(b))
  if (left.size === 0 || right.size === 0) return 0

  let shared = 0
  for (const gram of left) {
    if (right.has(gram)) shared += 1
  }
  return (2 * shared) / (left.size + right.size)
}

type Alignment = { index: number; clause: ContractClause; matchMethod: string; score: number | null }

const SIMILARITY_THRESHOLD = 0.5

/**
 * 三级对齐，从最确定的往下退：
 * 1. 范本模式匹配（对改写、重新编号都稳）
 * 2. 条号相同
 * 3. 二字符组相似度最高且过阈值
 *
 * 每一级都把"怎么对上"记进 matchMethod，报告里可以展示给用户看。
 */
function findAlignment(
  templateClause: TemplateClause,
  contractClauses: ContractClause[],
  consumed: Set<number>,
  pattern: RegExp,
): Alignment | null {
  for (const [index, clause] of contractClauses.entries()) {
    if (consumed.has(index)) continue
    if (pattern.test(normalizeForCompare(clause.text))) {
      return { index, clause, matchMethod: '模式匹配', score: 1 }
    }
  }

  for (const [index, clause] of contractClauses.entries()) {
    if (consumed.has(index)) continue
    if (clause.articleNo !== null && clause.articleNo === templateClause.articleNo) {
      return { index, clause, matchMethod: '条号相同', score: null }
    }
  }

  let best: Alignment | null = null
  for (const [index, clause] of contractClauses.entries()) {
    if (consumed.has(index)) continue
    const score = similarity(templateClause.text, clause.text)
    if (score >= SIMILARITY_THRESHOLD && (best === null || score > (best.score ?? 0))) {
      best = { index, clause, matchMethod: '相似度', score }
    }
  }
  return best
}

function emptyCounts(): Record<DiffKind, number> {
  return { MISSING_IN_CONTRACT: 0, EXTRA_IN_CONTRACT: 0, MODIFIED: 0, BLANK_LEFT: 0 }
}

/**
 * 把合同与范本逐条比对，输出四类差异。
 *
 * 分类决策树：
 *   对不上范本任何条款 → MISSING_IN_CONTRACT（范本侧）/ EXTRA_IN_CONTRACT（合同侧）
 *   对上了但要填的空位还是空的 → BLANK_LEFT
 *   对上了但不符合范本模式 → MODIFIED
 *   其余 → 一致
 */
export function diffAgainstTemplate(
  templateClauses: TemplateClause[],
  contractClauses: ContractClause[],
): DiffResult {
  const items: DiffItem[] = []
  const counts = emptyCounts()
  const consumed = new Set<number>()
  let matchedOk = 0

  for (const templateClause of templateClauses) {
    const pattern = compileClausePattern(templateClause.text)
    const alignment = findAlignment(templateClause, contractClauses, consumed, pattern)

    if (alignment === null) {
      counts.MISSING_IN_CONTRACT += 1
      items.push({
        kind: 'MISSING_IN_CONTRACT',
        sectionTitle: templateClause.sectionTitle,
        templateLabel: templateClause.articleLabel,
        contractLabel: null,
        templateText: templateClause.text,
        contractText: null,
        matchMethod: '未找到对应条款',
        similarity: null,
      })
      continue
    }

    consumed.add(alignment.index)
    const contractText = alignment.clause.text
    const base = {
      sectionTitle: templateClause.sectionTitle,
      templateLabel: templateClause.articleLabel,
      contractLabel: alignment.clause.label,
      templateText: templateClause.text,
      contractText,
      matchMethod: alignment.matchMethod,
      similarity: alignment.score,
    }

    if (!pattern.test(normalizeForCompare(contractText))) {
      counts.MODIFIED += 1
      items.push({ ...base, kind: 'MODIFIED' })
    } else if (contractText.includes(FILL)) {
      counts.BLANK_LEFT += 1
      items.push({ ...base, kind: 'BLANK_LEFT' })
    } else {
      matchedOk += 1
    }
  }

  for (const [index, clause] of contractClauses.entries()) {
    if (consumed.has(index)) continue
    counts.EXTRA_IN_CONTRACT += 1
    items.push({
      kind: 'EXTRA_IN_CONTRACT',
      sectionTitle: clause.sectionTitle,
      templateLabel: null,
      contractLabel: clause.label,
      templateText: null,
      contractText: clause.text,
      matchMethod: '范本中没有对应条款',
      similarity: null,
    })
  }

  return {
    items,
    counts,
    matchedOk,
    templateClauseCount: templateClauses.length,
    contractClauseCount: contractClauses.length,
  }
}

/** 把范本产物扁平化成比对用的条款列表。 */
export function flattenTemplate(template: ContractTemplate): TemplateClause[] {
  return template.sections.flatMap((section) =>
    section.articles.map((article) => ({
      sectionTitle: `${section.sectionNo}、${section.sectionTitle}`,
      articleNo: article.articleNo,
      articleLabel: article.articleLabel,
      text: article.text,
    })),
  )
}
