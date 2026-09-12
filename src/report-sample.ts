import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildReport, type ContractReport } from './build-report.ts'
import { diffAgainstTemplate, flattenTemplate, type ContractClause } from './diff-template.ts'
import { extractFacts } from './extract-facts.ts'
import { fillBlanks } from './fill-template.ts'
import { loadStatutes } from './load-statutes.ts'
import { evaluateRules } from './rule-engine.ts'
import { renderReport } from './render-report.ts'
import { ContractTemplateSchema, RiskRuleSetSchema } from './schema.ts'

const ROOT = join(import.meta.dirname, '..')
const TEMPLATE_ID = 'liangzihu-420702'

/** 造一份"填好的合同"：把范本的填空位填上示例值。 */
function filledContract(): { clauses: ContractClause[]; templateClauses: ReturnType<typeof flattenTemplate> } {
  const template = ContractTemplateSchema.parse(
    JSON.parse(readFileSync(join(ROOT, 'data', 'templates', `${TEMPLATE_ID}.json`), 'utf8')),
  )
  const templateClauses = flattenTemplate(template)
  return {
    templateClauses,
    clauses: templateClauses.map((clause) => ({
      sectionTitle: clause.sectionTitle,
      articleNo: clause.articleNo,
      label: clause.articleLabel,
      text: fillBlanks(clause.text),
    })),
  }
}

function reportFor(clauses: ContractClause[], templateClauses: ReturnType<typeof flattenTemplate>): ContractReport {
  const template = ContractTemplateSchema.parse(
    JSON.parse(readFileSync(join(ROOT, 'data', 'templates', `${TEMPLATE_ID}.json`), 'utf8')),
  )
  const ruleSet = RiskRuleSetSchema.parse(
    JSON.parse(readFileSync(join(ROOT, 'rules', 'labor-contract-law.json'), 'utf8')),
  )
  const facts = extractFacts(clauses)
  const diff = diffAgainstTemplate(templateClauses, clauses)
  const ruleResult = evaluateRules(ruleSet.rules, clauses, loadStatutes().lookup, facts)
  return buildReport({
    template,
    contractClauses: clauses,
    diff,
    facts,
    ruleResult,
    ruleSetVersion: ruleSet.ruleSetVersion,
  })
}

/** 往"合规"的示例合同里塞三条典型问题条款，用来看风险路径的输出长什么样。 */
const INJECTED: ContractClause[] = [
  {
    sectionTitle: '八、双方约定事项',
    articleNo: 98,
    label: '第九十八条',
    text: '乙方在合同期内提前离职的，应当向甲方支付违约金人民币五万元。',
  },
  {
    sectionTitle: '五、社会保险和福利待遇',
    articleNo: 99,
    label: '第九十九条',
    text: '乙方自愿放弃社会保险，甲方将相应费用随工资发放。',
  },
  {
    sectionTitle: '四、劳动报酬',
    articleNo: 100,
    label: '第一百条',
    text: '乙方对工资发放数额如有异议应在3日内书面提出，未在该期间内提出书面异议的，均视为本月劳动报酬均已结清没有异议。',
  },
]

function main(): number {
  const { clauses, templateClauses } = filledContract()

  const clean = reportFor(clauses, templateClauses)
  console.log(renderReport(clean))

  console.log('\n\n')
  const risky = reportFor([...clauses, ...INJECTED], templateClauses)
  console.log(renderReport(risky))

  const problems: string[] = []
  const cleanCounts = clean.counts.red + clean.counts.yellow + clean.counts.blue
  if (cleanCounts !== 0) problems.push(`官方范本派生的示例合同不应有任何标注，实际 ${cleanCounts} 处`)
  if (risky.risks.length !== INJECTED.length) {
    problems.push(`注入的 ${INJECTED.length} 条问题条款应全部标出，实际 ${risky.risks.length} 条`)
  }

  if (problems.length > 0) {
    console.log('\n=== 问题 ===')
    for (const problem of problems) console.log(`  ✗ ${problem}`)
    return 1
  }
  console.log('\n示例报告自检通过。')
  return 0
}

process.exitCode = main()
