import { cnToInt } from './cn-number.ts'

export type ExtractedCase = {
  ordinal: number
  caseNo: string
  title: string
  basicFacts: string
  holding: string
  significance: string
}

export type CaseExtraction = {
  cases: ExtractedCase[]
  issues: string[]
}

type SectionKey = 'basicFacts' | 'holding' | 'significance'

/**
 * 案例标题的三种真实形态（已用三份官方文档验证）：
 * - 「案例」单独成块，标题在下一块（有的文档这样排版）
 * - 「案例一」单独成块（最高法）／「案例一：标题」内联（安徽高院）
 * - 「案例1.标题」粘连在同一块（北京人社局，阿拉伯数字＋点号）
 * 每一支都必须以 `$` 或明确的分隔符收尾，否则会把「案例评析」这种小标题也当成案例标题。
 */
const CASE_HEADING_PATTERNS: readonly RegExp[] = [
  /^案例\s*([一二三四五六七八九十]+)\s*[：:、]?\s*(.*)$/,
  /^案例\s*(\d+)\s*[.．、]\s*(.*)$/,
  /^案例$/,
]

type CaseHeading = { declared: number | null; declaredText: string | null; inlineTitle: string }

function matchCaseHeading(block: string): CaseHeading | null {
  for (const pattern of CASE_HEADING_PATTERNS) {
    const match = pattern.exec(block)
    if (match === null) continue
    if (match.length === 1) return { declared: null, declaredText: null, inlineTitle: '' }
    const declaredText = match[1] ?? ''
    return { declared: cnToInt(declaredText), declaredText, inlineTitle: (match[2] ?? '').trim() }
  }
  return null
}

/**
 * 小标题名称各家不统一，甚至有带不带【】两种写法：
 * 判例类用【基本案情】【裁判结果】【典型意义】，仲裁调解类用【基本情况】【处理过程】【处理结果】，
 * 人社部门的案例集直接用「案情简介」「仲裁请求」「处理结果」「案例评析」「仲裁委员会提示」。
 * 这里把语义相同的归到同一个槽位，同槽位的多段按出现顺序拼接。
 */
const SECTION_MARKERS: Readonly<Record<string, SectionKey>> = {
  '【基本案情】': 'basicFacts',
  '【基本情况】': 'basicFacts',
  案情简介: 'basicFacts',
  基本案情: 'basicFacts',
  基本情况: 'basicFacts',
  // 仲裁请求是当事人主张，属于案情记录的一部分，并入 basicFacts 保序（事实 → 主张 → 结果）
  仲裁请求: 'basicFacts',
  '【裁判结果】': 'holding',
  '【处理结果】': 'holding',
  '【处理过程】': 'holding',
  裁判结果: 'holding',
  处理结果: 'holding',
  处理过程: 'holding',
  '【典型意义】': 'significance',
  典型意义: 'significance',
  案例评析: 'significance',
  仲裁委员会提示: 'significance',
}

const BRACKETED_MARKER_RE = /^【[^】]{2,8}】$/

/** 标题行里的序号前缀，如「1.以用工事实认定…」。 */
const TITLE_ORDINAL_RE = /^(\d+)\s*[.．、]\s*/

const SECTION_LABELS: Readonly<Record<SectionKey, string>> = {
  basicFacts: '基本案情',
  holding: '裁判结果',
  significance: '典型意义',
}

/** 各段短于此长度视为抽取异常，而不是正常内容。 */
const MIN_SECTION_LENGTH = 20

type Draft = {
  ordinal: number
  caseNo: string
  title: string
  sections: Record<SectionKey, string[]>
}

function truncate(text: string, max = 60): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/**
 * 从法院／人社部门发布的典型案例文档里抽出结构化案例。
 *
 * 三个关键设计：
 * - **目录靠前视规则排除**：有的文档目录条目与正文标题形态完全相同，不能靠标点区分；
 *   正文案例在下一个案例标题之前会出现小标题，目录条目不会。
 * - **序号以出现位置为准**（第几个案例就是几），文档自带的序号只用于交叉校验，
 *   因为有的形态案号写在标题行里、有的根本不给序号。
 * - 标题可能被排版拆成多块，首个已知小标题之前的内容都并入标题。
 */
