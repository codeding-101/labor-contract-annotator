import type { ContractClause } from './diff-template.ts'
import { FACT_META, type Fact, type FactKey } from './extract-facts.ts'
import type { ComparisonOperator, RiskLevel, RiskRule } from './schema.ts'

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
  /** 命中的依据说明，例如"合同期限 36 个月 → 法定上限 6 个月；实际约定 9 个月"。 */
  note?: string
}

/**
 * 抽不到事实时的结果：既不是违规，也不是合规。
 * 注意与"合同明确写了本项不约定"区分开——后者规则**不适用**，不进这个列表。
 */
export type UndeterminedItem = {
  ruleCode: string
  title: string
  level: RiskLevel
  reason: string
}

export type RuleEngineResult = {
  findings: RiskFinding[]
  undetermined: UndeterminedItem[]
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

/**
 * 合同是否**明确写了本项不约定**。
 *
 * 这种情形下规则不适用：既不该报违规，也不该列进"无法判定"——
 * 「竞业限制期限超过两年：合同明确不约定竞业限制义务」这种写法自相矛盾，
 * 会让人以为工具漏查了，实际是这一项根本不存在。
 *
 * 只看规则的主体事项（`field`）：例如"合同期限不确定"只说明分档上限算不出来，
 * 那是真的无法判定，不能当成"不适用"放过去。
 */
function explicitlyNotAgreed(facts: Partial<Record<FactKey, Fact>>, key: FactKey): boolean {
  return facts[key]?.method === 'NOT_AGREED'
}

function matchesPattern(
  text: string,
  params: { include: string[]; about?: string[]; exclude?: string[] },
): boolean {
  // about 表达"这一条是关于 X 的"：例如校验"约定不缴社保"时要求条款里出现「社会保险」或「社保」，
  // 否则「不为…缴纳社会保险费」这类中间插了名字的写法会漏掉。
  const about = params.about
  if (about !== undefined && !about.some((keyword) => text.includes(keyword))) return false
  if (!params.include.some((keyword) => text.includes(keyword))) return false
  // 同一条款里出现例外情形就不算命中：例如"违反竞业限制约定应支付违约金"是法定允许的。
  return !(params.exclude ?? []).some((keyword) => text.includes(keyword))
}

function compare(left: number, operator: ComparisonOperator, right: number): boolean {
  if (operator === '<') return left < right
  if (operator === '<=') return left <= right
  if (operator === '>') return left > right
  if (operator === '>=') return left >= right
  if (operator === '==') return left === right
  return left !== right
}

function describe(facts: Record<FactKey, Fact> | Partial<Record<FactKey, Fact>>, key: FactKey): string {
  const fact = facts[key]
  const meta = FACT_META[key]
  if (fact === undefined || fact.value === null) return `${meta.label} 未识别`
  return `${meta.label} ${fact.value}${meta.unit}`
}

function evidenceFromFact(fact: Fact, fallback: string): RiskEvidence {
  if (fact.evidence !== null) return fact.evidence
  return { clauseLabel: null, text: fallback }
}

/**
 * 在合同条款上跑规则库，产出风险项与"无法判定"项。
 *
 * 设计要点：
 * - 只做确定性判定，能解释、能写单测、零推理成本。
 * - 法条原文由 lookup 从法条库取，规则只给 ID；取不到就抛错，不放过没有依据的风险项。
 * - **抽不到事实时产出 undetermined，不当作合规也不当作违规**——这条是抽取值不出错的前提。
 * - **合同明确写了"本项不约定"时规则不适用**（例如"不约定竞业限制义务"），此时既不报违规、
 *   也不列进 undetermined：把确定的事说成"无法判定"是另一种误导。
 * - 判定方式由 TypeScript 穷尽性检查兜底：新增 checkType 时这里会直接编译失败，不会静默漏掉。
 */
export function evaluateRules(
  rules: RiskRule[],
  clauses: ContractClause[],
  lookup: StatuteLookup,
  facts: Partial<Record<FactKey, Fact>> = {},
): RuleEngineResult {
  const findings: RiskFinding[] = []
  const undetermined: UndeterminedItem[] = []

  for (const rule of rules) {
    if (!rule.enabled) continue

    let evidence: RiskEvidence | null = null
    let note: string | undefined

    if (rule.checkType === 'PATTERN_MATCH') {
      for (const clause of clauses) {
        if (matchesPattern(clause.text, rule.params)) {
          evidence = { clauseLabel: clause.label, text: clause.text }
          break
        }
      }
      if (evidence !== null) note = negationNote(evidence.text)
    } else if (rule.checkType === 'EXISTENCE') {
      const hit = clauses.find((clause) => rule.params.keywords.some((keyword) => clause.text.includes(keyword)))
      if (rule.params.mode === 'MISSING_ANY' && hit === undefined) {
        evidence = { clauseLabel: null, text: '合同中未找到相关条款' }
      } else if (rule.params.mode === 'PRESENT_ANY' && hit !== undefined) {
        evidence = { clauseLabel: hit.label, text: hit.text }
        note = negationNote(hit.text)
      }
    } else if (rule.checkType === 'NUMERIC_COMPARE') {
      const fact = facts[rule.params.field]
      if (fact === undefined || fact.value === null) {
        if (explicitlyNotAgreed(facts, rule.params.field)) continue
        undetermined.push({
          ruleCode: rule.code,
          title: rule.title,
          level: rule.level,
          reason: fact?.reason ?? `${FACT_META[rule.params.field].label}未识别`,
        })
        continue
      }
      if (compare(fact.value, rule.params.operator, rule.params.value)) {
        evidence = evidenceFromFact(fact, describe(facts, rule.params.field))
        note = `实际${describe(facts, rule.params.field)}，判定线为 ${rule.params.operator} ${rule.params.value}`
      }
    } else if (rule.checkType === 'RATIO_COMPARE') {
      const measured = facts[rule.params.field]
      const base = facts[rule.params.ratioOf]
      if (measured === undefined || measured.value === null || base === undefined || base.value === null) {
        if (explicitlyNotAgreed(facts, rule.params.field)) continue
        undetermined.push({
          ruleCode: rule.code,
          title: rule.title,
          level: rule.level,
          reason:
            measured?.reason ??
            base?.reason ??
            `缺少${FACT_META[rule.params.field].label}或${FACT_META[rule.params.ratioOf].label}`,
        })
        continue
      }
      const threshold = base.value * rule.params.ratio
      if (compare(measured.value, rule.params.operator, threshold)) {
        evidence = evidenceFromFact(measured, describe(facts, rule.params.field))
        note = `${describe(facts, rule.params.ratioOf)} × ${rule.params.ratio} = ${threshold.toFixed(2)}${FACT_META[rule.params.field].unit}，实际${describe(facts, rule.params.field)}`
      }
    } else if (rule.checkType === 'TIERED_COMPARE') {
      const measured = facts[rule.params.field]
      const depender = facts[rule.params.dependsOn]
      if (measured === undefined || measured.value === null || depender === undefined || depender.value === null) {
        if (explicitlyNotAgreed(facts, rule.params.field)) continue
        undetermined.push({
          ruleCode: rule.code,
          title: rule.title,
          level: rule.level,
          reason:
            measured?.reason ??
            depender?.reason ??
            `缺少${FACT_META[rule.params.field].label}或${FACT_META[rule.params.dependsOn].label}`,
        })
        continue
      }
      const dependerValue = depender.value
      const step = rule.params.steps.find((candidate) => dependerValue >= candidate.whenAtLeast)
      if (step === undefined) {
        undetermined.push({
          ruleCode: rule.code,
          title: rule.title,
          level: rule.level,
          reason: `${describe(facts, rule.params.dependsOn)} 低于分档表的最小档，分档表可能不完整`,
        })
        continue
      }
      if (compare(measured.value, rule.params.operator, step.limit)) {
        evidence = evidenceFromFact(measured, describe(facts, rule.params.field))
        note = `${describe(facts, rule.params.dependsOn)} → 法定上限 ${step.limit}${FACT_META[rule.params.field].unit}；实际约定 ${measured.value}${FACT_META[rule.params.field].unit}`
      }
    } else {
      // 穷尽性检查：manifest 里新增判定方式时，这一行会直接编译失败，逼你实现它。
      const exhaustive: never = rule
      throw new Error(`判定方式未实现：${JSON.stringify(exhaustive)}`)
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
      ...(note === undefined ? {} : { note }),
    })
  }

  return { findings, undetermined }
}
