import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { ContractClause } from '../src/diff-template.ts'
import { extractFacts, type FactKey } from '../src/extract-facts.ts'
import { evaluateRules, type StatuteLookup } from '../src/rule-engine.ts'
import { RiskRuleSetSchema, type RiskRule } from '../src/schema.ts'

const RULES_FILE = join(import.meta.dirname, '..', 'rules', 'labor-contract-law.json')
const ruleSet = RiskRuleSetSchema.parse(JSON.parse(readFileSync(RULES_FILE, 'utf8')))

const lookup: StatuteLookup = (id) => ({ id, lawName: '测试法', articleLabel: id, text: `条文原文 ${id}` })

function clausesOf(text: string | undefined, texts: string[] | undefined): ContractClause[] {
  const all = [...(text === undefined ? [] : [text]), ...(texts ?? [])]
  return all.map((value, index) => ({ sectionTitle: null, articleNo: null, label: `条款${index + 1}`, text: value }))
}

/**
 * 用例的评法：条款 → 抽事实 → 跑规则。
 * 用例若直接给了 facts，则用它覆盖抽取结果——这样可以只测比较逻辑，
 * 而不用为了造出某个数值去编一段合同文本。
 */
function runCase(rule: RiskRule, ruleCase: (typeof ruleSet.rules)[number]['cases'][number]) {
  const clauses = clausesOf(ruleCase.text, ruleCase.texts)
  const facts = { ...extractFacts(clauses) }
  for (const [key, value] of Object.entries(ruleCase.facts ?? {})) {
    const factKey = key as FactKey
    facts[factKey] = { key: factKey, value, textValue: null, unit: null, evidence: null, method: 'EXPLICIT' }
  }
  return evaluateRules([rule], clauses, lookup, facts)
}

function ruleByCode(code: string): RiskRule {
  const rule = ruleSet.rules.find((candidate) => candidate.code === code)
  assert.ok(rule !== undefined, `规则库里找不到 ${code}`)
  return rule
}

test('每条规则自带的正反例都能判对', () => {
  let checked = 0
  for (const rule of ruleSet.rules) {
    for (const ruleCase of rule.cases) {
      const result = runCase(rule, ruleCase)
      const fired = result.findings.some((finding) => finding.ruleCode === rule.code)
      const undetermined = result.undetermined.some((item) => item.ruleCode === rule.code)
      const actual = fired ? 'VIOLATION' : undetermined ? 'UNDETERMINED' : 'OK'
      assert.equal(
        actual,
        ruleCase.expect,
        `规则 ${rule.code} 期望 ${ruleCase.expect}、实际 ${actual}${ruleCase.note === undefined ? '' : `（${ruleCase.note}）`}`,
      )
      checked += 1
    }
  }
  assert.ok(checked >= 20, `用例太少，只跑了 ${checked} 条`)
})

test('合同明确不约定某项时，规则不适用：既不报违规，也不列进"无法判定"', () => {
  // 「竞业限制期限超过两年：合同明确不约定竞业限制义务」这种并列是自相矛盾的，
  // 会让人以为工具漏查了——实际是这一项根本不存在，规则不适用
  const clauses = clausesOf('本岗位不属于企业高管、核心技术及涉密岗位，不约定离职后竞业限制义务。', undefined)
  const result = evaluateRules([ruleByCode('NON_COMPETE_TOO_LONG')], clauses, lookup, extractFacts(clauses))

  assert.equal(result.findings.length, 0)
  assert.equal(result.undetermined.length, 0)
})

test('写了竞业限制但没给期限时，仍然如实报"无法判定"', () => {
  // 与上一条的差别要守住：含糊不清是"无法判定"，明确不约定才是"不适用"
  const clauses = clausesOf('乙方离职后应遵守竞业限制义务，具体期限另行协商。', undefined)
  const result = evaluateRules([ruleByCode('NON_COMPETE_TOO_LONG')], clauses, lookup, extractFacts(clauses))

  assert.equal(result.findings.length, 0)
  assert.equal(result.undetermined.length, 1)
  assert.equal(result.undetermined[0]?.ruleCode, 'NON_COMPETE_TOO_LONG')
})

