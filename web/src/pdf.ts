import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { assessExtractedText, groupTextItems, type TextItemLike } from '../../src/text-lines.ts'

// 走 Vite 处理后的 worker 地址：解析在独立线程里跑，不阻塞界面
GlobalWorkerOptions.workerSrc = workerUrl

export type PdfExtraction = {
  text: string
  pageCount: number
  /** 是否提取到足够的文字。扫描件、拍照生成的 PDF 没有文字层，这里就是 false。 */
  hasTextLayer: boolean
}

/** 少于这么多字符就认为没有文字层，而不是"这份合同很短"。 */
const MIN_TEXT_LENGTH = 50

/**
 * 从 PDF 里提取文字。
 *
 * 只处理**带文字层**的 PDF（电子合同、导出的 PDF 基本都是）。
 * 扫描件与拍照生成的 PDF 里只有图像，浏览器端没有可靠的免费方案能读出中文条款；
 * 这时必须让用户知道"读不出来"，而不是给出一段空文本让他以为分析过了。
 */
export async function extractPdfText(data: ArrayBuffer): Promise<PdfExtraction> {
  const document = await getDocument({ data }).promise
  const lines: string[] = []

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    const items: TextItemLike[] = content.items.map((item) => ({
      str: 'str' in item ? item.str : '',
      transform: 'transform' in item ? item.transform : [],
    }))
    lines.push(...groupTextItems(items))
  }

  // 不只看长度：字体缺 ToUnicode 映射、或字形被映射到控制字符区间（大量 SOH）时，
  // 字符数看着够但内容全错。这类文件本地无从还原，宁可报「读不出来」，
  // 也不给一份满是错字的报告。评估时会顺手剥掉控制字符。
  const assessed = assessExtractedText(lines.join('\n'), 0.4, MIN_TEXT_LENGTH)
  return { text: assessed.text, pageCount: document.numPages, hasTextLayer: assessed.usable }
}
