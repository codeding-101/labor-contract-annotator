import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildReport, resolveKeyInfo } from '../src/build-report.ts'
import type { ContractClause } from '../src/diff-template.ts'
import { extractFacts } from '../src/extract-facts.ts'
import type { RiskFinding, UndeterminedItem } from '../src/rule-engine.ts'
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
    title: `${level} 级测试标注`,
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

const CLAUSES: ContractClause[] = [
  { sectionTitle: null, articleNo: 1, label: '第一条', text: '乙方工作地点为北京市朝阳区。' },
  { sectionTitle: null, articleNo: 2, label: '第二条', text: '甲方按月支付工资，月工资8000元。' },
]

function reportWith(findings: RiskFinding[], undeterminedItems: UndeterminedItem[]) {
  return buildReport({
    template: TEMPLATE,
    contractClauses: CLAUSES,
    facts: extractFacts(CLAUSES),
    ruleResult: { findings, undetermined: undeterminedItems },
    ruleSetVersion: '0.1.0',
  })
}

test('发薪日期取真值，而不是只说"有提及"（真实合同发现的缺陷）', () => {
  const clauses: ContractClause[] = [
    {
      sectionTitle: null,
      articleNo: 5,
      label: '第五条',
      text: '工资支付方式：甲方于每月15日以银行转账形式足额发放上月工资，遇法定节假日、休息日提前发放，无无故拖欠、克扣情形。',
    },
  ]
  const row = resolveKeyInfo(clauses, extractFacts(clauses)).find((item) => item.label === '发薪日期')
  // 更早的实现只判断"有没有出现关键词"，这句一个关键词都不含，被误报成「合同未提及」
  assert.equal(row?.status, 'VALUE')
  assert.equal(row?.value, '15日')
})

test('报告只做标注，不出评分、不给签署建议', () => {
  // 这是产品定位：把条款标出来让人自己看，不替用户下结论。
  // 用断言钉住，防止以后又把评分加回来。
  const report = reportWith([finding('red'), finding('yellow'), finding('blue')], [])

  assert.equal('score' in report, false)
  assert.equal('recommendation' in report, false)
  assert.deepEqual(report.counts, { red: 1, yellow: 1, blue: 1 })
})

test('标注按等级排序，严重的在前', () => {
  const report = reportWith([finding('blue'), finding('red'), finding('yellow')], [])
  assert.deepEqual(
    report.risks.map((risk) => risk.level),
    ['red', 'yellow', 'blue'],
  )
})

test('无法判定的项单独列出，且不计进标注数', () => {
  const report = reportWith([], [undetermined('PROBATION_TOO_LONG')])
  assert.deepEqual(report.counts, { red: 0, yellow: 0, blue: 0 })
  assert.equal(report.undetermined.length, 1)
  assert.match(report.undetermined[0]?.reason ?? '', /缺少可识别信息/)
})

test('关键信息：每一项都取真值，取不到值时才退回"有提及／未提及"', () => {
  const rows = resolveKeyInfo(CLAUSES, extractFacts(CLAUSES))
  const byLabel = (label: string) => rows.find((row) => row.label === label)

  assert.equal(byLabel('约定月工资')?.status, 'VALUE')
  assert.equal(byLabel('约定月工资')?.value, '8000元')
  // 文本类事实的值就是合同原文片段，比"有提及（未核对内容）"有用
  assert.equal(byLabel('工作地点')?.status, 'TEXT')
  assert.equal(byLabel('工作地点')?.value, '乙方工作地点为北京市朝阳区。')
  // 合同没写的项要显式标出来——"未提及"本身就是一条提示
  assert.equal(byLabel('奖金')?.status, 'NOT_FOUND')
  assert.equal(byLabel('竞业限制期限')?.status, 'NOT_FOUND')
})

test('合同有相关字样但取不出值时，摘出原文而不是只写"有提及"', () => {
  const clauses: ContractClause[] = [
    {
      sectionTitle: null,
      articleNo: 3,
      label: '第三条',
      text: '根据乙方工作岗位的特点，甲方安排乙方执行以下第1种工时制度：1.标准工时工作制。甲方应采取适当方式保障乙方的休息休假权利。乙方依法享有法定节假日、带薪年休假、婚丧假、产假等假期。',
    },
  ]
  const row = resolveKeyInfo(clauses, extractFacts(clauses)).find((item) => item.label === '年休假')
  assert.equal(row?.status, 'MENTIONED')
  // 摘的是含关键词的**那一句**，而不是从条款开头截一段无关的工时制度文字
  assert.equal(row?.evidence, '乙方依法享有法定节假日、带薪年休假、婚丧假、产假等假期。')
})

test('标题是唯一线索时仍报"有提及"，不误报"未提及"', () => {
  const clauses: ContractClause[] = [{ sectionTitle: null, articleNo: null, label: '第四条', text: '四、违约责任' }]
  const row = resolveKeyInfo(clauses, extractFacts(clauses)).find((item) => item.label === '违约责任')
  assert.equal(row?.status, 'MENTIONED')
  assert.equal(row?.evidence, '四、违约责任')
})

test('关键词先出现在章节标题里时，摘更聚焦的那一句', () => {
  const clauses: ContractClause[] = [
    {
      sectionTitle: null,
      articleNo: 9,
      label: '第九条',
      text: '保密与竞业限制1.乙方在职期间，需严格保密甲方商业信息、客户资源、运营方案、内部数据等商业秘密，不得擅自泄露、外传、私自使用。2.本岗位不属于企业高管、核心技术及涉密岗位，不约定离职后竞业限制义务。',
    },
  ]
  const row = resolveKeyInfo(clauses, extractFacts(clauses)).find((item) => item.label === '竞业限制期限')
  // 按出现顺序取会摘到章节标题连带第一条正文，那句跟"竞业限制期限"无关
  assert.match(row?.evidence ?? '', /不约定离职后竞业限制义务/)
})

test('工资结构由基本工资、绩效工资、奖金合成', () => {
  const clauses: ContractClause[] = [
    {
      sectionTitle: null,
      articleNo: 3,
      label: '第三条',
      text: '试用期工资：人民币4800元/月，试用期满转正工资：人民币6000元/月，包含基本工资4500元、绩效工资1500元。',
    },
  ]
  const rows = resolveKeyInfo(clauses, extractFacts(clauses))
  const byLabel = (label: string) => rows.find((row) => row.label === label)

  assert.equal(byLabel('试用期工资')?.value, '4800元')
  assert.equal(byLabel('约定月工资')?.value, '6000元')
  assert.equal(byLabel('基本工资')?.value, '4500元')
  assert.equal(byLabel('绩效工资')?.value, '1500元')
  assert.equal(byLabel('工资结构')?.value, '基本工资4500元 + 绩效工资1500元')
})

test('报告带出具职声明、关键信息与三段总结', () => {
  const report = reportWith([], [])

  assert.ok(report.disclaimers.some((line) => /不构成法律意见/.test(line)))
  assert.ok(report.disclaimers.some((line) => /未覆盖的事项/.test(line)))
  assert.equal(report.summaries.length, 3)
  assert.equal(report.keyInfo.length >= 16, true)
  assert.equal(report.template.name, '测试范本')
})
