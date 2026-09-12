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

const CASE_HEADING_RE = /^案例([一二三四五六七八九十]+)$/

const SECTION_MARKERS: Readonly<Record<string, SectionKey>> = {
  '【基本案情】': 'basicFacts',
  '【裁判结果】': 'holding',
  '【典型意义】': 'significance',
}

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
  title: string | null
  sections: Record<SectionKey, string[]>
}

function truncate(text: string, max = 60): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/**
 * 从最高人民法院发布的典型案例文档里抽出结构化案例。
 *
 * 文档形态：`案例一` 单独成块 → 下一块是标题（「……——某某案」）→ 再往后是
 * 【基本案情】【裁判结果】【典型意义】三个小标题，各自带一段正文。
 *
 * 两个关键点：
 * - 目录里也有「案例一：…」的行，所以案例标题块必须是**只有**「案例N」、后面不带冒号，
 *   否则会把目录当成正文起点。
 * - 同一小标题下的多行直接拼接（不插换行）：原文的换行是排版折行，不是段落分隔，
 *   插换行会在句中造成假的分段。
 */
export function extractCases(blocks: string[]): CaseExtraction {
  const issues: string[] = []
  const drafts: Draft[] = []

  let current: Draft | null = null
  let section: SectionKey | null = null

  for (const block of blocks) {
    const heading = CASE_HEADING_RE.exec(block)
    if (heading !== null) {
      const ordinal = cnToInt(heading[1] ?? '')
      if (ordinal === null) {
        issues.push(`无法解析案例序号：${truncate(block)}`)
        continue
      }
      if (current !== null && current.title === null) {
        issues.push(`案例「${current.caseNo}」缺少标题`)
      }
      current = {
        ordinal,
        caseNo: `案例${heading[1] ?? ''}`,
        title: null,
        sections: { basicFacts: [], holding: [], significance: [] },
      }
      drafts.push(current)
      section = null
      continue
    }

    if (current === null) continue // 正文之前的标题、目录等

    const marker = SECTION_MARKERS[block]
    if (marker !== undefined) {
      section = marker
      continue
    }

    if (current.title === null) {
      current.title = block
      continue
    }

    if (section === null) {
      issues.push(`${current.caseNo} 在第一个小标题之前出现游离文本：${truncate(block)}`)
      continue
    }
    current.sections[section].push(block)
  }

  const cases: ExtractedCase[] = []
  for (const [index, draft] of drafts.entries()) {
    if (draft.ordinal !== index + 1) {
      issues.push(`案例序号不连续：第 ${index + 1} 个案例标的是「${draft.caseNo}」`)
    }

    const title = (draft.title ?? '').trim()
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
