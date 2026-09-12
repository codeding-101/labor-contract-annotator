import { createRequire } from 'node:module'

// word-extractor 没有类型声明。这里只声明用到的最小接口，避免把 any 扩散到调用方。
type WordDocument = { getBody(): string }
type WordExtractorConstructor = new () => { extract(filePath: string): Promise<WordDocument> }

const require = createRequire(import.meta.url)
const WordExtractor = require('word-extractor') as WordExtractorConstructor

/**
 * 读取 Word 97-2003 二进制 .doc 的正文文本。
 *
 * 中国各级政府发布的劳动合同示范文本绝大多数是这种格式（不是 .docx，也不是网页正文），
 * 纯 JS 实现，不依赖本机装 Word 或 LibreOffice，保证管线可复现。
 */
export async function readLegacyDoc(filePath: string): Promise<string> {
  const document = await new WordExtractor().extract(filePath)
  return document.getBody()
}
