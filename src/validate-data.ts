import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cnToInt } from './cn-number.ts'
import { ContractTemplateSchema, RiskRuleSetSchema, StatuteSchema } from './schema.ts'

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

/**
 * 规则库校验。这里强制一条项目底线：**规则引用的法条 ID 必须真实存在**。
 * 规则里不复制条文原文，报告用哪条就从法条库取哪条，取不到就不允许存在这条规则。
 */
function validateRules(failures: string[]): void {
  const rulesDir = join(ROOT, 'rules')
  let files: string[]
  try {
    files = readdirSync(rulesDir).filter((file) => file.endsWith('.json'))
  } catch {
    failures.push('rules/ 目录不存在')
    return
  }
  if (files.length === 0) {
    failures.push('rules/ 下没有规则文件')
    return
  }

  const statutesDir = join(ROOT, 'data', 'statutes')
  const knownIds = new Set<string>()
  for (const file of readdirSync(statutesDir).filter((name) => name.endsWith('.json'))) {
    const statute = StatuteSchema.parse(JSON.parse(readFileSync(join(statutesDir, file), 'utf8')))
    for (const article of statute.articles) knownIds.add(article.id)
  }

  for (const file of files) {
    const ruleSet = RiskRuleSetSchema.parse(JSON.parse(readFileSync(join(rulesDir, file), 'utf8')))
    const missing: string[] = []
    let caseCount = 0

    for (const rule of ruleSet.rules) {
      caseCount += rule.cases.length
      for (const id of rule.statuteRefs) {
        if (!knownIds.has(id)) missing.push(`${rule.code} → ${id}`)
      }
    }

    const codes = ruleSet.rules.map((rule) => rule.code)
    const duplicated = codes.filter((code, index) => codes.indexOf(code) !== index)
    const enabled = ruleSet.rules.filter((rule) => rule.enabled).length
    const thin = ruleSet.rules.filter((rule) => rule.cases.length < 2).map((rule) => rule.code)

    console.log(
      `${file}  v${ruleSet.ruleSetVersion}  规则 ${ruleSet.rules.length}（启用 ${enabled}）  用例 ${caseCount}  法条引用缺失 ${missing.length}`,
    )

    for (const item of missing) failures.push(`${file}: 规则引用了法条库里不存在的条文 ${item}`)
    for (const code of duplicated) failures.push(`${file}: 规则 code 重复 ${code}`)
    for (const code of thin) failures.push(`${file}: 规则 ${code} 的正反例少于 2 条`)
  }
}

function main(): number {
  const failures: string[] = []
  validateStatutes(failures)
  validateTemplates(failures)
  validateRules(failures)

  if (failures.length > 0) {
    console.log('\n=== 校验失败 ===')
    for (const failure of failures) console.log(`  ✗ ${failure}`)
    return 1
  }

  console.log('\n数据校验通过。')
  return 0
}

process.exitCode = main()
