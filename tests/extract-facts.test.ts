import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ContractClause } from '../src/diff-template.ts'
import { extractFacts, pickOption } from '../src/extract-facts.ts'

function clause(text: string): ContractClause[] {
  return [{ sectionTitle: null, articleNo: null, label: '条款1', text }]
}

function clauses(texts: string[]): ContractClause[] {
  return texts.map((text, index) => ({ sectionTitle: null, articleNo: null, label: `条款${index + 1}`, text }))
}

/** 真实范本第一条的形态（填空位已按示例值填好）。 */
const TEMPLATE_CLAUSE_ONE =
  '甲乙双方自用工之日起建立劳动关系，双方约定按下列第1种方式确定劳动合同期限：' +
  '1.固定期限：自2026年7月1日起至2029年7月1日止，其中，试用期从用工之日起至2026年10月1日止。' +
  '2.无固定期限：自2026年7月1日起至依法解除、终止劳动合同时止，其中，试用期从用工之日起至2029年7月1日止。' +
  '3.以完成一定工作任务为期限：自2026年7月1日起至示例示例工作任务完成时止。'

test('多选项条款按「第 N 种」消歧，只抽被选中的那一项', () => {
  const chosen = pickOption(TEMPLATE_CLAUSE_ONE)
  assert.match(chosen, /^1\.固定期限/)
  assert.ok(!chosen.includes('无固定期限'), '不应把未选中的选项带进来')
})

test('真实范本形态：抽出合同期限 36 个月、试用期 3 个月', () => {
  const facts = extractFacts(clause(TEMPLATE_CLAUSE_ONE))

  assert.equal(facts.contractTermMonths.value, 36)
  assert.equal(facts.contractTermMonths.method, 'DATE_RANGE')

  // 试用期只给了终止日（「从用工之日起至…止」），需要用合同起始日推导
  assert.equal(facts.probationMonths.value, 3)
  assert.equal(facts.probationMonths.method, 'DERIVED')
  assert.match(facts.probationMonths.evidence?.text ?? '', /试用期/)
})

test('中文数字与显式年限都能识别', () => {
  assert.equal(extractFacts(clause('双方约定试用期六个月，合同期限三年。')).probationMonths.value, 6)
  assert.equal(extractFacts(clause('合同期限为3年。')).contractTermMonths.value, 36)
  assert.equal(extractFacts(clause('合同期限为二十四个月。')).contractTermMonths.value, 24)
})

test('工资金额支持千分位与口语写法', () => {
  assert.equal(extractFacts(clause('甲方按月支付工资，月工资8000元。')).monthlyWage.value, 8000)
  assert.equal(extractFacts(clause('月工资 12,000 元，于每月十日前支付。')).monthlyWage.value, 12000)
})

test('试用期工资取试用期条款里的金额，不误取普通工资条款', () => {
  const facts = extractFacts(
    clauses(['甲方采用按月支付方式，月工资8000元。', '乙方在试用期期间的工资计发标准为6400元。']),
  )
  assert.equal(facts.monthlyWage.value, 8000)
  assert.equal(facts.probationMonthlyWage.value, 6400)
})

test('竞业限制期限换算为月', () => {
  assert.equal(extractFacts(clause('乙方离职后三年内不得从事同类业务。竞业限制期限为三年。')).nonCompeteMonths.value, 36)
})

test('同一句里有多个金额时按标签取值，不靠位置猜（真实合同发现的缺陷）', () => {
  // 真实合同里的写法：一句话里四个金额，试用期工资在前、转正工资在后、后面还有工资构成
  const clauseText =
    '试用期工资：人民币4800元/月，试用期满转正工资：人民币6000元/月，包含基本工资4500元、绩效工资1500元。'
  const facts = extractFacts([{ sectionTitle: null, articleNo: null, label: '第三条', text: clauseText }])

  // 旧实现取「这一条里最后一个金额」，得到的是绩效工资 1500
  assert.equal(facts.probationMonthlyWage.value, 4800)
  assert.equal(facts.monthlyWage.value, 6000)
})

test('只有试用期工资、没有转正工资时，宁可报未识别也不拿它当约定工资', () => {
  const facts = extractFacts([
    { sectionTitle: null, articleNo: null, label: '第一条', text: '试用期工资为4800元/月。' },
  ])
  assert.equal(facts.probationMonthlyWage.value, 4800)
  // 若把 4800 当成约定工资，80% 的判断基准就会被低估
  assert.equal(facts.monthlyWage.value, null)
  assert.equal(facts.monthlyWage.method, 'UNRECOGNIZED')
})

test('未识别一律为 null 并给出原因，绝不当成 0', () => {
  const facts = extractFacts(clause('甲方按月向乙方支付劳动报酬，具体金额面议。'))

  assert.equal(facts.monthlyWage.value, null)
  assert.equal(facts.monthlyWage.method, 'UNRECOGNIZED')
  assert.ok((facts.monthlyWage.reason ?? '').length > 0)

  assert.equal(facts.contractTermMonths.value, null)
  assert.equal(facts.probationMonths.value, null)
  // 合同根本没提竞业限制：这是「没有约定」，而不是「期限为 0」
  assert.equal(facts.nonCompeteMonths.value, null)
  assert.match(facts.nonCompeteMonths.reason ?? '', /未约定/)
})

test('条款里仍有多个日期区间时判定为歧义，不猜一个', () => {
  // 没有「第 N 种」标记可用于消歧，抽出来的会是错的那一段，所以宁可报未识别
  const ambiguous = extractFacts(
    clause('合同期限：自2026年7月1日起至2027年7月1日止；续订期：自2027年7月1日起至2028年7月1日止。'),
  )
  assert.equal(ambiguous.contractTermMonths.value, null)
  assert.match(ambiguous.contractTermMonths.reason ?? '', /多个期限区间/)
})
