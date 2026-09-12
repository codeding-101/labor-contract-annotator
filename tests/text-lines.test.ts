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

  const clean = assessExtractedText(good)
  assert.equal(clean.usable, true)
  assert.equal(clean.removedControlChars, 0)

  const dirty = assessExtractedText(broken)
  assert.equal(dirty.usable, false, '控制字符占比过高应判为不可用')
  assert.ok(dirty.removedControlChars > 30)
  assert.equal(dirty.text.includes('\u0001'), false, '正文里不该留下控制字符')
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
