import { FILL } from './mark-blanks.ts'

/** 大小写不敏感：归一化会转小写，而填充可能被用在归一化过的文本上。 */
const FILL_RE = new RegExp(FILL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')

/** 按填空位后面紧跟的字，给一个合理的填充值，让生成的示例合同读起来像真的。 */
function valueAfter(text: string, from: number): string {
  const next = text.slice(from, from + 1)
  if (next === '年') return '2026'
  if (next === '月') return '7'
  if (next === '日') return '1'
  if (next === '元') return '8000'
  if (next === '种') return '1'
  return '示例'
}

/**
 * 把范本正文里的填空位填成示例值。
 *
 * 用途有两个：一是给比对引擎构造"已知答案"的测试输入（见 src/eval-diff.ts），
 * 二是将来界面上的示例演示。填充是确定性的，同样的输入永远得到同样的输出。
 */
export function fillBlanks(text: string): string {
  return text.replace(FILL_RE, (_match: string, offset: number) => valueAfter(text, offset + FILL.length))
}
