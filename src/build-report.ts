import type { ContractClause } from './diff-template.ts'
import { FACT_META, looksLikeHeading, sentenceAround, type FactKey, type FactSet } from './extract-facts.ts'
import type { RiskEvidence, RuleEngineResult, StatuteRef, UndeterminedItem } from './rule-engine.ts'
import type { ContractTemplate, RiskLevel } from './schema.ts'

export type ReportRisk = {
  ruleCode: string
  level: RiskLevel
  title: string
  category: string
  explanation: string
  suggestion: string
  statutes: StatuteRef[]
  evidence: RiskEvidence
  note?: string
}

/**
 * 关键信息的取值状态。
 * - `VALUE`：抽到了数值（期限/金额/天数），`value` 是带单位的结果；
 * - `TEXT`：抽到了文本事实，`value` 就是合同原文片段——这类项"是什么"比"有没有"更有用；
 * - `MENTIONED`：合同里有相关字样，但没能识别出具体值；`evidence` 带原文片段供人工核对；
 * - `NOT_FOUND`：合同里连相关字样都没有。
 *
 * `MENTIONED` 必须与 `NOT_FOUND` 分开：把"没认出来"说成"没写"会冤枉合同，
 * 把"有提及"说成"已核对"又会误导用户。
 */
export type KeyInfoStatus = 'VALUE' | 'TEXT' | 'MENTIONED' | 'NOT_FOUND'

export type KeyInfoRow = {
  label: string
  value: string | null
  status: KeyInfoStatus
  /** 依据的条款或原文片段，报告里可回溯。 */
  evidence: string | null
}

export type ReportSummary = { title: string; lines: string[] }

export type ContractReport = {
  template: { id: string; name: string; regionName: string; regionCode: string }
  counts: { red: number; yellow: number; blue: number }
  risks: ReportRisk[]
  undetermined: UndeterminedItem[]
  keyInfo: KeyInfoRow[]
  summaries: ReportSummary[]
  disclaimers: string[]
  versions: { ruleSetVersion: string; templateVersion: string; generatedAt: string }
}

const LEVEL_LABELS: Readonly<Record<RiskLevel, string>> = { red: '严重', yellow: '需关注', blue: '提示' }

const LEVEL_ORDER: Readonly<Record<RiskLevel, number>> = { red: 0, yellow: 1, blue: 2 }

type KeyInfoSource =
  | { kind: 'fact'; factKey: FactKey; mention: readonly string[] }
  | { kind: 'wageStructure' }

/** 「工资结构」由三个工资分项合成，本身没有独立的事实键。 */
const WAGE_STRUCTURE_KEYS: readonly FactKey[] = ['baseWage', 'performanceWage', 'bonusWage']

/**
 * 劳动者最关心的关键信息，每一项都对应一条抽取规则。
 *
 * 这里原先有 11 项只做关键词存在性判断，报告里显示成「有提及（未核对内容）」——
 * 等于什么都没说，而且关键词表覆盖不到真实写法时还会误报「合同未提及」。
 * 现在每一项都取真值：取到了就显示值，取不到但合同里确实有相关字样，就摘原文出来让人自己核对。
 *
 * `mention` 只用于"没能识别出值"时的兜底判断，因此宁可宽一点：宽了最多是提示"有相关内容"，
 * 窄了会把写了的项误报成"合同未提及"。
 */