test('合同期限不确定时仍报"无法判定"，不能当成"不适用"放过去', () => {
  // 分档上限算不出来是真的无法判定；只有规则的主体事项本身"明确不约定"才叫不适用
  const clauses = clausesOf('合同期限：自2026年7月1日起至2027年7月1日止；续订期：自2027年7月1日起至2028年7月1日止。试用期六个月。', undefined)
  const result = evaluateRules([ruleByCode('PROBATION_TOO_LONG')], clauses, lookup, extractFacts(clauses))

  assert.equal(result.findings.length, 0)
  assert.equal(result.undetermined.length, 1)
})

test('风险项里的法条原文来自 lookup，规则里不复制条文', () => {
  const rule = ruleByCode('UNLAWFUL_LIQUIDATED_DAMAGES')
  const result = runCase(rule, {
    text: '乙方在合同期内提前离职的，应当向甲方支付违约金人民币三万元。',
    expect: 'VIOLATION',
  })
  const finding = result.findings[0]
  assert.ok(finding !== undefined)
  assert.deepEqual(
    finding.statutes.map((statute) => statute.text),
    rule.statuteRefs.map((id) => `条文原文 ${id}`),
  )
})

test('法条 ID 取不到时抛错，不放过没有依据的风险项', () => {
  const rule = ruleByCode('UNLAWFUL_LIQUIDATED_DAMAGES')
  assert.throws(
    () => evaluateRules([rule], clausesOf('乙方提前离职应支付违约金三万元。', undefined), () => null),
    /引用了法条库里不存在的 ID/,
  )
})

test('含否定表述的命中不被抑制，但带人工确认提示', () => {
  // 取舍：漏报比误报严重。含「不得」的条款也可能是真违法条款
  //（如"乙方不得提前离职，否则支付违约金"），所以报出来加提示，而不是用否定词直接放过。
  const rule = ruleByCode('DETAIN_ID_OR_COLLECT_FEES')
  const result = runCase(rule, { text: '甲方不得扣押乙方居民身份证。', expect: 'VIOLATION' })
  const finding = result.findings[0]
  assert.ok(finding !== undefined, '不应抑制命中')
  assert.match(finding.note ?? '', /否定表述/)
})

test('抽不到事实时产出 undetermined，既不算合规也不算违规', () => {  const rule = ruleByCode('PROBATION_TOO_LONG')
  // 合同里只写了试用期，没写合同期限 → 分档比较缺一个输入
  const result = runCase(rule, { text: '双方约定试用期三个月。', expect: 'UNDETERMINED' })
  assert.equal(result.findings.length, 0, '不应当判成违规')
  const item = result.undetermined[0]
  assert.ok(item !== undefined)
  assert.match(item.reason, /合同期限/)
})

test('数值判定走完整链路：从条款抽事实再判定', () => {
  const clauses = clausesOf(undefined, [
    '本合同为固定期限劳动合同，合同期限三年，自2026年7月1日起至2029年7月1日止。',
    '双方约定试用期六个月。',
  ])
  const facts = extractFacts(clauses)
  assert.equal(facts.contractTermMonths.value, 36)
  assert.equal(facts.probationMonths.value, 6)

  // 36 个月 → 法定上限 6 个月，正好 6 个月不超期
  const ok = evaluateRules([ruleByCode('PROBATION_TOO_LONG')], clauses, lookup, facts)
  assert.equal(ok.findings.length, 0)

  // 同样条款下试用期写 9 个月 → 超期，且说明里要写出上下限依据
  const longer = clausesOf(undefined, [
    '本合同为固定期限劳动合同，合同期限三年，自2026年7月1日起至2029年7月1日止。',
    '双方约定试用期九个月。',
  ])
  const violation = evaluateRules([ruleByCode('PROBATION_TOO_LONG')], longer, lookup, extractFacts(longer))
  const finding = violation.findings[0]
  assert.ok(finding !== undefined)
  assert.match(finding.note ?? '', /法定上限 6/)
  assert.match(finding.note ?? '', /实际约定 9/)
})

test('停用的规则不参与判定', () => {
  const disabled: RiskRule = { ...ruleByCode('UNLAWFUL_LIQUIDATED_DAMAGES'), enabled: false }
  const result = runCase(disabled, { text: '乙方提前离职应支付违约金三万元。', expect: 'OK' })
  assert.equal(result.findings.length, 0)
})
