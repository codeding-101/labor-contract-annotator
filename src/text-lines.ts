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

/**
 * 判断提取出来的文字是否真的可用。
 *
 * PDF 有两种坏法，后者更危险：
 * 1. 压根没有文字层（扫描件、拍照件）——字符数为 0，容易发现；
 * 2. **有文字层，但字体没有 ToUnicode 映射**——提取出来是一堆乱码，字符数看着够、
 *    既不像扫描件也看不出来，于是照样生成一份满是错字的报告。
 *
 * 判据用「中文字符占比」：中文合同里汉字应当占绝对多数，占比过低说明提取坏了。
 * 这种文件本地无从还原，正确做法是明确报「读不出来」，而不是给一份错报告。
 */
export function looksLikeUsableChineseText(text: string, minRatio = 0.4, minLength = 50): boolean {
  const compact = text.replace(/\s/g, '')
  if (compact.length < minLength) return false
  const cjk = [...compact].filter((ch) => /[\u4e00-\u9fff]/.test(ch)).length
  return cjk / compact.length >= minRatio
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
