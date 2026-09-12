import type { RiskFinding, UndeterminedItem } from './rule-engine.ts'
import type { RiskLevel } from './schema.ts'

/** 各风险等级的扣分权重。改这里会直接改变所有报告的分数，改前先想清楚。 */
export const RISK_LEVEL_PENALTY: Readonly<Record<RiskLevel, number>> = {
  red: 15,
  yellow: 5,
  blue: 1,
}

/**
 * 一票封顶：命中这些高危项时，无论其他项多少，总分不超过 `CAPPED_SCORE`。
 * 目的是避免"一堆小问题把分数拉到很低"与"一个致命问题但因为别处干净而得高分"这两种失真。
 */
export const CAP_RULE_CODES: readonly string[] = [
  'UNLAWFUL_LIQUIDATED_DAMAGES',
  'WAIVE_SOCIAL_INSURANCE',
  'WAGE_DISPUTE_WINDOW_WAIVER',
]

export const CAPPED_SCORE = 40

export type ScoreDeduction = {
  ruleCode: string
  level: RiskLevel
  title: string
  deduction: number
}

export type RiskScore = {
  score: number
  base: number
  deductions: ScoreDeduction[]
  capped: boolean
  capReason: string | null
  /**
   * 无法判定的项数。**它们不计分**——没抽到信息不等于没问题，
   * 既不该加分也不该扣分，只能在报告里单独列出来让人自己核对。
   */
  undeterminedCount: number
}

/**
 * 依据命中的风险项算分。刻意做得完全透明：分数 = 100 − 各项扣分之和（下限 0），
 * 命中高危项时再取 40 的上限。报告里会把每一笔扣分都列出来，让人能自己核对。
 */
export function scoreFindings(findings: RiskFinding[], undetermined: UndeterminedItem[]): RiskScore {
  const deductions: ScoreDeduction[] = findings.map((finding) => ({
    ruleCode: finding.ruleCode,
    level: finding.level,
    title: finding.title,
    deduction: RISK_LEVEL_PENALTY[finding.level],
  }))

  const total = deductions.reduce((sum, item) => sum + item.deduction, 0)
  const raw = Math.max(0, 100 - total)

  const capped = findings.find((finding) => CAP_RULE_CODES.includes(finding.ruleCode))
  const score = capped === undefined ? raw : Math.min(raw, CAPPED_SCORE)

  return {
    score,
    base: 100,
    deductions,
    capped: capped !== undefined,
    capReason: capped === undefined ? null : `命中高危项「${capped.title}」，总分上限 ${CAPPED_SCORE}`,
    undeterminedCount: undetermined.length,
  }
}
