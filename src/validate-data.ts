import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cnToInt } from './cn-number.ts'
import { ContractTemplateSchema, StatuteSchema } from './schema.ts'

const ROOT = join(import.meta.dirname, '..')

function snapshotHash(file: string): string {
  return createHash('sha256').update(readFileSync(join(ROOT, 'sources', file))).digest('hex')
}

function readJsonFiles(dir: string, failures: string[], hint: string): string[] {
  try {
    const files = readdirSync(dir).filter((file) => file.endsWith('.json'))
    if (files.length === 0) failures.push(`${dir} 下没有数据文件（${hint}）`)
    return files
  } catch {
    failures.push(`${dir} 不存在，请先运行 ${hint}`)
    return []
  }
}

function validateStatutes(failures: string[]): void {
  const dir = join(ROOT, 'data', 'statutes')
  for (const file of readJsonFiles(dir, failures, 'npm run build:statutes')) {
    const statute = StatuteSchema.parse(JSON.parse(readFileSync(join(dir, file), 'utf8')))
    const numbers = statute.articles.map((article) => article.articleNo)

    const continuous = numbers.every((number, index) => number === index + 1)
    const idsConsistent = statute.articles.every((article) => article.id === `${statute.idPrefix}-${article.articleNo}`)
    const chaptersAssigned = statute.articles.every((article) => article.chapter !== null)
    const stale: string[] = []
    for (const source of statute.provenance.sources) {
      if (snapshotHash(source.file) !== source.sha256) stale.push(source.file)
    }

    console.log(
      `${statute.shortName.padEnd(8)} 条文 ${String(numbers.length).padStart(3)}  连续=${continuous ? '✓' : '✗'}  ID=${idsConsistent ? '✓' : '✗'}  章节=${chaptersAssigned ? '✓' : '✗'}  快照=${stale.length === 0 ? '✓' : '✗'}  ${file}`,
    )

    if (!continuous) failures.push(`${file}: 条号不连续或存在重复`)
    if (!idsConsistent) failures.push(`${file}: 条文 ID 与条号不一致`)
    if (!chaptersAssigned) failures.push(`${file}: 存在未归属章节的条文`)
    for (const file2 of stale) failures.push(`${file}: 快照 sources/${file2} 已变更但与哈希不符，需重新构建`)
  }
}

function validateTemplates(failures: string[]): void {
  const dir = join(ROOT, 'data', 'templates')
  for (const file of readJsonFiles(dir, failures, 'npm run build:templates')) {
    const template = ContractTemplateSchema.parse(JSON.parse(readFileSync(join(dir, file), 'utf8')))

    const articles = template.sections.flatMap((section) => section.articles)
    const numbers = articles.map((article) => article.articleNo)
    const continuous = numbers.every((number, index) => number === index + 1)
    const labelsConsistent = articles.every((article) => {
      const digits = article.articleLabel.replace(/^第/, '').replace(/条$/, '')
      return cnToInt(digits) === article.articleNo
    })
    const countsMatch =
      template.provenance.sectionCount === template.sections.length &&
      template.provenance.articleCount === articles.length
    const emptySections = template.sections.filter((section) => section.articles.length === 0).length === 0
    const stale = snapshotHash(`templates/${template.provenance.source.file}`) !== template.provenance.source.sha256

    console.log(
      `${template.name.padEnd(10)} 章节 ${String(template.sections.length).padStart(2)}  条文 ${String(articles.length).padStart(3)}  连续=${continuous ? '✓' : '✗'}  标签=${labelsConsistent ? '✓' : '✗'}  计数=${countsMatch ? '✓' : '✗'}  空节=${emptySections ? '✓' : '✗'}  快照=${stale ? '✗' : '✓'}  ${file}`,
    )

    if (!continuous) failures.push(`${file}: 条文号不连续或存在重复`)
    if (!labelsConsistent) failures.push(`${file}: 条文标签与条号不一致`)
    if (!countsMatch) failures.push(`${file}: provenance 里的章节/条文计数与实际不符`)
    if (!emptySections) failures.push(`${file}: 存在没有任何条文的章节`)
    if (stale) failures.push(`${file}: 快照 sources/templates/${template.provenance.source.file} 已变更但与哈希不符，需重新构建`)
  }
}

function main(): number {
  const failures: string[] = []
  validateStatutes(failures)
  validateTemplates(failures)

  if (failures.length > 0) {
    console.log('\n=== 校验失败 ===')
    for (const failure of failures) console.log(`  ✗ ${failure}`)
    return 1
  }

  console.log('\n数据校验通过。')
  return 0
}

process.exitCode = main()
