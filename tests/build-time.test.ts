import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTimestamp } from '../src/build-time.ts'

/** 每个用例前后都恢复环境，避免互相污染。 */
function withSourceDateEpoch<T>(value: string | undefined, run: () => T): T {
  const saved = process.env.SOURCE_DATE_EPOCH
  if (value === undefined) delete process.env.SOURCE_DATE_EPOCH
  else process.env.SOURCE_DATE_EPOCH = value
  try {
    return run()
  } finally {
    if (saved === undefined) delete process.env.SOURCE_DATE_EPOCH
    else process.env.SOURCE_DATE_EPOCH = saved
  }
}

test('默认取当前时间，且是合法的 ISO 时刻', () => {
  const before = Date.now()
  const stamp = withSourceDateEpoch(undefined, () => buildTimestamp())
  const parsed = Date.parse(stamp)
  assert.ok(Number.isFinite(parsed), `不是可解析的时间：${stamp}`)
  assert.ok(parsed >= before - 1000 && parsed <= Date.now() + 1000, `时间戳偏离当前时间：${stamp}`)
})

test('设置了 SOURCE_DATE_EPOCH 就用它，两次构建完全相同', () => {
  const first = withSourceDateEpoch('1789000000', () => buildTimestamp())
  const second = withSourceDateEpoch('1789000000', () => buildTimestamp())
  assert.equal(first, new Date(1789000000 * 1000).toISOString())
  assert.equal(second, first, '同一时间戳两次构建必须一致，否则"可复现"是空话')
})

test('空字符串按未设置处理', () => {
  const stamp = withSourceDateEpoch('', () => buildTimestamp())
  assert.ok(Number.isFinite(Date.parse(stamp)))
})

test('值不合法时响亮失败，不悄悄退回当前时间', () => {
  // 悄悄退回会给出"看起来可复现、其实不可复现"的产物，比报错危险
  for (const bad of ['abc', '-1', '20 26', '17780000abc']) {
    assert.throws(
      () => withSourceDateEpoch(bad, () => buildTimestamp()),
      /SOURCE_DATE_EPOCH/,
      `应当拒绝：${JSON.stringify(bad)}`,
    )
  }
})
