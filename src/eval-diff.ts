import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { diffAgainstTemplate, flattenTemplate, type ContractClause, type DiffKind, type TemplateClause } from './diff-template.ts'
import { fillBlanks } from './fill-template.ts'
import { ContractTemplateSchema } from './schema.ts'

const ROOT = join(import.meta.dirname, '..')
const DATA_DIR = join(ROOT, 'data', 'templates')

const ALL_KINDS: DiffKind[] = ['MISSING_IN_CONTRACT', 'EXTRA_IN_CONTRACT', 'MODIFIED', 'BLANK_LEFT']

function contractFrom(templateClauses: TemplateClause[], fill: boolean): ContractClause[] {
  return templateClauses.map((clause) => ({
    sectionTitle: clause.sectionTitle,
    articleNo: clause.articleNo,
    label: clause.articleLabel,
    text: fill ? fillBlanks(clause.text) : clause.text,
  }))
}

type Expectation = {
  counts: Record<DiffKind, number>
  /** 若给定，还要求该分类命中的正是这个范本条文。 */
  targetLabel?: string
  matchedOk?: number
}

type EvalCase = { name: string; contract: ContractClause[]; expect: Expectation }

function zeroCounts(overrides: Partial<Record<DiffKind, number>> = {}): Record<DiffKind, number> {
  const counts = { MISSING_IN_CONTRACT: 0, EXTRA_IN_CONTRACT: 0, MODIFIED: 0, BLANK_LEFT: 0 }
  return { ...counts, ...overrides }
}

function buildCases(templateClauses: TemplateClause[]): EvalCase[] {
  const total = templateClauses.length
  const blankIndex = templateClauses.findIndex((clause) => clause.text.includes('{{FILL}}'))
  const missingIndex = Math.floor(total / 2)
  let modifiedIndex = total - 1
  for (let i = total - 1; i >= 0; i -= 1) {
    if ((templateClauses[i]?.text.length ?? 0) > 40) {
      modifiedIndex = i
      break
    }
  }

  const blankTarget = templateClauses[blankIndex]
  const missingTarget = templateClauses[missingIndex]
  const modifiedTarget = templateClauses[modifiedIndex]

  const cases: EvalCase[] = [
    {
      name: '填空位全部填好',
      contract: contractFrom(templateClauses, true),
      expect: { counts: zeroCounts(), matchedOk: total },
    },
    {
      name: `留空一处（${blankTarget?.articleLabel ?? '-'}）`,
      contract: contractFrom(templateClauses, true).map((clause, index) =>
        index === blankIndex ? { ...clause, text: templateClauses[blankIndex]?.text ?? '' } : clause,
      ),
      expect: { counts: zeroCounts({ BLANK_LEFT: 1 }), targetLabel: blankTarget?.articleLabel },
    },
    {
      name: `删掉一条（${missingTarget?.articleLabel ?? '-'}）`,
      contract: contractFrom(templateClauses, true).filter((_, index) => index !== missingIndex),
      expect: { counts: zeroCounts({ MISSING_IN_CONTRACT: 1 }), targetLabel: missingTarget?.articleLabel },
    },
    {
      name: '多出一条违约金条款',
      contract: [
        ...contractFrom(templateClauses, true),
        {
          sectionTitle: '八、双方约定事项',
          articleNo: 99,
          label: '第九十九条',
          text: '乙方在合同期内提前离职的，应当向甲方支付违约金人民币五万元整。',
        },
      ],
      expect: { counts: zeroCounts({ EXTRA_IN_CONTRACT: 1 }), targetLabel: '第九十九条' },
    },
    {
      name: `改写一条（${modifiedTarget?.articleLabel ?? '-'}）`,
      contract: contractFrom(templateClauses, true).map((clause, index) =>
        index === modifiedIndex
          ? { ...clause, text: '甲乙双方另行约定，本条内容按甲方规章制度执行，不再适用范本表述。' }
          : clause,
      ),
      expect: { counts: zeroCounts({ MODIFIED: 1 }), targetLabel: modifiedTarget?.articleLabel },
    },
  ]

  return cases
}

function countsEqual(actual: Record<DiffKind, number>, expected: Record<DiffKind, number>): boolean {
  return ALL_KINDS.every((kind) => actual[kind] === expected[kind])
}

function describe(counts: Record<DiffKind, number>): string {
  const parts = ALL_KINDS.filter((kind) => counts[kind] > 0).map((kind) => `${kind}×${counts[kind]}`)
  return parts.length === 0 ? '无差异' : parts.join(' ')
}

function main(): number {
  let files: string[]
  try {
    files = readdirSync(DATA_DIR).filter((file) => file.endsWith('.json'))
  } catch {
    console.log('data/templates 不存在，请先运行 npm run build:templates')
    return 1
  }
  if (files.length === 0) {
    console.log('data/templates 下没有范本，先运行 npm run build:templates')
    return 1
  }

  let total = 0
  let passed = 0

  for (const file of files) {
    const template = ContractTemplateSchema.parse(JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')))
    const templateClauses = flattenTemplate(template)
    console.log(`\n=== 比对引擎评测：${template.name}（${file}，范本 ${templateClauses.length} 条）===`)

    for (const evalCase of buildCases(templateClauses)) {
      total += 1
      const result = diffAgainstTemplate(templateClauses, evalCase.contract)
      const countOk = countsEqual(result.counts, evalCase.expect.counts)
      const matchedOk = evalCase.expect.matchedOk === undefined || result.matchedOk === evalCase.expect.matchedOk

      let targetOk = true
      if (evalCase.expect.targetLabel !== undefined) {
        const targetKind = ALL_KINDS.find((kind) => evalCase.expect.counts[kind] === 1)
        // 目标条文的标签在范本侧还是合同侧取决于分类：缺失项只有范本标签，多余项只有合同标签。
        targetOk = result.items.some(
          (item) =>
            item.kind === targetKind &&
            (item.templateLabel === evalCase.expect.targetLabel || item.contractLabel === evalCase.expect.targetLabel),
        )
      }

      const ok = countOk && matchedOk && targetOk
      if (ok) passed += 1

      const expectation = `期望 ${describe(evalCase.expect.counts)}`
      const actual = `${describe(result.counts)}${evalCase.expect.matchedOk !== undefined ? ` / 对上 ${result.matchedOk}` : ''}`
      console.log(`  ${ok ? '✓' : '✗'} ${evalCase.name.padEnd(22)} ${expectation.padEnd(26)} 实际 ${actual}`)

      if (!ok) {
        for (const item of result.items) {
          console.log(`      ${item.kind}  范本=${item.templateLabel ?? '-'}  合同=${item.contractLabel ?? '-'}  对齐=${item.matchMethod}`)
        }
      }
    }
  }

  console.log(`\n评测通过 ${passed}/${total}`)
  return passed === total ? 0 : 1
}

process.exitCode = main()
