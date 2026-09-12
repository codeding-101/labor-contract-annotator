import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assessExtractedText, groupTextItems } from '../src/text-lines.ts'

test('按 y 分行、按 x 排序，y 大的在前（PDF 原点在左下）', () => {
  const lines = groupTextItems([
    { str: '第二行', transform: [1, 0, 0, 1, 100, 700] },
    { str: '第一行', transform: [1, 0, 0, 1, 100, 800] },
  ])
  assert.deepEqual(lines, ['第一行', '第二行'])
})

test('同一行的片段按 x 升序拼接', () => {
  const lines = groupTextItems([
    { str: '条的', transform: [1, 0, 0, 1, 200, 800] },
    { str: '第一', transform: [1, 0, 0, 1, 100, 800] },
  ])
  assert.deepEqual(lines, ['第一条的'])
})

test('中文片段之间不插空格（空隙多为排版产物）', () => {
  const lines = groupTextItems([
    { str: '劳动', transform: [1, 0, 0, 1, 100, 800] },
    { str: '合同', transform: [1, 0, 0, 1, 140, 800] },
  ])
  assert.deepEqual(lines, ['劳动合同'])
})

test('英文与数字片段之间插空格，避免粘成一个词', () => {
  const lines = groupTextItems([
    { str: 'ABC', transform: [1, 0, 0, 1, 100, 800] },
    { str: 'DEF', transform: [1, 0, 0, 1, 160, 800] },
  ])
  assert.deepEqual(lines, ['ABC DEF'])
})

test('y 抖动在容差内算同一行', () => {
  const lines = groupTextItems([
    { str: '甲', transform: [1, 0, 0, 1, 100, 800] },
    { str: '乙', transform: [1, 0, 0, 1, 140, 801.4] },
  ])
  assert.deepEqual(lines, ['甲乙'])
})

test('空白片段被丢弃，空输入返回空数组', () => {
  assert.deepEqual(groupTextItems([{ str: '   ', transform: [1, 0, 0, 1, 0, 0] }]), [])
  assert.deepEqual(groupTextItems([]), [])
})

test('字形映射到控制字符（大量 SOH）时判为不可用，并剥掉这些字符', () => {
  // 实测遇到过的坏法：字体编码坏掉，字形被映射到 0x01 区间，提取出大量 SOH
  const good = '劳动合同期限为三年，试用期三个月，月工资8000元，甲方依法缴纳社会保险。'
  const broken = good.split('').join('\u0001')

  const clean = assessExtractedText(good, 0.4, 10)
  assert.equal(clean.usable, true)
  assert.equal(clean.removedControlChars, 0)

  const dirty = assessExtractedText(broken, 0.4, 10)
  assert.equal(dirty.usable, false, '控制字符占比过高应判为不可用')
  assert.ok(dirty.removedControlChars > 30)
  assert.equal(dirty.text.includes('\u0001'), false, '正文里不该留下控制字符')
})

test('行尾的控制字符是生成器噪声，剥掉即可，不能据此判定读不出文字', () => {
  // 实测一份 4 页的正常合同：每一行末尾都带一个 SOH，占全部字符的 4%。
  // 拿"控制字符总占比"当判据会把它误报成"可能是扫描件或加密文档"（真踩过）。
  const lines = [
    '甲方（用人单位）',
    '名称：南城恒信文化传媒有限公司',
    '乙方（劳动者）',
    '第一条 劳动合同期限',
    '本合同采用固定期限劳动合同形式：自2026年09月15日起至2029年09月14日止。',
    '其中试用期自2026年09月15日起至2027年03月14日止。',
    '甲方依法为乙方缴纳社会保险，工资于每月十五日前足额支付。',
  ]
  const raw = lines.join('\u0001\n') + '\u0001'

  const assessed = assessExtractedText(raw, 0.4, 50)
  assert.equal(assessed.usable, true)
  assert.equal(assessed.text.includes('\u0001'), false)
  assert.equal(assessed.removedControlChars, lines.length)
})

test('被映射成部首的字形要修回统一汉字（真实合同 PDF 发现的缺陷）', () => {
  // 康熙部首：⽅(2F45) 是「方」、⼈(2F08) 是「人」、⺠ 在部首补充区(2EA0) 是「民」
  const raw = '甲⽅（⽤⼈单位）与⼄⽅（劳动者）根据《中华⼈⺠共和国劳动法》订⽴本合同。'

  const assessed = assessExtractedText(raw, 0.4, 10)
  assert.equal(assessed.text, '甲方（用人单位）与乙方（劳动者）根据《中华人民共和国劳动法》订立本合同。')
  assert.equal(assessed.repairedCompatChars, 8)
  assert.equal(assessed.usable, true)

  // 不修复的话，下面这些关键词一个都匹配不上，事实抽取会静默全部落到"未提及"
  assert.match(assessed.text, /甲方/)
  assert.match(assessed.text, /中华人民共和国/)
})

test('CJK 兼容汉字同样修回统一汉字', () => {
  // 与康熙部首同一类问题：码位不同、字形看着是同一个字。F900 段的兼容汉字由 NFKC 覆盖
  const assessed = assessExtractedText('\uF900\uF9B8 等字样', 0.4, 5)
  assert.equal(assessed.text, '豈隸 等字样')
  assert.equal(assessed.repairedCompatChars, 2)
})

test('修复只动部首与兼容汉字，不改全角标点与数字（报告要原样引用合同）', () => {
  const raw = '工资８０００元，于每月十五日前支付（含绩效）。'
  assert.equal(assessExtractedText(raw, 0.4, 5).text, raw)
  assert.equal(assessExtractedText(raw, 0.4, 5).repairedCompatChars, 0)
})

test('中文占比过低（乱码）判为不可用', () => {
  assert.equal(assessExtractedText('abcdefghij klmnopqrst uvwxyz abcdefghij klmnopqrst').usable, false)
})

test('坐标不是数字的片段被跳过，不抛异常', () => {
  const lines = groupTextItems([
    { str: '正常', transform: [1, 0, 0, 1, 100, 800] },
    { str: '坏片段', transform: [1, 0, 0, 1] },
  ])
  assert.deepEqual(lines, ['正常'])
})
