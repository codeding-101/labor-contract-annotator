import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractStatute, type ExtractedArticle } from './extract-statute.ts'
import { htmlToBlocks } from './html.ts'
import { normalizeForCompare } from './normalize.ts'
import { SourcesFileSchema } from './schema.ts'

const ROOT = join(import.meta.dirname, '..')

function loadArticles(file: string): Map<number, ExtractedArticle> {
  const raw = readFileSync(join(ROOT, 'sources', file), 'utf8')
  const { articles } = extractStatute(htmlToBlocks(raw))
  return new Map(articles.map((article) => [article.articleNo, article]))
}

/**
 * 逐条对照各来源的条文文本，列出归一化后仍不一致的条文。
 * 交叉校验的价值全在「差异被人看过」这一步，没有对照工具，报出的条号就是死胡同。
 */
function main(): number {
  const lawId = process.argv[2]
  if (lawId === undefined) {
    console.log('用法：npm run diff:sources -- <lawId> [条文号]')
    return 1
  }

  const sourcesFile = SourcesFileSchema.parse(
    JSON.parse(readFileSync(join(ROOT, 'sources', 'sources.json'), 'utf8')),
  )
  const law = sourcesFile.laws[lawId]
  if (law === undefined) {
    console.log(`未声明的法律：${lawId}。可选：${Object.keys(sourcesFile.laws).join(', ')}`)
    return 1
  }

  const sources = law.sources.map((declared) => ({ declared, articles: loadArticles(declared.file) }))

  const allNumbers = new Set<number>()
  for (const source of sources) {
    for (const articleNo of source.articles.keys()) allNumbers.add(articleNo)
  }

  const differing: number[] = []
  for (const articleNo of [...allNumbers].sort((a, b) => a - b)) {
    const normalized = sources.map((source) => {
      const text = source.articles.get(articleNo)?.text
      return text === undefined ? null : normalizeForCompare(text)
    })
    if (!normalized.every((value) => value === normalized[0])) differing.push(articleNo)
  }

  const requested = process.argv[3]
  const targets = requested === undefined ? differing : [Number(requested)]

  if (targets.length === 0) {
    console.log(`全部 ${allNumbers.size} 条在各来源间文字一致。`)
    return 0
  }

  for (const articleNo of targets) {
    console.log(`\n========== 第 ${articleNo} 条 ==========`)
    for (const source of sources) {
      console.log(`--- ${source.declared.id}（${source.declared.publisher}）---`)
      console.log(source.articles.get(articleNo)?.text ?? '<该来源缺失此条>')
    }
  }

  if (requested === undefined) {
    console.log(`\n差异共 ${differing.length} 条：${differing.join(', ')}`)
  }
  return 0
}

process.exitCode = main()
