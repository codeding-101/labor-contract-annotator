import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { StatuteSchema } from './schema.ts'

const ROOT = join(import.meta.dirname, '..')
const DATA_DIR = join(ROOT, 'data', 'statutes')

function main(): number {
  let files: string[]
  try {
    files = readdirSync(DATA_DIR).filter((file) => file.endsWith('.json'))
  } catch {
    console.log('data/statutes 不存在，请先运行 npm run build:statutes')
    return 1
  }

  if (files.length === 0) {
    console.log('data/statutes 下没有可校验的数据文件')
    return 1
  }

  const failures: string[] = []

  for (const file of files) {
    const statute = StatuteSchema.parse(JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')))
    const numbers = statute.articles.map((article) => article.articleNo)

    const continuous = numbers.every((number, index) => number === index + 1)
    const idsConsistent = statute.articles.every((article) => article.id === `${statute.idPrefix}-${article.articleNo}`)
    const chaptersAssigned = statute.articles.every((article) => article.chapter !== null)

    const staleSnapshots: string[] = []
    for (const source of statute.provenance.sources) {
      const actual = createHash('sha256').update(readFileSync(join(ROOT, 'sources', source.file))).digest('hex')
      if (actual !== source.sha256) staleSnapshots.push(source.file)
    }

    console.log(
      `${statute.shortName.padEnd(8)} 条文 ${String(numbers.length).padStart(3)}  连续=${continuous ? '✓' : '✗'}  ID=${idsConsistent ? '✓' : '✗'}  章节=${chaptersAssigned ? '✓' : '✗'}  快照=${staleSnapshots.length === 0 ? '✓' : '✗'}  ${file}`,
    )

    if (!continuous) failures.push(`${file}: 条号不连续或存在重复`)
    if (!idsConsistent) failures.push(`${file}: 条文 ID 与条号不一致`)
    if (!chaptersAssigned) failures.push(`${file}: 存在未归属章节的条文`)
    for (const stale of staleSnapshots) {
      failures.push(`${file}: 快照 sources/${stale} 内容已变更但与哈希不符，需重新运行 npm run build:statutes`)
    }
  }

  if (failures.length > 0) {
    console.log('\n=== 校验失败 ===')
    for (const failure of failures) console.log(`  ✗ ${failure}`)
    return 1
  }

  console.log('\n数据校验通过。')
  return 0
}

process.exitCode = main()
