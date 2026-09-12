import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { groupTextItems, type TextItemLike } from '../../src/text-lines.ts'

// 走 Vite 处理后的 worker 地址：解析在独立线程里跑，不阻塞界面
GlobalWorkerOptions.workerSrc = workerUrl

export type DocumentExtraction = {
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
export async function extractPdfText(data: ArrayBuffer): Promise<DocumentExtraction> {
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

  const text = lines.join('\n')
  return { text, pageCount: document.numPages, hasTextLayer: text.trim().length >= MIN_TEXT_LENGTH }
}
