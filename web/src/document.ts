export type DocumentExtraction = {
  text: string
  /** 给用户看的来源说明，例如「PDF · 24 页 · 提取出 10797 字」。 */
  detail: string
  /** 是否读到了足够的文字。读不到时要明确告知，不能给出空报告。 */
  hasTextLayer: boolean
}

export type DocumentKind = 'pdf' | 'docx'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** 按 MIME 与扩展名一起判断：有些系统给出空的 type，光看扩展名又不牢靠。 */
export function kindOf(file: File): DocumentKind | null {
  const name = file.name.toLowerCase()
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (file.type === DOCX_MIME || name.endsWith('.docx')) return 'docx'
  return null
}

/**
 * 文件 → 文本的统一入口。
 *
 * 各格式的读取器都**按需加载**（pdfjs 与 mammoth 都不小），
 * 而且都只做一件事：产出"一行一段"的文本，剩下的交给引擎。
 * 将来接 `.doc`、图片 OCR 时，只要在这里加一个分支即可。
 */
export async function extractDocument(file: File): Promise<DocumentExtraction> {
  const kind = kindOf(file)

  if (kind === 'pdf') {
    const { extractPdfText } = await import('./pdf.ts')
    const result = await extractPdfText(await file.arrayBuffer())
    return {
      text: result.text,
      hasTextLayer: result.hasTextLayer,
      detail: `PDF · ${result.pageCount} 页 · 提取出 ${result.text.length} 字`,
    }
  }

  if (kind === 'docx') {
    const { extractDocxText } = await import('./docx.ts')
    const result = await extractDocxText(await file.arrayBuffer())
    return {
      text: result.text,
      hasTextLayer: result.hasTextLayer,
      detail: `Word (.docx) · ${result.paragraphCount} 段 · 提取出 ${result.text.length} 字`,
    }
  }

  throw new Error('暂时只支持 PDF 与 Word（.docx）。老式 .doc 与图片格式还没接。')
}
