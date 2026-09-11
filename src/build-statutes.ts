import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractStatute, type ExtractedArticle } from './extract-statute.ts'
import { htmlToBlocks } from './html.ts'
import { normalizeForCompare } from './normalize.ts'
import { SourcesFileSchema, StatuteSchema, type DeclaredSource } from './schema.ts'

const ROOT = join(import.meta.dirname, '..')
const GENERATOR = 'src/build-statutes.ts'

type IngestedSource = {
  declared: DeclaredSource
  sha256: string
  articles: ExtractedArticle[]
  preamble: string[]
  preambleBlockCount: number
  trailingBoundary: string | null
  issues: string[]
}

function ingest(declared: DeclaredSource): IngestedSource {
  const raw = readFileSync(join(ROOT, 'sources', declared.file))
  const sha256 = createHash('sha256').update(raw).digest('hex')
  const { articles, preamble, preambleBlockCount, trailingBoundary, issues } = extractStatute(
    htmlToBlocks(raw.toString('utf8')),
  )
  return { declared, sha256, articles, preamble, preambleBlockCount, trailingBoundary, issues }
}

function lastArticleNo(articles: ExtractedArticle[]): number | null {
  const last = articles.at(-1)
  return last === undefined ? null : last.articleNo
}

type CrossCheck = { compared: number; identical: number; differing: number[] }

function crossCheckAgainst(primary: ExtractedArticle[], other: ExtractedArticle[]): CrossCheck {
  const byNumber = new Map(other.map((article) => [article.articleNo, article]))
  const differing: number[] = []
  let identical = 0

  for (const article of primary) {
    const counterpart = byNumber.get(article.articleNo)
    if (counterpart !== undefined && normalizeForCompare(counterpart.text) === normalizeForCompare(article.text)) {
      identical += 1
    } else {
      differing.push(article.articleNo)
    }
  }

  return { compared: primary.length, identical, differing }
}

function main(): number {
  const sourcesFile = SourcesFileSchema.parse(
    JSON.parse(readFileSync(join(ROOT, 'sources', 'sources.json'), 'utf8')),
  )
  const failures: string[] = []
  const warnings: string[] = []
  const outDir = join(ROOT, 'data', 'statutes')
  mkdirSync(outDir, { recursive: true })

  for (const [lawId, law] of Object.entries(sourcesFile.laws)) {
    console.log(`\n=== ${law.name}（${lawId}）===`)
    const ingested = law.sources.map(ingest)
    const lawFailures: string[] = []

    for (const source of ingested) {
      const total = source.articles.length
      const lastNo = lastArticleNo(source.articles)
      const continuous = total > 0 && lastNo === total
      const isPrimary = source.declared.role === 'primary'
      const label = `${lawId}/${source.declared.id}`

      console.log(
        `  ${isPrimary ? '主来源  ' : '交叉来源'} ${source.declared.id.padEnd(6)} 条文 ${String(total).padStart(3)}  末条号 ${String(lastNo ?? '-').padStart(3)}  连续=${continuous ? '✓' : '✗'}  前言 ${source.preamble.length}/${source.preambleBlockCount} 段  抽取问题 ${source.issues.length}  sha256=${source.sha256.slice(0, 12)}`,
      )

      if (source.trailingBoundary !== null) {
        console.log(`    正文在页脚处收尾：${source.trailingBoundary.slice(0, 80)}`)
      }

      if (isPrimary) {
        if (total === 0) lawFailures.push(`${label}: 未抽到任何条文`)
        if (!continuous) lawFailures.push(`${label}: 条号不连续（共 ${total} 条，末条号为 ${lastNo ?? '无'}）`)
        for (const issue of source.issues) lawFailures.push(`${label}: ${issue}`)
      } else {
        // 交叉来源不要求干净：它存在的意义就是暴露主来源的问题，自身缺陷只提示不阻断。
        if (total === 0) warnings.push(`${label}: 未抽到任何条文`)
        for (const issue of source.issues) warnings.push(`${label}: ${issue}`)
      }
    }

    const primary = ingested.find((source) => source.declared.role === 'primary')
    if (primary === undefined) {
      failures.push(`${lawId}: 未声明 primary 来源`)
      continue
    }

    let crossCheck: CrossCheck = { compared: primary.articles.length, identical: 0, differing: [] }
    for (const other of ingested) {
      if (other === primary) continue
      if (other.articles.length !== primary.articles.length) {
        console.log(
          `  提示：来源条数不一致 主来源=${primary.articles.length} ${other.declared.id}=${other.articles.length}`,
        )
      }
      crossCheck = crossCheckAgainst(primary.articles, other.articles)
      console.log(
        `  交叉校验 ${primary.declared.id} vs ${other.declared.id}：${crossCheck.identical}/${crossCheck.compared} 条文字一致，差异 ${crossCheck.differing.length} 条`,
      )
      if (crossCheck.differing.length > 0) {
        console.log(`    差异条号：${crossCheck.differing.join(', ')}`)
      }
    }

    if (lawFailures.length > 0) {
      failures.push(...lawFailures)
      console.log('  存在问题，跳过写出')
      continue
    }

    const statute = StatuteSchema.parse({
      lawId,
      name: law.name,
      shortName: law.shortName,
      idPrefix: law.idPrefix,
      preamble: primary.preamble,
      articles: primary.articles.map((article) => ({
        id: `${law.idPrefix}-${article.articleNo}`,
        articleNo: article.articleNo,
        articleLabel: article.articleLabel,
        chapter: article.chapter,
        section: article.section,
        text: article.text,
      })),
      provenance: {
        generatedAt: new Date().toISOString(),
        generator: GENERATOR,
        sources: ingested.map((source) => ({
          ...source.declared,
          sha256: source.sha256,
          issues: source.issues,
          preambleBlockCount: source.preambleBlockCount,
          trailingBoundary: source.trailingBoundary,
        })),
        crossCheck,
      },
    })

    writeFileSync(join(outDir, `${lawId}.json`), `${JSON.stringify(statute, null, 2)}\n`, 'utf8')
    console.log(`  输出 data/statutes/${lawId}.json`)
  }

  if (warnings.length > 0) {
    console.log('\n=== 提示（不阻断）===')
    for (const warning of warnings) console.log(`  ! ${warning}`)
  }

  if (failures.length > 0) {
    console.log('\n=== 失败项 ===')
    for (const failure of failures) console.log(`  ✗ ${failure}`)
    return 1
  }

  console.log('\n全部断言通过。')
  return 0
}

process.exitCode = main()
