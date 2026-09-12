import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildReport, resolveKeyInfo } from '../src/build-report.ts'
import type { ContractClause } from '../src/diff-template.ts'
import { extractFacts } from '../src/extract-facts.ts'
import type { RiskFinding, UndeterminedItem } from '../src/rule-engine.ts'
import { CAPPED_SCORE, RISK_LEVEL_PENALTY, scoreFindings } from '../src/score.ts'
import { ContractTemplateSchema, type ContractTemplate, type RiskLevel } from '../src/schema.ts'

/** 用于报告层测试的最小范本，走 schema 校验以保证字段齐全。 */
const TEMPLATE: ContractTemplate = ContractTemplateSchema.parse({
  templateId: 'test-template',
  name: '测试范本',
  regionCode: '000000',
  regionName: '测试地区',
  frontMatter: [],
  notes: [],
  sections: [
    {
      sectionNo: '一',
      sectionTitle: '总则',
      articles: [{ articleNo: 1, articleLabel: '第一条', text: '本合同自用工之日起生效。' }],
    },
  ],
  trailing: [],
  provenance: {
    generatedAt: '2026-09-12T00:00:00.000Z',
    generator: 'test',
    source: {
      name: '测试范本',
      regionCode: '000000',
      regionName: '测试地区',
      version: '1',
      format: 'html',
      file: 'test.html',
      url: 'https://example.com/test.html',
      publisher: '测试发布方',
      publisherVerified: false,
      publishDate: '2026-01-01',
      retrievedAt: '2026-09-12',
      sha256: '0'.repeat(64),
      issues: [],
    },
    sectionCount: 1,
    articleCount: 1,
    fillMarker: '{{FILL}}',
  },
})

function finding(level: RiskLevel, ruleCode = `TEST_${level.toUpperCase()}`): RiskFinding {
  return {
    ruleCode,
    level,
    title: `${level} 级测试风险`,
    category: '测试',
    explanation: '说明',
    suggestion: '建议',
    statutes: [{ id: 'LCL-26', lawName: '中华人民共和国劳动合同法', articleLabel: '第二十六条', text: '条文原文' }],
    evidence: { clauseLabel: '第一条', text: '合同原文' },
  }
}

function undetermined(ruleCode: string): UndeterminedItem {
  return { ruleCode, title: `${ruleCode} 无法判定`, level: 'red', reason: '缺少可识别信息' }
}

test('按等级扣分，下限为 0', () => {
  assert.equal(RISK_LEVEL_PENALTY.red, 15)
  assert.equal(scoreFindings([], []).score, 100)
  assert.equal(scoreFindings([finding('red'), finding('yellow')], []).score, 80)
  // 扣分超过 100 时封底到 0，不出现负数
  const many = Array.from({ length: 8 }, () => finding('red'))
  assert.equal(scoreFindings(many, []).score, 0)
})

test('命中高危项时一票封顶，并说明原因', () => {
  const capped = scoreFindings([finding('red', 'WAIVE_SOCIAL_INSURANCE')], [])
  assert.equal(capped.score, CAPPED_SCORE)
  assert.equal(capped.capped, true)
  assert.match(capped.capReason ?? '', /WAIVE_SOCIAL_INSURANCE|高危项/)
  // 普通红色风险不触发封顶
  assert.equal(scoreFindings([finding('red')], []).capped, false)
})

test('无法判定的项不计分，但必须计数并在报告里单独列出', () => {
  const score = scoreFindings([], [undetermined('PROBATION_TOO_LONG')])
  assert.equal(score.score, 100, '无法判定既不该加分也不该扣分')
  assert.equal(score.undeterminedCount, 1)
})

test('关键信息：事实项取到值，关键词项区分"有提及"与"未提及"', () => {
  const clauses: ContractClause[] = [
    { sectionTitle: null, articleNo: 1, label: '第一条', text: '乙方工作地点为北京市朝阳区。' },
    { sectionTitle: null, articleNo: 2, label: '第二条', text: '甲方按月支付工资，月工资8000元。' },
  ]
  const rows = resolveKeyInfo(clauses, extractFacts(clauses))
  const byLabel = (label: string) => rows.find((row) => row.label === label)

  assert.equal(byLabel('约定月工资')?.status, 'VALUE')
  assert.equal(byLabel('约定月工资')?.value, '8000元')
  assert.equal(byLabel('工作地点')?.status, 'MENTIONED')
  // 合同没写的项要显式标出来——"未提及"本身就是一条提示
  assert.equal(byLabel('奖金')?.status, 'NOT_FOUND')
  assert.equal(byLabel('竞业限制期限')?.status, 'NOT_FOUND')
})

test('报告带出具职声明、关键信息与三段总结', () => {
  const clauses: ContractClause[] = [
    { sectionTitle: null, articleNo: 1, label: '第一条', text: '乙方工作地点为北京市朝阳区。' },
  ]
  const report = buildReport({
    template: TEMPLATE,
    contractClauses: clauses,
    diff: { items: [], counts: { MISSING_IN_CONTRACT: 0, EXTRA_IN_CONTRACT: 0, MODIFIED: 0, BLANK_LEFT: 0 }, matchedOk: 1, templateClauseCount: 1, contractClauseCount: 1 },
    facts: extractFacts(clauses),
    ruleResult: { findings: [], undetermined: [] },
    ruleSetVersion: '0.1.0',
  })

  assert.equal(report.score.score, 100)
  assert.equal(report.counts.red, 0)
  assert.ok(report.disclaimers.some((line) => /不构成法律意见/.test(line)))
  assert.ok(report.disclaimers.some((line) => /未覆盖的事项/.test(line)))
  assert.equal(report.summaries.length, 3)
  assert.equal(report.keyInfo.length >= 16, true)
})

test('报告建议随风险变化：有严重风险 / 仅需关注 / 无命中 / 含无法判定', () => {
  const clauses: ContractClause[] = [{ sectionTitle: null, articleNo: 1, label: '第一条', text: '内容。' }]
  const diff = {
    items: [],
    counts: { MISSING_IN_CONTRACT: 0, EXTRA_IN_CONTRACT: 0, MODIFIED: 0, BLANK_LEFT: 0 },
    matchedOk: 1,
    templateClauseCount: 1,
    contractClauseCount: 1,
  }
  const base = { template: TEMPLATE, contractClauses: clauses, diff, facts: extractFacts(clauses), ruleSetVersion: '0.1.0' }

  const hasRed = buildReport({ ...base, ruleResult: { findings: [finding('red')], undetermined: [] } })
  assert.match(hasRed.recommendation, /严重风险/)

  const hasYellow = buildReport({ ...base, ruleResult: { findings: [finding('yellow')], undetermined: [] } })
  assert.match(hasYellow.recommendation, /重点确认/)

  const clean = buildReport({ ...base, ruleResult: { findings: [], undetermined: [] } })
  assert.match(clean.recommendation, /未发现明显问题/)
  assert.match(clean.recommendation, /不代表合同没有其他风险/)

  const withUndetermined = buildReport({
    ...base,
    ruleResult: { findings: [], undetermined: [undetermined('PROBATION_TOO_LONG')] },
  })
  assert.match(withUndetermined.recommendation, /无法判断/)
})
