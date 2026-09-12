import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { ContractClause } from '../src/diff-template.ts'
import { evaluateRules, type StatuteLookup } from '../src/rule-engine.ts'
import { RiskRuleSchema, RiskRuleSetSchema } from '../src/schema.ts'

const RULES_FILE = join(import.meta.dirname, '..', 'rules', 'labor-contract-law.json')
const ruleSet = RiskRuleSetSchema.parse(JSON.parse(readFileSync(RULES_FILE, 'utf8')))

const lookup: StatuteLookup = (id) => ({ id, lawName: '测试法', articleLabel: id, text: `条文原文 ${id}` })

function clauseFrom(text: string): ContractClause[] {
  return [{ sectionTitle: null, articleNo: null, label: '测试条款', text }]
}

test('每条规则自带的正反例都能判对', () => {
  let checked = 0
  for (const rule of ruleSet.rules) {
    for (const ruleCase of rule.cases) {
      const { findings } = evaluateRules([rule], clauseFrom(ruleCase.text), lookup)
      const fired = findings.some((finding) => finding.ruleCode === rule.code)
      assert.equal(
        fired,
        ruleCase.expect === 'VIOLATION',
        `规则 ${rule.code} 期望 ${ruleCase.expect}，实际${fired ? '命中' : '未命中'} —— ${ruleCase.text}`,
      )
      checked += 1
    }
  }
  assert.ok(checked >= 12, `用例太少，只跑了 ${checked} 条`)
})

test('风险项里的法条原文来自 lookup，规则里不复制条文', () => {
  const rule = ruleSet.rules[0]
  assert.ok(rule !== undefined)
  const { findings } = evaluateRules([rule], clauseFrom('乙方提前离职应支付违约金三万元。'), lookup)
  const finding = findings[0]
  assert.ok(finding !== undefined)
  assert.deepEqual(
    finding.statutes.map((statute) => statute.text),
    rule.statuteRefs.map((id) => `条文原文 ${id}`),
  )
})

test('法条 ID 取不到时抛错，不放过没有依据的风险项', () => {
  const rule = ruleSet.rules[0]
  assert.ok(rule !== undefined)
  assert.throws(
    () => evaluateRules([rule], clauseFrom('乙方提前离职应支付违约金三万元。'), () => null),
    /引用了法条库里不存在的 ID/,
  )
})

test('含否定表述的命中不被抑制，但带人工确认提示', () => {
  // 取舍：漏报比误报严重。含「不得」的条款也可能是真违法条款
  //（如"乙方不得提前离职，否则支付违约金"），所以报出来加提示，而不是用否定词直接放过。
  const rule = ruleSet.rules.find((candidate) => candidate.code === 'DETAIN_ID_OR_COLLECT_FEES')
  assert.ok(rule !== undefined)
  const { findings } = evaluateRules([rule], clauseFrom('甲方不得扣押乙方居民身份证。'), lookup)
  const finding = findings[0]
  assert.ok(finding !== undefined, '不应抑制命中')
  assert.match(finding.note ?? '', /否定表述/)
})

test('尚未实现的判定方式记进 unsupported，不静默跳过', () => {
  const numericRule = RiskRuleSchema.parse({
    code: 'PROBATION_TOO_LONG',
    title: '试用期超过法定期限',
    level: 'red',
    category: '试用期',
    checkType: 'NUMERIC_COMPARE',
    params: { field: 'probationMonths', operator: '>', value: 6 },
    statuteRefs: ['LCL-19'],
    explanation: '试用期长度受劳动合同期限约束。',
    suggestion: '要求缩短试用期。',
    enabled: true,
    cases: [
      { text: '试用期六个月', expect: 'VIOLATION' },
      { text: '试用期三个月', expect: 'OK' },
    ],
  })

  const { findings, unsupported } = evaluateRules([numericRule], clauseFrom('试用期六个月。'), lookup)
  assert.equal(findings.length, 0)
  assert.match(unsupported[0] ?? '', /NUMERIC_COMPARE/)
})

test('停用的规则不参与判定', () => {
  const disabled = RiskRuleSchema.parse({
    code: 'DISABLED_SAMPLE',
    title: '停用的示例规则',
    level: 'blue',
    category: '示例',
    checkType: 'PATTERN_MATCH',
    params: { include: ['违约金'] },
    statuteRefs: ['LCL-25'],
    explanation: '仅用于测试停用行为。',
    suggestion: '这条规则用于测试停用规则不参与判定，无需给出建议。',
    enabled: false,
    cases: [
      { text: '应当支付违约金', expect: 'VIOLATION' },
      { text: '无需支付违约金', expect: 'VIOLATION' },
    ],
  })

  const { findings } = evaluateRules([disabled], clauseFrom('乙方提前离职应支付违约金三万元。'), lookup)
  assert.equal(findings.length, 0)
})