const KEY_INFO_ITEMS: readonly { label: string; source: KeyInfoSource }[] = [
  { label: '合同期限', source: { kind: 'fact', factKey: 'contractTermMonths', mention: ['合同期限', '期限'] } },
  { label: '试用期', source: { kind: 'fact', factKey: 'probationMonths', mention: ['试用期'] } },
  {
    label: '约定月工资',
    source: { kind: 'fact', factKey: 'monthlyWage', mention: ['工资', '薪资', '薪酬', '劳动报酬'] },
  },
  { label: '试用期工资', source: { kind: 'fact', factKey: 'probationMonthlyWage', mention: ['试用期'] } },
  {
    label: '竞业限制期限',
    source: { kind: 'fact', factKey: 'nonCompeteMonths', mention: ['竞业限制', '竞业禁止'] },
  },
  { label: '工资结构', source: { kind: 'wageStructure' } },
  { label: '基本工资', source: { kind: 'fact', factKey: 'baseWage', mention: ['基本工资', '底薪'] } },
  { label: '绩效工资', source: { kind: 'fact', factKey: 'performanceWage', mention: ['绩效'] } },
  { label: '奖金', source: { kind: 'fact', factKey: 'bonusWage', mention: ['奖金', '奖励'] } },
  {
    label: '发薪日期',
    source: {
      kind: 'fact',
      factKey: 'payDayOfMonth',
      // 关键词表要覆盖真实写法。实测被两类真实材料打穿过：
      // 一句「工资支付方式：甲方于每月15日…发放上月工资」一个关键词都不含（原表只有「发薪/支付日期/发放日期」）；
      // 新就业形态的合同则通篇写「劳动报酬」「结算支付」，根本不出现「工资支付」这四个字。
      mention: [
        '发薪',
        '发放日',
        '支付日期',
        '发放日期',
        '支付方式',
        '发放方式',
        '工资发放',
        '工资支付',
        '发放工资',
        '支付工资',
        '每月至少',
        '结算支付',
        '支付一次',
        '报酬支付',
        '支付报酬',
        '支付劳动报酬',
      ],
    },
  },
  {
    label: '每日工作时间',
    source: { kind: 'fact', factKey: 'dailyWorkHours', mention: ['工作时间', '工时'] },
  },
  { label: '加班规则', source: { kind: 'fact', factKey: 'overtimeText', mention: ['加班'] } },
  {
    label: '年休假',
    // 只认"年休假"本名：范本里的"休息休假权利""法定节假日"是别的事项，
    // 用宽泛的"休假"判断会把它们错算成对年休假的约定。
    source: { kind: 'fact', factKey: 'annualLeaveDays', mention: ['年休假', '年假'] },
  },
  {
    label: '五险一金',
    source: {
      kind: 'fact',
      factKey: 'socialInsuranceFundText',
      mention: ['社会保险', '社保', '住房公积金', '公积金'],
    },
  },
  {
    label: '工作地点',
    source: { kind: 'fact', factKey: 'workLocationText', mention: ['工作地点', '工作地址', '办公地点'] },
  },
  {
    label: '违约责任',
    source: { kind: 'fact', factKey: 'breachText', mention: ['违约金', '违约责任'] },
  },
  { label: '保密期限', source: { kind: 'fact', factKey: 'confidentialityMonths', mention: ['保密'] } },
]

const DISCLAIMERS: readonly string[] = [
  '本报告由工具自动生成，仅供参考，不构成法律意见，也不能替代执业律师。',
  '本工具只做事实比对与条文引用：把条款标出来并附上法律依据，不做综合评价，也不替你决定签还是不签。',
  '不同地区的规定存在差异，最终请以当地劳动保障部门、工会或执业律师的意见为准。',
  '合同中出现但本工具未覆盖的事项，不在本报告的检查范围内。',
]

/**
 * 没能取出值时，用关键词判断合同里到底有没有相关内容。
 * 注意这里只用于区分「有提及」和「未提及」，**绝不**用它填值——关键词证明不了条款内容是什么。
 *
 * 摘录的挑法，两条按顺序：
 * 1. **命中本行关键词最多的那一句**——一句话里同时出现「每月至少」「支付报酬」，
 *    比只蹭到「报酬支付」四个字的职责描述更可能是在讲发薪；
 * 2. 同样多时取**最短**的那句，因为关键词经常先出现在章节标题里
 *    （「工作内容和工作地点」「保密与竞业限制」），那种句子又短又不是内容。
 * 标题再用 `looksLikeHeading` 排除；过滤后一句都不剩时退回不过滤——
 * 宁可摘到标题，也不能误报「合同未提及」。
 */
const MIN_MENTION_LENGTH = 6

function mentionRow(label: string, clauses: ContractClause[], keywords: readonly string[]): KeyInfoRow {
  const candidates: { sentence: string; hits: number }[] = []

  for (const clause of clauses) {
    for (const keyword of keywords) {
      let index = clause.text.indexOf(keyword)
      while (index !== -1) {
        const sentence = sentenceAround(clause.text, index, 100)
        if (sentence.length >= MIN_MENTION_LENGTH) {
          candidates.push({ sentence, hits: keywords.filter((word) => sentence.includes(word)).length })
        }
        index = clause.text.indexOf(keyword, index + keyword.length)
      }
    }
  }

  const best = (from: readonly { sentence: string; hits: number }[]): string | null =>
    from.reduce<{ sentence: string; hits: number } | null>((chosen, candidate) => {
      if (chosen === null) return candidate
      if (candidate.hits !== chosen.hits) return candidate.hits > chosen.hits ? candidate : chosen
      return candidate.sentence.length < chosen.sentence.length ? candidate : chosen
    }, null)?.sentence ?? null

  const evidence =
    best(candidates.filter((candidate) => !looksLikeHeading(candidate.sentence))) ?? best(candidates)

  return evidence === null
    ? { label, value: null, status: 'NOT_FOUND', evidence: null }
    : { label, value: null, status: 'MENTIONED', evidence }
}

