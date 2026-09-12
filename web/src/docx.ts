import mammoth from 'mammoth'

export type DocxText = {
  /** 按段落重组的原始文本。能不能用交给 `document.ts` 统一判断，这里不做质量判定。 */
  text: string
  paragraphCount: number
}

/**
 * 从 .docx 提取文字。
 *
 * 走 mammoth 的 `extractRawText`：它把每个段落输出成一行（表格单元格也是段落，会被收进来），
 * 正好是 `extractContract` 期望的形态——那边按行切分，并把没有条号的续行并回当前条款。
 * 这里刻意不要 HTML：对"比对条款文字"这个目的，段落文本就够了，
 * 少一层 HTML 解析就少一层出错的地方。
 */
export async function extractDocxText(data: ArrayBuffer): Promise<DocxText> {
  let value: string
  try {
    const result = await mammoth.extractRawText({ arrayBuffer: data })
    value = result.value
  } catch (cause) {
    // 最常见的两种：把 .doc 直接改了扩展名（内容是 OLE 复合文档，不是 zip），文件被加密或损坏。
    // 这两件事用户自己能解决，所以给出可操作的提示，而不是把英文异常原样抛出去。
    const reason = cause instanceof Error ? cause.message : String(cause)
    throw new Error(
      `这个文件读不出内容（${reason}）。常见原因是把 .doc 直接改了扩展名，或文件已加密、损坏——` +
        '请在 Word 里打开后另存为 .docx 再试。',
    )
  }

  const text = value.replace(/\r\n?/g, '\n').trim()
  const paragraphCount = text.split('\n').filter((line) => line.trim() !== '').length
  return { text, paragraphCount }
}
