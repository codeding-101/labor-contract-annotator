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

/** 案例标题有两种形态：「案例一」单独成块，或「案例一：标题」内联。 */
const CASE_HEADING_RE = /^案例([一二三四五六七八九十]+)\s*[：:、]?\s*(.*)$/

/**
 * 小标题名称各家不统一：判例类用【基本案情】【裁判结果】，仲裁调解类用【基本情况】【处理过程】【处理结果】。
 * 这里把语义相同的归到同一个槽位，同槽位的多段按出现顺序拼接。
 */
const SECTION_MARKERS: Readonly<Record<string, SectionKey>> = {
  '【基本案情】': 'basicFacts',
  '【基本情况】': 'basicFacts',
  '【裁判结果】': 'holding',
  '【处理结果】': 'holding',
  '【处理过程】': 'holding',
  '【典型意义】': 'significance',
}

const ANY_MARKER_RE = /^【[^】]{2,8}】$/

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
 * 两个文档形态差异都要能吃下（已用最高法与安徽高院两份真实文档验证）：
 * - 标题形态：最高法是「案例一」单独成块、标题在下一块；安徽高院是「案例一：标题」内联。
 * - 目录：两家都有目录，且**目录条目的形态与正文标题完全一样**。
 *   所以不能靠有没有冒号区分，改用前视规则——正文案例在下一个案例标题之前会出现【…】小标题，
 *   目录条目不会（它后面紧跟的是下一条目录）。
 * - 标题可能被排版拆成多块，所以首个【…】之前的所有内容都并入标题。
 */
export function extractCases(blocks: string[]): CaseExtraction {
  const issues: string[] = []

  const candidates: number[] = []
  for (let i = 0; i < blocks.length; i += 1) {
    if (CASE_HEADING_RE.test(blocks[i] ?? '')) candidates.push(i)
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
    return { cases: [], issues: ['目录之后没有找到正文案例：所有案例标题后面都没有出现【…】小标题'] }
  }

  const drafts: Draft[] = []
  let current: Draft | null = null
  let section: SectionKey | null = null

  for (let i = firstBodyStart; i < blocks.length; i += 1) {
    const block = blocks[i] ?? ''

    if (bodyStarts.has(i)) {
      const match = CASE_HEADING_RE.exec(block)
      const ordinal = cnToInt(match?.[1] ?? '')
      if (match === null || ordinal === null) {
        issues.push(`无法解析案例标题：${truncate(block)}`)
        continue
      }
      current = {
        ordinal,
        caseNo: `案例${match[1] ?? ''}`,
        title: (match[2] ?? '').trim(),
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

    if (ANY_MARKER_RE.test(block)) {
      // 认不出的小标题名称：不吞掉它的内容（继续并进当前槽位），但要报出来让人补映射
      issues.push(`${current.caseNo} 出现未登记的小标题「${block}」，内容已并入${section === null ? '标题' : SECTION_LABELS[section]}`)
      continue
    }

    if (section === null) {
      // 首个【…】之前的内容都算标题（标题常被排版拆成多块）
      current.title = `${current.title}${block}`
      continue
    }
    current.sections[section].push(block)
  }

  const cases: ExtractedCase[] = []
  for (const [index, draft] of drafts.entries()) {
    if (draft.ordinal !== index + 1) {
      issues.push(`案例序号不连续：第 ${index + 1} 个案例标的是「${draft.caseNo}」`)
    }

    const title = draft.title.trim()
    const sections = {
      basicFacts: draft.sections.basicFacts.join('').trim(),
      holding: draft.sections.holding.join('').trim(),
      significance: draft.sections.significance.join('').trim(),
    }

    if (title.length < 4) issues.push(`案例「${draft.caseNo}」标题过短或缺失`)
    for (const key of Object.keys(SECTION_LABELS) as SectionKey[]) {
      if (sections[key].length < MIN_SECTION_LENGTH) {
        issues.push(`案例「${draft.caseNo}」的【${SECTION_LABELS[key]}】过短或缺失`)
      }
    }

    cases.push({ ordinal: draft.ordinal, caseNo: draft.caseNo, title, ...sections })
  }

  return { cases, issues }
}
