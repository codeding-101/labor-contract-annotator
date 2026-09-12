import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { diffAgainstTemplate, flattenTemplate, type ContractClause, type DiffKind, type TemplateClause } from './diff-template.ts'
import { extractFacts, FACT_META, type FactKey } from './extract-facts.ts'
import { fillBlanks } from './fill-template.ts'
import { buildReport, type ContractReport } from './build-report.ts'
import { evaluateRules } from './rule-engine.ts'
import { loadStatutes } from './load-statutes.ts'
import { ContractTemplateSchema, RiskRuleSetSchema } from './schema.ts'

const ROOT = join(import.meta.dirname, '..')
const DATA_DIR = join(ROOT, 'data', 'templates')

const ALL_KINDS: DiffKind[] = ['MISSING_IN_CONTRACT', 'EXTRA_IN_CONTRACT', 'MODIFIED', 'BLANK_LEFT']

function annotated(report: ContractReport): number {
  return report.counts.red + report.counts.yellow + report.counts.blue
}

/**
 * 范本里写明了数额或期限、因此**必须**取出值的关键信息项。
 * 不在这里的项落到「仅提及」是正常的，报告会把原文摘出来让人自行核对：
 * 例如范本只说「依法享有…带薪年休假…等假期」而没给天数，工资构成里的基本工资/绩效工资
 * 只出现在没被选中的发放方式里——这些都不该当成值报出来。
 */
const MUST_HAVE_VALUE: readonly string[] = [
  '合同期限',
  '试用期',
  '约定月工资',
  '试用期工资',
  '发薪日期',
  '每日工作时间',
]

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
  const problems: string[] = []

  for (const file of files) {
    const template = ContractTemplateSchema.parse(JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')))
    const templateClauses = flattenTemplate(template)
    console.log(`\n=== 比对引擎评测：${template.name}（${file}，范本 ${templateClauses.length} 条）===`)

    // 顺手确认事实抽取在**真实范本数据**上能跑通，而不是只在我手写的测试夹具上。
    // 这里不校验具体数值（范本会更新），只要求：该抽出来的不能是"未识别"。
    const sampleContract = contractFrom(templateClauses, true)
    const sampleFacts = extractFacts(sampleContract)
    const factKeys: FactKey[] = ['contractTermMonths', 'probationMonths', 'monthlyWage', 'probationMonthlyWage']
    console.log(
      `  事实抽取（示例合同）：${factKeys
        .map((key) => `${FACT_META[key].label}=${sampleFacts[key].value ?? `未识别（${sampleFacts[key].reason ?? ''}）`}`)
        .join('  ')}`,
    )
    for (const key of factKeys) {
      if (sampleFacts[key].value === null) {
        problems.push(`${file}: 真实范本数据上没能抽出「${FACT_META[key].label}」`)
      }
    }

    // 官方范本本身应当是合规的，规则在它身上不该报出任何风险项。
    // 报出来就说明关键词放宽过头、产生了误报——这是防止"修漏报反手制造误报"的闸门。
    const ruleSet = RiskRuleSetSchema.parse(
      JSON.parse(readFileSync(join(ROOT, 'rules', 'labor-contract-law.json'), 'utf8')),
    )
    const ruleResult = evaluateRules(ruleSet.rules, sampleContract, loadStatutes().lookup, sampleFacts)
    console.log(
      `  规则跑在示例合同上：风险项 ${ruleResult.findings.length}  无法判定 ${ruleResult.undetermined.length}`,
    )
    if (ruleResult.findings.length > 0) {
      problems.push(
        `${file}: 规则在官方范本上报出了 ${ruleResult.findings.length} 条风险（应为 0，疑似误报）：${ruleResult.findings.map((finding) => finding.ruleCode).join('、')}`,
      )
      for (const finding of ruleResult.findings) {
        console.log(`      ${finding.ruleCode}  证据：${finding.evidence.text.slice(0, 60)}`)
      }
    }

    // 报告层闸门：合规范本派生的合同不应有任何标注，且关键信息要真的取出值来。
    const sampleReport = buildReport({
      template,
      contractClauses: sampleContract,
      facts: sampleFacts,
      ruleResult,
      ruleSetVersion: ruleSet.ruleSetVersion,
    })
    const valued = sampleReport.keyInfo.filter((row) => row.status === 'VALUE' || row.status === 'TEXT').length
    const mentioned = sampleReport.keyInfo.filter((row) => row.status === 'MENTIONED')
    const missing = sampleReport.keyInfo.filter((row) => row.status === 'NOT_FOUND').length
    console.log(
      `  报告层：标注 ${annotated(sampleReport)} 处  无法判定 ${sampleReport.undetermined.length}  关键信息取值 ${valued} 项、仅提及 ${mentioned.length} 项、未提及 ${missing} 项`,
    )
    if (annotated(sampleReport) > 0) {
      problems.push(`${file}: 官方范本派生的合同不应有任何标注（应为 0，疑似误报），实际 ${annotated(sampleReport)} 处`)
    }
    // 范本里写明了数额/期限、却被判成"仅提及"的项，说明抽取规则在真实范本文本上失效了。
    const required = sampleReport.keyInfo.filter((row) => MUST_HAVE_VALUE.includes(row.label) && row.status !== 'VALUE')
    if (required.length > 0) {
      problems.push(
        `${file}: 范本里写明了这些项，却没能取出值：${required.map((row) => `${row.label}（${row.status}）`).join('、')}`,
      )
    }
    for (const row of mentioned) {
      console.log(`      仅提及：${row.label}——${(row.evidence ?? '').slice(0, 50)}`)
    }

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
  if (problems.length > 0) {
    console.log('\n=== 其他问题 ===')
    for (const problem of problems) console.log(`  ✗ ${problem}`)
  }
  return passed === total && problems.length === 0 ? 0 : 1
}

process.exitCode = main()
