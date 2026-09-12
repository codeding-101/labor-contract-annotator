import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildTimestamp } from './build-time.ts'
import { extractCases } from './extract-cases.ts'
import { htmlToBlocks } from './html.ts'
import { CaseDocSchema, CaseDocsFileSchema } from './schema.ts'

const ROOT = join(import.meta.dirname, '..')
const GENERATOR = 'src/build-cases.ts'

function main(): number {
  const declared = CaseDocsFileSchema.parse(
    JSON.parse(readFileSync(join(ROOT, 'sources', 'cases.json'), 'utf8')),
  )
  const failures: string[] = []
  const outDir = join(ROOT, 'data', 'cases')
  mkdirSync(outDir, { recursive: true })

  for (const [docId, doc] of Object.entries(declared.caseDocs)) {
    console.log(`\n=== ${doc.name}（${docId}）===`)
    const path = join(ROOT, 'sources', 'cases', doc.file)
    const raw = readFileSync(path)
    const sha256 = createHash('sha256').update(raw).digest('hex')
    const { cases, issues } = extractCases(htmlToBlocks(raw.toString('utf8')))

    console.log(`  案例 ${cases.length} 个  抽取问题 ${issues.length}  sha256=${sha256.slice(0, 12)}`)
    for (const item of cases) {
      console.log(`    ${item.caseNo}  案情 ${String(item.basicFacts.length).padStart(4)} 字  ${item.title.slice(0, 40)}…`)
    }

    for (const issue of issues) failures.push(`${docId}: ${issue}`)
    if (cases.length === 0) failures.push(`${docId}: 未抽到任何案例`)

    if (failures.some((failure) => failure.startsWith(`${docId}: `))) {
      console.log('  存在问题，跳过写出')
      continue
    }

    const built = CaseDocSchema.parse({
      docId,
      name: doc.name,
      publisher: doc.publisher,
      publishDate: doc.publishDate,
      cases: cases.map((item) => ({ id: `${docId}-C${item.ordinal}`, ...item })),
      provenance: {
        generatedAt: buildTimestamp(),
        generator: GENERATOR,
        source: { ...doc, sha256, issues },
      },
    })

    writeFileSync(join(outDir, `${docId}.json`), `${JSON.stringify(built, null, 2)}\n`, 'utf8')
    console.log(`  输出 data/cases/${docId}.json`)
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
