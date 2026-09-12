import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractContract } from '../src/extract-contract.ts'

test('按条号切分，条款标签与条号正确', () => {
  const result = extractContract(
    ['劳动合同', '甲方：某公司', '第一条 本合同自用工之日起生效。', '第二条 乙方工作岗位为后端开发。'].join('\n'),
  )

  assert.equal(result.method, 'ARTICLES')
  assert.equal(result.clauses.length, 2)
  assert.equal(result.clauses[0]?.articleNo, 1)
  assert.equal(result.clauses[0]?.label, '第一条')
  assert.equal(result.clauses[0]?.text, '本合同自用工之日起生效。')
  // 条号之前的抬头被略过，但要如实记录条数
  assert.equal(result.skippedBeforeFirstArticle, 2)
})

test('条号跳号或缺号不影响抽取（真实合同未必连续）', () => {
  const result = extractContract(['第一条 内容甲。', '第五条 内容乙。', '第九条 内容丙。'].join('\n'))
  assert.equal(result.clauses.length, 3)
  assert.deepEqual(
    result.clauses.map((clause) => clause.articleNo),
    [1, 5, 9],
  )
})

test('续段并入当前条款，不在句中插换行', () => {
  const result = extractContract(
    ['第二条 乙方工作岗位为后端开发，', '岗位职责由甲方另行确定。'].join('\n'),
  )
  assert.equal(result.clauses.length, 1)
  assert.equal(result.clauses[0]?.text, '乙方工作岗位为后端开发，岗位职责由甲方另行确定。')
})

test('章节标题被识别并归属到后续条款', () => {
  const result = extractContract(
    ['第一章 总则', '第一条 内容甲。', '第二章 劳动合同的订立', '第二条 内容乙。'].join('\n'),
  )
  assert.equal(result.clauses[0]?.sectionTitle, '第一章 总则')
  assert.equal(result.clauses[1]?.sectionTitle, '第二章 劳动合同的订立')
})

test('完全认不出条号时退化成一段一条，而不是报错', () => {
  const result = extractContract(['一、乙方负责平台开发。', '二、甲方按月支付报酬。'].join('\n'))
  assert.equal(result.method, 'PARAGRAPHS')
  assert.equal(result.clauses.length, 2)
  assert.deepEqual(
    result.clauses.map((clause) => clause.label),
    ['第1段', '第2段'],
  )
  assert.deepEqual(result.issues, [])
})

test('空文本给出明确问题，不抛异常', () => {
  const result = extractContract('   \n  \n')
  assert.equal(result.clauses.length, 0)
  assert.match(result.issues[0] ?? '', /为空/)
})
