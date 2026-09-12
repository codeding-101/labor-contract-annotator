import type { ContractClause } from './diff-template.ts'
import type { RiskLevel, RiskRule } from './schema.ts'

/** 报告里要展示的法条原文。一律从法条库按 ID 取，规则里不复制条文。 */
export type StatuteRef = {
  id: string
  lawName: string
  articleLabel: string
  text: string
}

export type StatuteLookup = (id: string) => StatuteRef | null

export type RiskEvidence = {
  /** 命中的条款标签；整份合同层面命中（如缺少必备条款）时为 null。 */
  clauseLabel: string | null
  text: string
}

export type RiskFinding = {
  ruleCode: string
  level: RiskLevel
  title: string
  category: string
  explanation: string
  suggestion: string
  statutes: StatuteRef[]
  evidence: RiskEvidence
  /** 命中但需要人工确认时给出提示，例如条款本身是否定表述。 */
  note?: string
}

export type RuleEngineResult = {
  findings: RiskFinding[]
  /** 遇到引擎尚未实现的判定方式时记录在这里，绝不静默跳过。 */
  unsupported: string[]
}

/**
 * 否定表述词。
 *
 * 含这些词的条款更可能是"重申法律要求"而不是"约定违法内容"，例如"甲方不得扣押乙方证件"。
 * 但同样是这些词，也可能出现在真正的违法条款里（"乙方不得提前离职，否则支付违约金"）。
 * 按"漏报比误报严重"的取舍，这里**不抑制命中**，只加一条提示让人工确认。
 */
const NEGATION_MARKERS = ['不得', '禁止', '严禁', '无权', '不准']

function negationNote(text: string): string | undefined {
  return NEGATION_MARKERS.some((marker) => text.includes(marker))
    ? '该条款含否定表述，请确认是否确实约定了该项内容'
    : undefined
}

function matchesPattern(text: string, params: { include: string[]; exclude?: string[] }): boolean {
  if (!params.include.some((keyword) => text.includes(keyword))) return false
  // 同一条款里出现例外情形就不算命中：例如"违反竞业限制约定应支付违约金"是法定允许的。
  return !(params.exclude ?? []).some((keyword) => text.includes(keyword))
}

/**
 * 在合同条款上跑规则库，产出风险项。
 *
 * 设计要点：
 * - 只做确定性判定，能解释、能写单测、零推理成本。
 * - 法条原文由 lookup 从法条库取，规则只给 ID；取不到就抛错，不放过没有依据的风险项。
 * - 尚未实现的判定方式记进 unsupported 并继续，不静默跳过。
 */
export function evaluateRules(
  rules: RiskRule[],
  clauses: ContractClause[],
  lookup: StatuteLookup,
): RuleEngineResult {
  const findings: RiskFinding[] = []
  const unsupported: string[] = []

  for (const rule of rules) {
    if (!rule.enabled) continue

    let evidence: RiskEvidence | null = null

    if (rule.checkType === 'PATTERN_MATCH') {
      for (const clause of clauses) {
        if (matchesPattern(clause.text, rule.params)) {
          evidence = { clauseLabel: clause.label, text: clause.text }
          break
        }
      }
    } else if (rule.checkType === 'EXISTENCE') {
      const hit = clauses.find((clause) => rule.params.keywords.some((keyword) => clause.text.includes(keyword)))
      if (rule.params.mode === 'MISSING_ANY' && hit === undefined) {
        evidence = { clauseLabel: null, text: '合同中未找到相关条款' }
      } else if (rule.params.mode === 'PRESENT_ANY' && hit !== undefined) {
        evidence = { clauseLabel: hit.label, text: hit.text }
      }
    } else {
      unsupported.push(`${rule.code}：判定方式 ${rule.checkType} 尚未实现`)
      continue
    }

    if (evidence === null) continue

    const statutes: StatuteRef[] = []
    for (const id of rule.statuteRefs) {
      const statute = lookup(id)
      if (statute === null) {
        throw new Error(`规则 ${rule.code} 引用了法条库里不存在的 ID：${id}`)
      }
      statutes.push(statute)
    }

    findings.push({
      ruleCode: rule.code,
      level: rule.level,
      title: rule.title,
      category: rule.category,
      explanation: rule.explanation,
      suggestion: rule.suggestion,
      statutes,
      evidence,
      note: negationNote(evidence.text),
    })
  }

  return { findings, unsupported }
}
