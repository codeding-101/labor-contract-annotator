import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cnToInt } from '../src/cn-number.ts'

test('cnToInt 解析条文里的常见中文数字', () => {
  assert.equal(cnToInt('一'), 1)
  assert.equal(cnToInt('十'), 10)
  assert.equal(cnToInt('二十'), 20)
  assert.equal(cnToInt('二十五'), 25)
  assert.equal(cnToInt('九十八'), 98)
  assert.equal(cnToInt('一百'), 100)
  assert.equal(cnToInt('一百零一'), 101)
  assert.equal(cnToInt('三百二十一'), 321)
})

test('cnToInt 也接受阿拉伯数字写法', () => {
  assert.equal(cnToInt('25'), 25)
  assert.equal(cnToInt(' 7 '), 7)
})

test('cnToInt 对非法输入返回 null', () => {
  assert.equal(cnToInt(''), null)
  assert.equal(cnToInt('abc'), null)
  assert.equal(cnToInt('二x'), null)
})
