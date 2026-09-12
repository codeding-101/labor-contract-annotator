import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FILL, markBlanks } from '../src/mark-blanks.ts'

test('下划线包住的空白段替换为填空标记', () => {
  const html = '<p>1.月工资<u><span style="font-size:15pt;">&nbsp;&nbsp;&nbsp;&nbsp;</span></u>元。</p>'
  assert.equal(markBlanks(html), `<p>1.月工资${FILL}元。</p>`)
})

test('下划线里含真实文字时只去掉下划线，保留文字', () => {
  assert.equal(markBlanks('<p><u><span>是</span></u></p>'), '<p><span>是</span></p>')
})

test('全角空格也算空白', () => {
  assert.equal(markBlanks('<u>　　</u>'), FILL)
})

test('没有下划线的 HTML 原样返回', () => {
  const html = '<p>甲方（用人单位）：</p>'
  assert.equal(markBlanks(html), html)
})

test('同一段里的多个填空位各自标记', () => {
  const html = '<p>自<u>&nbsp;&nbsp;</u>年<u>&nbsp;&nbsp;</u>月</p>'
  assert.equal(markBlanks(html), `<p>自${FILL}年${FILL}月</p>`)
})

test('相邻的填空位合并成一个标记', () => {
  // Word 常把一条下划线拆成多个 run；不合并的话填充后会得到「示例示例2026年」，日期就匹配不上了
  const html = `<p>自<u>&nbsp;&nbsp;</u><u>&nbsp;&nbsp;</u><u>&nbsp;&nbsp;</u>年</p>`
  assert.equal(markBlanks(html), `<p>自${FILL}年</p>`)
})
