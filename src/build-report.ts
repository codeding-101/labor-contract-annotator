import type { ContractClause, DiffKind, DiffResult } from './diff-template.ts'
import { FACT_META, type FactKey, type FactSet } from './extract-facts.ts'
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

export type ReportDiffItem = {
  kind: DiffKind
  sectionTitle: string | null
  templateLabel: string | null
  contractLabel: string | null
  templateText: string | null
  contractText: string | null
}

/**
 * 关键信息的三种取值状态。
 * `NOT_FOUND`（合同没写）本身就是一条提示——设计里明确要求把"未约定"的项标出来；
 * `UNRECOGNIZED`（写了但本工具没认出来）必须与"没写"区分开，否则会误导。
 */
export type KeyInfoStatus = 'VALUE' | 'MENTIONED' | 'NOT_FOUND' | 'UNRECOGNIZED'

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
  diffs: { counts: Record<DiffKind, number>; items: ReportDiffItem[] }
  keyInfo: KeyInfoRow[]
  summaries: ReportSummary[]
  disclaimers: string[]
  versions: { ruleSetVersion: string; templateVersion: string; generatedAt: string }
}

const LEVEL_LABELS: Readonly<Record<RiskLevel, string>> = { red: '严重', yellow: '需关注', blue: '提示' }

const LEVEL_ORDER: Readonly<Record<RiskLevel, number>> = { red: 0, yellow: 1, blue: 2 }

type KeyInfoSource =
  | { kind: 'fact'; factKey: FactKey }
  | { kind: 'keyword'; keywords: string[] }

/**
 * 劳动者最关心的关键信息。
 * - 有对应事实的用抽取出来的值（并给出原文片段）；
 * - 没有事实键的，只能判断"合同有没有提及"——**这不等同于核对了内容**，
 *   报告里的措辞必须体现这个差别，不能让人以为已经查过了。
 */
const KEY_INFO_ITEMS: readonly { label: string; source: KeyInfoSource }[] = [
  { label: '合同期限', source: { kind: 'fact', factKey: 'contractTermMonths' } },
  { label: '试用期', source: { kind: 'fact', factKey: 'probationMonths' } },
  { label: '约定月工资', source: { kind: 'fact', factKey: 'monthlyWage' } },
  { label: '试用期工资', source: { kind: 'fact', factKey: 'probationMonthlyWage' } },
  { label: '竞业限制期限', source: { kind: 'fact', factKey: 'nonCompeteMonths' } },
  { label: '工资结构', source: { kind: 'keyword', keywords: ['工资结构', '基本工资', '绩效工资', '奖金'] } },
  { label: '基本工资', source: { kind: 'keyword', keywords: ['基本工资'] } },
  { label: '绩效工资', source: { kind: 'keyword', keywords: ['绩效'] } },
  { label: '奖金', source: { kind: 'keyword', keywords: ['奖金'] } },
  {
    label: '发薪日期',
    // 关键词表要覆盖真实写法。实测被一句「工资支付方式：甲方于每月15日…发放上月工资」打穿过：
    // 原表只有「发薪/支付日期/发放日期」，这句一个都不含，于是误报「合同未提及」。
    source: {
      kind: 'keyword',
      keywords: ['发薪', '发放日', '支付日期', '发放日期', '支付方式', '发放方式', '工资发放', '工资支付', '发放工资', '支付工资'],
    },
  },
  { label: '工作时间', source: { kind: 'keyword', keywords: ['工作时间', '工时'] } },
  { label: '加班规则', source: { kind: 'keyword', keywords: ['加班'] } },
  { label: '休假制度', source: { kind: 'keyword', keywords: ['休假', '年休假', '请假'] } },
  { label: '五险一金', source: { kind: 'keyword', keywords: ['社会保险', '社保', '住房公积金'] } },
  { label: '工作地点', source: { kind: 'keyword', keywords: ['工作地点'] } },
  { label: '违约责任', source: { kind: 'keyword', keywords: ['违约金', '违约责任'] } },
  { label: '保密协议', source: { kind: 'keyword', keywords: ['保密'] } },
]

const DISCLAIMERS: readonly string[] = [
  '本报告由工具自动生成，仅供参考，不构成法律意见，也不能替代执业律师。',
  '本工具只做事实比对与条文引用：把条款标出来并附上法律依据，不做综合评价，也不替你决定签还是不签。',
  '不同地区的规定存在差异，最终请以当地劳动保障部门、工会或执业律师的意见为准。',
  '合同中出现但本工具未覆盖的事项，不在本报告的检查范围内。',
]

function firstClauseWith(clauses: ContractClause[], keywords: string[]): ContractClause | null {
  for (const clause of clauses) {
    if (keywords.some((keyword) => clause.text.includes(keyword))) return clause
  }
  return null
}

/** 解析关键信息表。事实类给出数值，关键词类只判断有没有提及。 */
export function resolveKeyInfo(clauses: ContractClause[], facts: FactSet): KeyInfoRow[] {
  return KEY_INFO_ITEMS.map((item) => {
    if (item.source.kind === 'fact') {
      const fact = facts[item.source.factKey]
      const meta = FACT_META[item.source.factKey]
      if (fact === undefined) {
        return { label: item.label, value: null, status: 'UNRECOGNIZED' as const, evidence: null }
      }
      if (fact.value === null) {
        return {
          label: item.label,
          value: null,
          status: fact.method === 'UNRECOGNIZED' && /未约定|未找到/.test(fact.reason ?? '') ? ('NOT_FOUND' as const) : ('UNRECOGNIZED' as const),
          evidence: fact.evidence?.text ?? null,
        }
      }
      return {
        label: item.label,
        value: `${fact.value}${meta.unit}`,
        status: 'VALUE' as const,
        evidence: fact.evidence?.text ?? null,
      }
    }

    const hit = firstClauseWith(clauses, item.source.keywords)
    return hit === null
      ? { label: item.label, value: null, status: 'NOT_FOUND' as const, evidence: null }
      : { label: item.label, value: '合同中有提及', status: 'MENTIONED' as const, evidence: hit.text.slice(0, 120) }
  })
}

function describeRow(row: KeyInfoRow): string {
  if (row.status === 'VALUE') return row.value ?? '—'
  if (row.status === 'MENTIONED') return '合同中有提及（仅表示提到了，未核对具体内容）'
  if (row.status === 'NOT_FOUND') return '合同未提及'
  return '未能识别（写了相关内容，但本工具没认出来）'
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
  diff: DiffResult
  facts: FactSet
  ruleResult: RuleEngineResult
  ruleSetVersion: string
}

/** 把比对结果、风险项、无法判定项、事实组装成一份可展示的报告。 */
export function buildReport(input: ReportInput): ContractReport {
  const { template, contractClauses, diff, facts, ruleResult } = input
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
    diffs: {
      counts: diff.counts,
      items: diff.items.map((item) => ({
        kind: item.kind,
        sectionTitle: item.sectionTitle,
        templateLabel: item.templateLabel,
        contractLabel: item.contractLabel,
        templateText: item.templateText,
        contractText: item.contractText,
      })),
    },
    keyInfo,
    summaries: [
      buildSummary(
        '工资信息',
        ['约定月工资', '试用期工资', '工资结构', '基本工资', '绩效工资', '奖金', '发薪日期'],
        ['工资'],
        keyInfo,
        risks,
      ),
      buildSummary('工时信息', ['工作时间', '加班规则', '休假制度'], ['工时与加班'], keyInfo, risks),
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
