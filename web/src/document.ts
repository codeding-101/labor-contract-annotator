import { assessExtractedText } from '../../src/text-lines.ts'

export type DocumentExtraction = {
  text: string
  /** 给用户看的来源说明，例如「PDF · 24 页 · 提取出 10797 字」。 */
  detail: string
  /** 是否读到了足够的文字。读不到时要明确告知，不能给出空报告。 */
  hasTextLayer: boolean
}

export type DocumentKind = 'pdf' | 'docx'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** 少于这么多字符就认为没读到内容，而不是"这份合同很短"。 */
const MIN_TEXT_LENGTH = 50

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
 * 读取器都**按需加载**（pdfjs 与 mammoth 都不小），而且只做一件事：产出"一行一段"的文本。
 * 剩下的两件事由这里统一做，**不能分散到各读取器里**：
 * 1. 码位修复与清洗（`assessExtractedText`）——字形被映射成部首、混进控制字符这些坏法，
 *    两种格式都会遇到，只在某一条路径上做等于给另一条路径埋静默错误；
 * 2. 能不能用的判定——读不到就要明确告知，不能给出空报告。
 */
export async function extractDocument(file: File): Promise<DocumentExtraction> {
  const kind = kindOf(file)
  const raw = await readRaw(file, kind)
  const assessed = assessExtractedText(raw.text, 0.4, MIN_TEXT_LENGTH)

  return {
    text: assessed.text,
    hasTextLayer: assessed.usable,
    detail: `${raw.detail} · 提取出 ${assessed.text.length} 字${repairNote(assessed)}`,
  }
}

/** 修复与清洗的数字让用户看得见——提取质量是这个工具可信度的一部分。 */
function repairNote(assessed: { repairedCompatChars: number; removedControlChars: number }): string {
  const notes: string[] = []
  if (assessed.repairedCompatChars > 0) notes.push(`修正 ${assessed.repairedCompatChars} 个错位字符`)
  if (assessed.removedControlChars > 0) notes.push(`剥掉 ${assessed.removedControlChars} 个控制字符`)
  return notes.length === 0 ? '' : `（${notes.join('，')}）`
}

async function readRaw(file: File, kind: DocumentKind | null): Promise<{ text: string; detail: string }> {
  if (kind === 'pdf') {
    const { extractPdfText } = await import('./pdf.ts')
    const result = await extractPdfText(await file.arrayBuffer())
    return { text: result.text, detail: `PDF · ${result.pageCount} 页` }
  }

  if (kind === 'docx') {
    const { extractDocxText } = await import('./docx.ts')
    const result = await extractDocxText(await file.arrayBuffer())
    return { text: result.text, detail: `Word (.docx) · ${result.paragraphCount} 段` }
  }

  throw new Error('暂时只支持 PDF 与 Word（.docx）。老式 .doc 与图片格式还没接。')
}
