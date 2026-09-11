import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractStatute, MAX_PREAMBLE_BLOCKS, type ExtractedArticle } from '../src/extract-statute.ts'

function articleAt(articles: ExtractedArticle[], index: number): ExtractedArticle {
  const article = articles[index]
  assert.ok(article !== undefined, `缺少第 ${index} 个条文`)
  return article
}

/** 覆盖真实官方页面里会同时出现的几种情况：修正决定前言、多款条文、正文里的条号引用、条号与正文分段。 */
const OFFICIAL_SHAPED = [
  '四、将第九十二条修改为：“违反本规定，未经许可，擅自经营劳务派遣业务的……”',
  '本决定自2013年7月1日起施行。',
  '第一章 总则',
  '第一条 为了完善劳动合同制度，明确劳动合同双方当事人的权利和义务。',
  '第二条 中华人民共和国境内的企业、个体经济组织、民办非企业单位等组织与劳动者建立劳动关系，适用本法。',
  '国家机关、事业单位、社会团体和与其建立劳动关系的劳动者，依照本法执行。',
  '第三条 订立劳动合同，应当遵循合法、公平、平等自愿的原则，并依照本法第三十九条的规定处理。',
  '第二章 劳动合同的订立',
  '第四条',
  '用人单位自用工之日起即与劳动者建立劳动关系。',
]

test('抽取时跳过正文之前的修正决定与通知，并完整记录前言', () => {
  const { articles, preamble } = extractStatute(OFFICIAL_SHAPED)
  assert.equal(articles.length, 4)
  assert.equal(preamble.length, 2)
  assert.match(preamble[0] ?? '', /修改|修正/)
  assert.match(preamble[1] ?? '', /施行/)
})

test('条文正文不含条号标签，且章节正确归属', () => {
  const { articles } = extractStatute(OFFICIAL_SHAPED)
  assert.equal(articleAt(articles, 0).articleLabel, '第一条')
  assert.equal(articleAt(articles, 0).text, '为了完善劳动合同制度，明确劳动合同双方当事人的权利和义务。')
  assert.equal(articleAt(articles, 0).chapter, '第一章 总则')
  assert.equal(articleAt(articles, 3).chapter, '第二章 劳动合同的订立')
})

test('同一条的多款各自成段时并入当前条', () => {
  const { articles } = extractStatute(OFFICIAL_SHAPED)
  const second = articleAt(articles, 1)
  assert.match(second.text, /国家机关、事业单位/)
  assert.equal(second.text.split('\n').length, 2)
})

test('正文里的条号引用不会被误判为新条文', () => {
  const { articles, issues } = extractStatute(OFFICIAL_SHAPED)
  assert.equal(articles.length, 4)
  assert.match(articleAt(articles, 2).text, /第三十九条/)
  assert.deepEqual(issues, [])
})

test('条号与正文分成两个块时仍然拼回同一条', () => {
  const { articles } = extractStatute(OFFICIAL_SHAPED)
  const fourth = articleAt(articles, 3)
  assert.equal(fourth.articleNo, 4)
  assert.equal(fourth.text, '用人单位自用工之日起即与劳动者建立劳动关系。')
})

test('条号不连续时停止收集并记录问题', () => {
  const { articles, issues } = extractStatute(['第一条 甲乙双方就劳动关系达成一致。', '第三条 跳过了第二条。'])
  assert.equal(articles.length, 1)
  assert.equal(issues.length, 1)
  assert.match(issues[0] ?? '', /条号不连续/)
})

test('正文之后重复出现第一条时正常收尾，不报错', () => {
  const { articles, issues } = extractStatute(['第一条 内容甲内容甲。', '第一条 内容乙内容乙。'])
  assert.equal(articles.length, 1)
  assert.deepEqual(issues, [])
})

test('正文过短的条文被记录为问题', () => {
  const { issues } = extractStatute(['第一条 内容完整且足够长。', '第二条 短'])
  assert.ok(issues.some((issue) => /正文过短/.test(issue)))
})