export function extractCases(blocks: string[]): CaseExtraction {
  const issues: string[] = []

  const candidates: number[] = []
  for (let i = 0; i < blocks.length; i += 1) {
    if (matchCaseHeading(blocks[i] ?? '') !== null) candidates.push(i)
  }

  const bodyStarts = new Set(
    candidates.filter((from, index) => {
      const until = candidates[index + 1] ?? blocks.length
      for (let j = from + 1; j < until; j += 1) {
        if (SECTION_MARKERS[blocks[j] ?? ''] !== undefined) return true
      }
      return false
    }),
  )

  const firstBodyStart = [...bodyStarts].sort((a, b) => a - b)[0]
  if (firstBodyStart === undefined) {
    return { cases: [], issues: ['没有找到正文案例：所有案例标题后面都没有出现可识别的小标题'] }
  }

  const drafts: Draft[] = []
  let current: Draft | null = null
  let section: SectionKey | null = null

  for (let i = firstBodyStart; i < blocks.length; i += 1) {
    const block = blocks[i] ?? ''

    if (bodyStarts.has(i)) {
      const heading = matchCaseHeading(block)
      if (heading === null) {
        issues.push(`无法解析案例标题：${truncate(block)}`)
        continue
      }
      const ordinal = drafts.length + 1
      if (heading.declared !== null && heading.declared !== ordinal) {
        issues.push(`案例序号与出现顺序不一致：第 ${ordinal} 个案例标的是「案例${heading.declaredText ?? ''}」`)
      }
      current = {
        ordinal,
        // 文档没给序号时用出现位置标注，明确这是位置而不是原文
        caseNo: heading.declaredText === null ? `第${ordinal}个案例` : `案例${heading.declaredText}`,
        title: heading.inlineTitle,
        sections: { basicFacts: [], holding: [], significance: [] },
      }
      drafts.push(current)
      section = null
      continue
    }

    if (current === null) continue

    const marker = SECTION_MARKERS[block]
    if (marker !== undefined) {
      section = marker
      continue
    }

    if (BRACKETED_MARKER_RE.test(block)) {
      // 认不出的小标题：不吞掉它的内容（继续并进当前槽位），但要报出来让人补映射
      issues.push(
        `${current.caseNo} 出现未登记的小标题「${block}」，内容已并入${section === null ? '标题' : SECTION_LABELS[section]}`,
      )
      continue
    }

    if (section === null) {
      // 首个已知小标题之前的内容都算标题（标题常被排版拆成多块）
      current.title = `${current.title}${block}`
      continue
    }
    current.sections[section].push(block)
  }

  const cases: ExtractedCase[] = []
  for (const draft of drafts) {
    const prefix = TITLE_ORDINAL_RE.exec(draft.title)
    if (prefix !== null) {
      const declared = Number(prefix[1])
      if (declared !== draft.ordinal) {
        issues.push(`${draft.caseNo} 标题里的序号「${prefix[1]}」与出现顺序不一致`)
      }
      draft.title = draft.title.replace(TITLE_ORDINAL_RE, '')
    }

    const title = draft.title.trim()
    const sections = {
      basicFacts: draft.sections.basicFacts.join('').trim(),
      holding: draft.sections.holding.join('').trim(),
      significance: draft.sections.significance.join('').trim(),
    }

    if (title.length < 4) issues.push(`${draft.caseNo} 标题过短或缺失`)
    for (const key of Object.keys(SECTION_LABELS) as SectionKey[]) {
      if (sections[key].length < MIN_SECTION_LENGTH) {
        issues.push(`${draft.caseNo} 的【${SECTION_LABELS[key]}】过短或缺失`)
      }
    }

    cases.push({ ordinal: draft.ordinal, caseNo: draft.caseNo, title, ...sections })
  }

  return { cases, issues }
}
