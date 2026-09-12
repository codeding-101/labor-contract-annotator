import { FILL } from './mark-blanks.ts'

/** 大小写不敏感：归一化会转小写，而填充可能被用在归一化过的文本上。 */
const FILL_RE = new RegExp(FILL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')

/**
 * 日期三连（年→月→日）按固定表循环填充，让生成的示例合同自洽而非一堆相同的占位值。
 *
 * 范本第一条的日期出现顺序正好是「合同起始日 → 合同终止日 → 试用期终止日」，
 * 所以循环表按这个顺序设成 3 年后与 3 个月后，示例合同就是"三年期限、三个月试用期"。
 */
const DATE_CYCLE = [
  { year: '2026', month: '7', day: '1' },
  { year: '2029', month: '7', day: '1' },
  { year: '2026', month: '10', day: '1' },
]

/**
 * 把范本正文里的填空位填成示例值。
 *
 * 用途：给比对引擎与事实抽取构造"已知答案"的测试输入（见 `src/eval-diff.ts` 与各测试），
 * 以及将来界面上的示例演示。填充是确定性的，同样的输入永远得到同样的输出。
 */
export function fillBlanks(text: string): string {
  let dateIndex = 0
  return text.replace(FILL_RE, (_match: string, offset: number) => {
    const next = text.slice(offset + FILL.length, offset + FILL.length + 1)
    const slot = DATE_CYCLE[dateIndex % DATE_CYCLE.length]

    if (next === '年') return slot?.year ?? '2026'
    if (next === '月') return slot?.month ?? '7'
    if (next === '日') {
      dateIndex += 1
      return slot?.day ?? '1'
    }
    if (next === '元') return '8000'
    if (next === '种') return '1'
    return '示例'
  })
}
