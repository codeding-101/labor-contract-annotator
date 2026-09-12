import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  compileClausePattern,
  diffAgainstTemplate,
  similarity,
  type ContractClause,
  type TemplateClause,
} from '../src/diff-template.ts'
import { fillBlanks } from '../src/fill-template.ts'
import { FILL } from '../src/mark-blanks.ts'
import { normalizeForCompare } from '../src/normalize.ts'

test('填空标记在归一化后仍能被切分出来', () => {
  // 这条断言直接对着一个真实 bug：归一化会转小写，用大写标记去 split 就切不开，
  // 整段标记会被转义进正则，导致所有含填空位的条款都匹配不上。
  assert.equal(compileClausePattern(`第${FILL}种方式`).source, '^第.+?种方式$')
})

test('归一化不会破坏填空标记（大小写之外）', () => {
  const normalized = normalizeForCompare(`第${FILL}种`)
  assert.equal(normalized.toLowerCase(), `第${FILL.toLowerCase()}种`)
})

test('相邻的多个填空位各自成为通配符', () => {
  assert.equal(compileClausePattern(`自${FILL}${FILL}年${FILL}月`).source, '^自.+?.+?年.+?月$')
})

test('范本条款的编译模式能匹配填好内容的合同', () => {
  const template = `乙方工作岗位是${FILL}，岗位职责为${FILL}。`
  const pattern = compileClausePattern(template)
  assert.equal(pattern.test(normalizeForCompare('乙方工作岗位是后端开发工程师，岗位职责为接口开发。')), true)
})

test('改写后的条款不匹配模式', () => {
  const pattern = compileClausePattern(`乙方工作岗位是${FILL}。`)
  assert.equal(pattern.test(normalizeForCompare('本条按甲方规章制度执行，不再适用范本表述。')), false)
})

test('相似度：同文本为 1，无关文本很低', () => {
  assert.equal(similarity('甲乙双方建立劳动关系', '甲乙双方建立劳动关系'), 1)
  assert.ok(similarity('甲方安排乙方加班应支付加班工资', '乙方享有法定节假日与带薪年休假') < 0.2)
})

const TEMPLATE: TemplateClause[] = [
  { sectionTitle: '一、劳动合同期限', articleNo: 1, articleLabel: '第一条', text: `期限自${FILL}年${FILL}月${FILL}日起。` },
  { sectionTitle: '一、劳动合同期限', articleNo: 2, articleLabel: '第二条', text: '乙方工作岗位是，岗位职责为。' },
  { sectionTitle: '二、劳动报酬', articleNo: 3, articleLabel: '第三条', text: `月工资${FILL}元。` },
]

function contract(texts: (string | null)[]): ContractClause[] {
  return texts.map((text, index) => ({
    sectionTitle: index < 2 ? '一、劳动合同期限' : '二、劳动报酬',
    articleNo: index + 1,
    label: `第${index + 1}条`,
    text: text ?? (TEMPLATE[index]?.text ?? ''),
  }))
}

test('四类差异的分类', () => {
  const filled = contract(TEMPLATE.map((clause) => fillBlanks(clause.text)))

  // 全部填好 → 无差异
  const ok = diffAgainstTemplate(TEMPLATE, filled)
  assert.deepEqual(ok.counts, { MISSING_IN_CONTRACT: 0, EXTRA_IN_CONTRACT: 0, MODIFIED: 0, BLANK_LEFT: 0 })
  assert.equal(ok.matchedOk, 3)

  // 留空一处 → BLANK_LEFT
  const blank = diffAgainstTemplate(TEMPLATE, contract([null, fillBlanks('乙方工作岗位是，岗位职责为。'), fillBlanks('月工资{{FILL}}元。')]))
  assert.equal(blank.counts.BLANK_LEFT, 1)
  assert.equal(blank.items.find((item) => item.kind === 'BLANK_LEFT')?.templateLabel, '第一条')

  // 删掉一条 → MISSING_IN_CONTRACT
  const missing = diffAgainstTemplate(
    TEMPLATE,
    filled.filter((_, index) => index !== 1),
  )
  assert.equal(missing.counts.MISSING_IN_CONTRACT, 1)
  assert.equal(missing.items.find((item) => item.kind === 'MISSING_IN_CONTRACT')?.templateLabel, '第二条')

  // 多出一条 → EXTRA_IN_CONTRACT
  const extra = diffAgainstTemplate(TEMPLATE, [
    ...filled,
    { sectionTitle: '二、劳动报酬', articleNo: 9, label: '第九条', text: '乙方提前离职应支付违约金五万元。' },
  ])
  assert.equal(extra.counts.EXTRA_IN_CONTRACT, 1)
  assert.equal(extra.items.find((item) => item.kind === 'EXTRA_IN_CONTRACT')?.contractLabel, '第九条')

  // 改写一条 → MODIFIED，且能说明是靠什么对齐上的
  const modified = diffAgainstTemplate(TEMPLATE, contract([null, null, '月工资按公司薪酬制度执行。']))
  assert.equal(modified.counts.MODIFIED, 1)
  assert.equal(modified.items.find((item) => item.kind === 'MODIFIED')?.matchMethod, '条号相同')
})

test('条号被改掉时仍能靠模式匹配对齐', () => {
  // 合同把条号重排成 11/12/13，范本里没有这些条号，"条号相同"这条路走不通——
  // 只有模式匹配能对上。matchedOk 等于 3 就说明走的是模式匹配。
  const renumbered = TEMPLATE.map((clause, index) => ({
    sectionTitle: clause.sectionTitle,
    articleNo: index + 11,
    label: `第${index + 11}条`,
    text: fillBlanks(clause.text),
  }))

  const result = diffAgainstTemplate(TEMPLATE, renumbered)
  assert.deepEqual(result.counts, { MISSING_IN_CONTRACT: 0, EXTRA_IN_CONTRACT: 0, MODIFIED: 0, BLANK_LEFT: 0 })
  assert.equal(result.matchedOk, 3)
})

test('条号对不上且留有空白时，报告能说明是靠模式匹配对齐的', () => {
  const renumbered = TEMPLATE.map((clause, index) => ({
    sectionTitle: clause.sectionTitle,
    articleNo: index + 11,
    label: `第${index + 11}条`,
    text: index === 0 ? clause.text : fillBlanks(clause.text),
  }))

  const result = diffAgainstTemplate(TEMPLATE, renumbered)
  const blank = result.items.find((item) => item.kind === 'BLANK_LEFT')
  assert.equal(blank?.templateLabel, '第一条')
  assert.equal(blank?.matchMethod, '模式匹配')
})
