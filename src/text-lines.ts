/**
 * 文档文本项的最小形状。pdfjs 的 `textContent.items`、以及将来别的 PDF 库，
 * 都是这个形状的超集：一个字符串加一个变换矩阵（矩阵第 5、6 位是 x、y 坐标）。
 */
export type TextItemLike = {
  str: string
  transform: number[]
}

type Fragment = { x: number; y: number; text: string }

/** 同一行的 y 容差（PDF 单位）。同一行的片段 y 完全相同，给一点容差防抖动。 */
const Y_TOLERANCE = 2

/** 控制字符（保留换行与制表符）。它们在正文里没有任何意义。 */
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

/**
 * 评估提取出来的文字，并顺手剥掉控制字符。
 *
 * PDF 有三种坏法，后两种只有这里拦得住：
 * 1. 没有文字层（扫描件、拍照件）——长度为 0，容易发现；
 * 2. **字体缺 ToUnicode 映射**——提取出一堆乱码，字符数看着够，容易蒙混过关；
 * 3. **字形被映射到控制字符区间**——提取出大量 SOH（0x01）这类字符。实测遇到过一次。
 *
 * 判据两条：剥离控制字符后的**中文占比**够高，且**控制字符占比**够低。
 * 这两种坏文件在本地都无从还原，正确做法是明确报「读不出来」，而不是给一份错报告。
 */
export function assessExtractedText(
  rawText: string,
  minCjkRatio = 0.4,
  minLength = 50,
  maxControlRatio = 0.02,
): { text: string; usable: boolean; removedControlChars: number } {
  const removedControlChars = (rawText.match(CONTROL_CHARS) ?? []).length
  const text = rawText.replace(CONTROL_CHARS, '')

  const controlRatio = rawText.length === 0 ? 0 : removedControlChars / rawText.length
  const compact = text.replace(/\s/g, '')
  const cjk = [...compact].filter((ch) => /[\u4e00-\u9fff]/.test(ch)).length
  const cjkRatio = compact.length === 0 ? 0 : cjk / compact.length

  const usable =
    compact.length >= minLength && controlRatio <= maxControlRatio && cjkRatio >= minCjkRatio

  return { text, usable, removedControlChars }
}

/**
 * 两段文字拼接时是否要插空格。
 *
 * 只在两侧都是 ASCII 字母数字时才插：中文合同里绝大多数空隙是排版产物，
 * 乱插空格会把「劳动合同」切成「劳动 合同」。而英文和数字之间不插又会粘成
 * 「ABC DEF」→「ABCDEF」，所以按字符类型判断。
 */
function needsSpace(previous: string, next: string): boolean {
  if (previous === '' || next === '') return false
  const last = previous.slice(-1)
  const first = next.slice(0, 1)
  return /[0-9A-Za-z]/.test(last) && /[0-9A-Za-z]/.test(first)
}

/**
 * 把 PDF 的文本片段按行重组。
 *
 * PDF 里没有"段落"概念，只有一堆带坐标的文本片段。所以做法是：
 * 按 y 分行（容差内算同一行）→ 行内按 x 升序 → 拼接。
 * 注意 PDF 坐标原点在左下角，**y 越大越靠上**，所以要按 y 降序输出。
 *
 * 输出是"一行一段"的文本，交给 `extractContract` 继续切分条款——
 * 合同里的换行本来就多是排版折行，那边会把续行并回当前条款。
 */
export function groupTextItems(items: readonly TextItemLike[]): string[] {
  const fragments: Fragment[] = []
  for (const item of items) {
    if (typeof item.str !== 'string') continue
    if (item.str.trim() === '') continue
    const x = item.transform[4]
    const y = item.transform[5]
    if (typeof x !== 'number' || typeof y !== 'number') continue
    fragments.push({ x, y, text: item.str })
  }

  if (fragments.length === 0) return []

  fragments.sort((a, b) => b.y - a.y || a.x - b.x)

  const lines: string[] = []
  let current: Fragment[] = []
  let currentY = fragments[0]?.y ?? 0

  const flush = (): void => {
    if (current.length === 0) return
    current.sort((a, b) => a.x - b.x)
    let text = ''
    for (const fragment of current) {
      text = needsSpace(text, fragment.text) ? `${text} ${fragment.text}` : `${text}${fragment.text}`
    }
    const trimmed = text.trim()
    if (trimmed !== '') lines.push(trimmed)
    current = []
  }

  for (const fragment of fragments) {
    if (Math.abs(fragment.y - currentY) > Y_TOLERANCE) {
      flush()
      currentY = fragment.y
    }
    current.push(fragment)
  }
  flush()

  return lines
}
