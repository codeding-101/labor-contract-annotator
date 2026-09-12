import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractTemplate, type TemplateSection } from '../src/extract-template.ts'

function sectionAt(sections: TemplateSection[], index: number): TemplateSection {
  const section = sections[index]
  assert.ok(section !== undefined, `缺少第 ${index} 个章节`)
  return section
}

/** 按真实范本的结构构造：标题、注意事项、甲乙双方信息栏、序言、节标题、条文、签署栏、附件。 */
const OFFICIAL_SHAPED = [
  '劳 动 合 同',
  '（通 用）',
  '甲方（用人单位）：',
  '乙方（劳 动 者）：',
  '注 意 事 项',
  '一、本合同文本供用人单位与建立劳动关系的劳动者签订劳动合同时使用。',
  '二、用人单位应当与招用的劳动者自用工之日起一个月内依法订立书面劳动合同。',
  '根据《中华人民共和国劳动法》《中华人民共和国劳动合同法》等法律法规政策规定，甲乙双方订立本合同。',
  '一、劳动合同期限',
  '第一条 双方约定按下列第{{FILL}}种方式确定劳动合同期限：',
  '1.固定期限：自{{FILL}}年{{FILL}}月{{FILL}}日起。',
  '2.无固定期限。',
  '二、劳动报酬',
  '第二条 甲方采用以下第{{FILL}}种方式向乙方支付工资。',
  '第三条 乙方在试用期期间的工资计发标准为{{FILL}}元。',
  '甲方（盖章） 乙方（签字）',
  '附件1',
  '续 订 劳 动 合 同',
]

test('抽出章节与条文，正文边界停在签署栏', () => {
  const result = extractTemplate(OFFICIAL_SHAPED)

  assert.equal(result.sections.length, 2)
  assert.equal(sectionAt(result.sections, 0).sectionNo, '一')
  assert.equal(sectionAt(result.sections, 0).sectionTitle, '劳动合同期限')
  assert.equal(sectionAt(result.sections, 1).sectionTitle, '劳动报酬')

  const articles = result.sections.flatMap((section) => section.articles)
  assert.deepEqual(
    articles.map((article) => article.articleNo),
    [1, 2, 3],
  )
  assert.equal(result.bodyEndBlock, '甲方（盖章） 乙方（签字）')
  assert.equal(result.trailing.length, 3)
  assert.deepEqual(result.issues, [])
})

test('注意事项不进章节，只进前置块与 notes', () => {
  const result = extractTemplate(OFFICIAL_SHAPED)

  assert.equal(result.notes.length, 2)
  assert.match(result.notes[0] ?? '', /本合同文本供用人单位/)
  assert.equal(result.frontMatter.length, 8)
  // 注意事项里的「一、」「二、」不能被当成节标题
  assert.equal(result.sections.length, 2)
})

test('节标题不会被并进上一条正文', () => {
  // 回归测试：曾经因为节标题块被当作续段，第五条正文末尾挂上了「四、劳动报酬」。
  const first = sectionAt(extractTemplate(OFFICIAL_SHAPED).sections, 0).articles[0]
  assert.ok(first !== undefined)
  assert.ok(!first.text.includes('劳动报酬'), '节标题不应出现在条文正文里')
  assert.ok(first.text.endsWith('2.无固定期限。'))
})

test('列表项另起一行，句中被拆开的块直接续写', () => {
  const withList = sectionAt(extractTemplate(OFFICIAL_SHAPED).sections, 0).articles[0]
  assert.equal(
    withList?.text,
    '双方约定按下列第{{FILL}}种方式确定劳动合同期限：\n1.固定期限：自{{FILL}}年{{FILL}}月{{FILL}}日起。\n2.无固定期限。',
  )

  const split = extractTemplate([
    '一、劳动合同期限',
    '第一条 甲方安排乙方执行以下第',
    '种工时制度：乙方应遵守以上约定。',
  ])
  assert.equal(
    sectionAt(split.sections, 0).articles[0]?.text,
    '甲方安排乙方执行以下第种工时制度：乙方应遵守以上约定。',
  )
})

test('条号不连续时停止收集并记录问题', () => {
  const result = extractTemplate(['一、劳动合同期限', '第一条 内容完整且足够长。', '第三条 跳过了第二条。'])
  assert.equal(result.sections.flatMap((section) => section.articles).length, 1)
  assert.ok(result.issues.some((issue) => /条号不连续/.test(issue)))
})

test('条文出现在任何节标题之前时明确报错，而不是悄悄丢掉', () => {
  const result = extractTemplate(['第一条 内容完整且足够长。', '第二条 内容完整且足够长。'])
  assert.equal(result.sections.length, 0)
  assert.equal(result.issues.filter((issue) => /未归属到任何节标题/.test(issue)).length, 2)
})

test('没有签署栏时用页脚判定正文结束', () => {
  const result = extractTemplate([
    '一、劳动合同期限',
    '第一条 内容完整且足够长。',
    '主办：某某区人民政府 承办：某某区新闻信息中心 网站地图',
  ])
  assert.match(result.bodyEndBlock ?? '', /主办/)
  assert.equal(result.trailing.length, 1)
})
