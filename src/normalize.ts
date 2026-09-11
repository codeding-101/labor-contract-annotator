const PUNCTUATION: Readonly<Record<string, string>> = {
  '，': ',',
  '。': '.',
  '；': ';',
  '：': ':',
  '、': ',',
  '（': '(',
  '）': ')',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '《': '<',
  '》': '>',
  '—': '-',
  '－': '-',
  '～': '~',
  '　': '',
}

/**
 * 归一化到「可比对形式」：统一全角标点、去掉所有空白、忽略大小写。
 *
 * 用于跨来源比对。不同官方站点对同一部法律的排版差异主要是全角/半角标点与空格，
 * 归一化后仍存在差异的，才值得人工复核——这正是跨来源校验想要暴露的东西。
 */
export function normalizeForCompare(input: string): string {
  let out = ''
  for (const ch of input) out += PUNCTUATION[ch] ?? ch
  return out.replace(/\s+/g, '').toLowerCase()
}
