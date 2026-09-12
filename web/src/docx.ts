import mammoth from 'mammoth'

export type DocxExtraction = {
  text: string
  paragraphCount: number
  /** 提取到的文字是否够用。加密文档、空文档会是 false。 */
  hasTextLayer: boolean
}

/** 少于这么多字符就认为没读到内容，而不是"这份合同很短"。 */
const MIN_TEXT_LENGTH = 50

/**
 * 从 .docx 提取文字。
 *
 * 走 mammoth 的 `extractRawText`：它把每个段落输出成一行，正好是 `extractContract` 期望的形态
 * （那边按行切分，并把没有条号的续行并回当前条款）。
 * 这里刻意不要 HTML——对"比对条款文字"这个目的，段落文本就够了，
 * 少一层 HTML 解析就少一层出错的地方。
 */
export async function extractDocxText(data: ArrayBuffer): Promise<DocxExtraction> {
  const result = await mammoth.extractRawText({ arrayBuffer: data })
  const text = result.value.replace(/\r\n?/g, '\n').trim()
  const paragraphCount = text.split('\n').filter((line) => line.trim() !== '').length
  return { text, paragraphCount, hasTextLayer: text.length >= MIN_TEXT_LENGTH }
}
