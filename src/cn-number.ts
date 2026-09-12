const DIGITS: Readonly<Record<string, number>> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

const UNITS: Readonly<Record<string, number>> = { 十: 10, 百: 100, 千: 1000 }

/**
 * 中文数字转整数，例如「十」→10、「第二十五条」的「二十五」→25、「一百零三」→103。
 * 「两」按 2 处理——合同里「两年」「两个月」极常见。
 * 支持到 9999，足够覆盖法律条文章节编号。不支持逐位读法（如年份「二〇二四」）。
 * 不是合法的中文数字时返回 null。
 */
export function cnToInt(input: string): number | null {
  const s = input.trim()
  if (s === '') return null
  if (/^\d+$/.test(s)) return Number(s)

  let section = 0
  let digit = 0
  let sawAny = false

  for (const ch of s) {
    const d = DIGITS[ch]
    if (d !== undefined) {
      digit = d
      sawAny = true
      continue
    }
    const unit = UNITS[ch]
    if (unit === undefined) return null
    // 「十」开头省略了「一」，如「第十条」读作一十
    if (digit === 0 && unit === 10) digit = 1
    section += digit * unit
    digit = 0
    sawAny = true
  }

  if (!sawAny) return null
  return section + digit
}