test('章标题块内混入条文时忽略该章号，条文仍被收下', () => {
  // 真实缺陷复现：官方页面把附则的章号写成「第九章」，并与第九十六条粘在同一块。
  const { articles, issues } = extractStatute([
    '第一章 总则',
    '第一条 内容完整且足够长。',
    '第八章 附则',
    '第九章 第二条 事业单位与实行聘用制的工作人员订立劳动合同，依照本法执行。',
    '第三条 本法自2008年1月1日起施行。',
  ])

  assert.equal(articles.length, 3)
  assert.equal(articleAt(articles, 1).articleNo, 2)
  assert.equal(articleAt(articles, 1).chapter, '第八章 附则')
  assert.equal(articleAt(articles, 2).chapter, '第八章 附则')
  assert.equal(issues.length, 1)
  assert.match(issues[0] ?? '', /标题内混入条文/)
})

test('前言超限只截断并记录实际段数，不计入抽取问题', () => {
  const navigationNoise = Array.from({ length: MAX_PREAMBLE_BLOCKS + 12 }, (_, index) => `导航项${index + 1}页面导航文本`)
  const { articles, preamble, preambleBlockCount, issues } = extractStatute([
    ...navigationNoise,
    '第一条 内容完整且足够长，可以作为合法条文。',
  ])

  assert.equal(articles.length, 1)
  assert.equal(preambleBlockCount, navigationNoise.length)
  assert.equal(preamble.length, MAX_PREAMBLE_BLOCKS)
  assert.deepEqual(issues, [])
})

test('正文之后的页脚不会被并入最后一条', () => {
  // 真实缺陷复现：政务网站页脚紧跟最后一条，曾把「网站地图 / 新ICP备…」并进第九十八条。
  const { articles, trailingBoundary, issues } = extractStatute([
    '第一条 内容完整且足够长，可以作为合法条文。',
    '第二条 本法自2008年1月1日起施行。',
    '联系我们 / 版权声明 / 网站地图',
    '主办单位：某某县人民政府办公室 联系方式：0996-1234567',
  ])

  assert.equal(articles.length, 2)
  assert.equal(articleAt(articles, 1).text, '本法自2008年1月1日起施行。')
  assert.equal(trailingBoundary, '联系我们 / 版权声明 / 网站地图')
  assert.deepEqual(issues, [])
})

test('节标题不会被并入上一条正文，且章节层级正确归属', () => {
  // 真实缺陷复现：只处理「第X章」而漏掉「第X节」时，
  // 「第三节 非全日制用工」会被当成续段并进第六十七条的正文。
  const { articles, issues } = extractStatute([
    '第一章 总则',
    '第一条 内容完整且足够长。',
    '第五章 特别规定',
    '第一节 集体合同',
    '第二条 内容完整且足够长。',
    '第二节 劳务派遣',
    '第三节 非全日制用工',
    '第三条 内容完整且足够长。',
  ])

  assert.equal(articles.length, 3)
  assert.equal(articleAt(articles, 0).section, null)
  assert.equal(articleAt(articles, 1).section, '第一节 集体合同')
  assert.equal(articleAt(articles, 1).chapter, '第五章 特别规定')
  assert.equal(articleAt(articles, 2).section, '第三节 非全日制用工')
  assert.equal(articleAt(articles, 2).text, '内容完整且足够长。')
  assert.deepEqual(issues, [])
})

test('换章时节层级被重置', () => {
  const { articles } = extractStatute([
    '第一章 总则',
    '第一节 本节标题',
    '第一条 内容完整且足够长。',
    '第二章 劳动合同的订立',
    '第二条 内容完整且足够长。',
  ])

  assert.equal(articleAt(articles, 0).section, '第一节 本节标题')
  assert.equal(articleAt(articles, 1).chapter, '第二章 劳动合同的订立')
  assert.equal(articleAt(articles, 1).section, null)
})

test('未识别的标题层级被当成续段时会被断言捕获', () => {
  // 防御性断言：解析器只认识章/节。将来遇到别的层级（如「编」）若不加处理，
  // 它会被当作续段并进上一条正文——这个断言负责让这种情况暴露而不是静默污染。
  const { articles, issues } = extractStatute(['第一条 内容完整且足够长。', '第一编 总则'])

  assert.equal(articles.length, 1)
  assert.ok(issues.some((issue) => /混入了标题/.test(issue)))
})