function resolveRow(
  item: { label: string; source: KeyInfoSource },
  clauses: ContractClause[],
  facts: FactSet,
): KeyInfoRow {
  const { label, source } = item

  if (source.kind === 'wageStructure') {
    const parts = WAGE_STRUCTURE_KEYS.flatMap((key) => {
      const value = facts[key].value
      return value === null ? [] : [`${FACT_META[key].label}${value}元`]
    })
    if (parts.length > 0) return { label, value: parts.join(' + '), status: 'VALUE', evidence: null }
    return mentionRow(label, clauses, ['工资结构', '工资构成', '工资组成', '基本工资', '绩效工资', '奖金'])
  }

  const fact = facts[source.factKey]
  const meta = FACT_META[source.factKey]
  if (fact.value !== null) {
    return { label, value: `${fact.value}${meta.unit}`, status: 'VALUE', evidence: fact.evidence?.text ?? null }
  }
  if (fact.textValue !== null) {
    return { label, value: fact.textValue, status: 'TEXT', evidence: fact.evidence?.text ?? null }
  }
  return mentionRow(label, clauses, source.mention)
}

/** 解析关键信息表：每一项都取真值，取不到值则退回到"有没有提及"并附原文。 */
export function resolveKeyInfo(clauses: ContractClause[], facts: FactSet): KeyInfoRow[] {
  return KEY_INFO_ITEMS.map((item) => resolveRow(item, clauses, facts))
}

function describeRow(row: KeyInfoRow): string {
  if (row.status === 'VALUE' || row.status === 'TEXT') return row.value ?? '—'
  if (row.status === 'MENTIONED') {
    return row.evidence === null
      ? '有相关约定，但本工具没能识别出具体内容'
      : `有相关约定，但本工具没能识别出具体内容，请自行核对；原文：${row.evidence}`
  }
  return '合同未提及'
}

function buildSummary(
  title: string,
  labels: string[],
  categories: string[],
  keyInfo: KeyInfoRow[],
  risks: ReportRisk[],
): ReportSummary {
  const lines = keyInfo.filter((row) => labels.includes(row.label)).map((row) => `${row.label}：${describeRow(row)}`)

  const related = risks.filter((risk) => categories.includes(risk.category))
  if (related.length === 0) {
    lines.push('本主题下未命中风险规则')
  } else {
    for (const risk of related) lines.push(`风险：${risk.title}（${LEVEL_LABELS[risk.level]}）`)
  }
  return { title, lines }
}

export type ReportInput = {
  template: ContractTemplate
  contractClauses: ContractClause[]
  facts: FactSet
  ruleResult: RuleEngineResult
  ruleSetVersion: string
}

/** 把风险项、无法判定项、关键信息组装成一份可展示的报告。 */
export function buildReport(input: ReportInput): ContractReport {
  const { template, contractClauses, facts, ruleResult } = input
  const risks: ReportRisk[] = [...ruleResult.findings].sort(
    (a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.ruleCode.localeCompare(b.ruleCode),
  )
  const undetermined = [...ruleResult.undetermined]

  const counts = {
    red: risks.filter((risk) => risk.level === 'red').length,
    yellow: risks.filter((risk) => risk.level === 'yellow').length,
    blue: risks.filter((risk) => risk.level === 'blue').length,
  }

  const keyInfo = resolveKeyInfo(contractClauses, facts)

  return {
    template: {
      id: template.templateId,
      name: template.name,
      regionName: template.regionName,
      regionCode: template.regionCode,
    },
    counts,
    risks,
    undetermined,
    keyInfo,
    summaries: [
      buildSummary(
        '工资信息',
        ['约定月工资', '试用期工资', '工资结构', '基本工资', '绩效工资', '奖金', '发薪日期'],
        ['工资'],
        keyInfo,
        risks,
      ),
      buildSummary('工时信息', ['每日工作时间', '加班规则', '年休假'], ['工时与加班'], keyInfo, risks),
      buildSummary('社保福利', ['五险一金'], ['社会保险'], keyInfo, risks),
    ],
    disclaimers: [...DISCLAIMERS],
    versions: {
      ruleSetVersion: input.ruleSetVersion,
      templateVersion: `${template.templateId}（${template.provenance.source.publishDate} 发布）`,
      generatedAt: new Date().toISOString(),
    },
  }
}
