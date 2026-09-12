import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildTimestamp } from './build-time.ts'
import { extractTemplate } from './extract-template.ts'
import { htmlToBlocks } from './html.ts'
import { FILL, markBlanks } from './mark-blanks.ts'
import { readLegacyDoc } from './read-doc.ts'
import { ContractTemplateSchema, TemplatesFileSchema, type DeclaredTemplate } from './schema.ts'

const ROOT = join(import.meta.dirname, '..')
const GENERATOR = 'src/build-templates.ts'

/**
 * .doc 抽出的纯文本转块。
 * 注意：word-extractor 对段落的还原并不可靠（实测某市范本的"注意事项"各条被连成一行），
 * 所以 .doc 来源的抽取质量低于 HTML 来源。真正接入 .doc 范本时要先验证段落边界。
 */
function plainTextToBlocks(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
}

function loadBlocks(declared: DeclaredTemplate): Promise<string[]> | string[] {
  const path = join(ROOT, 'sources', 'templates', declared.file)
  const raw = readFileSync(path)
  if (declared.format === 'html') return htmlToBlocks(markBlanks(raw.toString('utf8')))
  return readLegacyDoc(path).then(plainTextToBlocks)
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

async function main(): Promise<number> {
  const declaredFile = TemplatesFileSchema.parse(
    JSON.parse(readFileSync(join(ROOT, 'sources', 'templates.json'), 'utf8')),
  )
  const failures: string[] = []
  const outDir = join(ROOT, 'data', 'templates')
  mkdirSync(outDir, { recursive: true })

  for (const [templateId, declared] of Object.entries(declaredFile.templates)) {
    console.log(`\n=== ${declared.name}（${templateId}）===`)
    const path = join(ROOT, 'sources', 'templates', declared.file)
    const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex')
    const blocks = await loadBlocks(declared)
    const result = extractTemplate(blocks)

    const articleCount = result.sections.reduce((sum, section) => sum + section.articles.length, 0)
    const fillCount = countOccurrences(blocks.join('\n'), FILL)

    console.log(
      `  章节 ${result.sections.length}  条文 ${articleCount}  注意事项 ${result.notes.length}  填空位 ${fillCount}  前置块 ${result.frontMatter.length}  尾部块 ${result.trailingBlockCount}`,
    )
    console.log(`  正文结束于：${result.bodyEndBlock ?? '（走到文档末尾）'}`)
    console.log(`  sha256=${sha256.slice(0, 12)}  抽取问题 ${result.issues.length}`)

    for (const issue of result.issues) failures.push(`${templateId}: ${issue}`)
    if (articleCount === 0) failures.push(`${templateId}: 未抽到任何条文`)
    if (result.sections.length === 0) failures.push(`${templateId}: 未抽到任何章节`)

    if (failures.some((failure) => failure.startsWith(`${templateId}: `))) {
      console.log('  存在问题，跳过写出')
      continue
    }

    const template = ContractTemplateSchema.parse({
      templateId,
      name: declared.name,
      regionCode: declared.regionCode,
      regionName: declared.regionName,
      frontMatter: result.frontMatter,
      notes: result.notes,
      sections: result.sections,
      trailing: result.trailing,
      provenance: {
        generatedAt: buildTimestamp(),
        generator: GENERATOR,
        source: { ...declared, sha256, issues: result.issues },
        sectionCount: result.sections.length,
        articleCount,
        fillMarker: FILL,
      },
    })

    writeFileSync(join(outDir, `${templateId}.json`), `${JSON.stringify(template, null, 2)}\n`, 'utf8')
    console.log(`  输出 data/templates/${templateId}.json`)
  }

  if (failures.length > 0) {
    console.log('\n=== 失败项 ===')
    for (const failure of failures) console.log(`  ✗ ${failure}`)
    return 1
  }

  console.log('\n全部断言通过。')
  return 0
}

process.exitCode = await main()
