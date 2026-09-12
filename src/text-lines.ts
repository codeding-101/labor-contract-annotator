import { CJK_RADICAL_COMPAT } from './cjk-radicals.ts'

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

/** 需要修复码位的区块：CJK 部首补充、康熙部首、CJK 兼容汉字、CJK 兼容形式。 */
function needsCompatRepair(code: number): boolean {
  return (
    (code >= 0x2e80 && code <= 0x2eff) ||
    (code >= 0x2f00 && code <= 0x2fdf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f)
  )
}

/**
 * 把被映射成"部首/兼容汉字"的字形修回统一汉字。
 *
 * 中文字体（多见于 PDF 导出）会把「方」映射成康熙部首「⽅」(U+2F45)、
 * 「民」映射成部首补充区的「⺠」(U+2EA0)。这类文本**看着是对的**，
 * 但拿它去匹配「甲方」「中华人民共和国」永远匹配不上——事实抽取会静默地全部落到"未提及"，
 * 比读不出文字更危险，因为报告看起来像分析过了。
 *
 * 两段修复：康熙部首与兼容汉字靠 `normalize('NFKC')`（其兼容分解就是等价统一汉字），
 * 部首补充区没有兼容分解，查 `CJK_RADICAL_COMPAT`（Unicode UCD 的等价映射）。
 * 只对上述区块的字符做替换，**不做整篇 NFKC**——那会把全角标点、全角数字也改掉，
 * 报告里引用的合同原文就不原样了。
 */
export function repairCompatCjk(rawText: string): { text: string; repaired: number } {
  let repaired = 0
  let out = ''
  for (const ch of rawText) {
    const code = ch.codePointAt(0)
    if (code === undefined || !needsCompatRepair(code)) {
      out += ch
      continue
    }
    const target = CJK_RADICAL_COMPAT.get(code)
    const fixed = target === undefined ? ch.normalize('NFKC') : String.fromCodePoint(target)
    if (fixed !== ch) repaired += 1
    out += fixed
  }
  return { text: out, repaired }
}

/**
 * 统计夹在正文中间的控制字符，忽略粘在行首/行尾的那些。
 *
 * 行尾的控制字符是**生成器噪声**（实测一份正常合同的每一行末尾都带一个 SOH，占 4%），
 * 剥掉即可，不该据此判定"读不出文字"。夹在正文中间的控制字符才是**字形映射失败**的证据
 * （实测另一份 PDF 的每个字形都映射成了 SOH）——那时剥完剩下的文字不成话。
 */
function countEmbeddedControlChars(rawText: string): number {
  let embedded = 0
  for (const line of rawText.split('\n')) {
    const chars = [...line]
    for (let index = 0; index < chars.length; index += 1) {
      const ch = chars[index] ?? ''
      if (!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(ch)) continue
      if (index === 0 || index === chars.length - 1) continue
      // 连续多个控制字符整体算一处，避免同一段噪声被重复计数
      if (index > 0 && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(chars[index - 1] ?? '')) continue
      embedded += 1
    }
  }
  return embedded
}

/**
 * 评估提取出来的文字：修复码位 → 剥掉控制字符 → 判断这份文本能不能用。
 *
 * PDF 有三种坏法，后两种只有这里拦得住：
 * 1. 没有文字层（扫描件、拍照件）——长度为 0，容易发现；
 * 2. **字体缺 ToUnicode 映射**——提取出一堆乱码，字符数看着够，容易蒙混过关；
 * 3. **字形被映射到控制字符区间**——提取出大量 SOH（0x01）这类字符。实测遇到过一次。
 *
 * 判据：修复后的**中文占比**够高、**夹在正文里的控制字符**够少、长度够。
 * 注意不拿"控制字符总占比"当判据：那份正常合同每行尾都带一个 SOH，总占比 4%，
 * 按总占比判会把它误报成"读不出文字"（真踩过）。
 */
export function assessExtractedText(
  rawText: string,
  minCjkRatio = 0.4,
  minLength = 50,
  maxEmbeddedControlRatio = 0.02,
): { text: string; usable: boolean; removedControlChars: number; repairedCompatChars: number } {
  const repairedText = repairCompatCjk(rawText)
  const removedControlChars = (repairedText.text.match(CONTROL_CHARS) ?? []).length
  const text = repairedText.text.replace(CONTROL_CHARS, '')

  const embeddedControls = countEmbeddedControlChars(repairedText.text)
  const embeddedRatio = repairedText.text.length === 0 ? 0 : embeddedControls / repairedText.text.length
  const compact = text.replace(/\s/g, '')
  const cjk = [...compact].filter((ch) => /[\u4e00-\u9fff]/.test(ch)).length
  const cjkRatio = compact.length === 0 ? 0 : cjk / compact.length

  const usable = compact.length >= minLength && embeddedRatio <= maxEmbeddedControlRatio && cjkRatio >= minCjkRatio

  return { text, usable, removedControlChars, repairedCompatChars: repairedText.repaired }
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
