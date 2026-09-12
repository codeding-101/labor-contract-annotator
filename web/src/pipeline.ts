import { buildReport, type ContractReport } from '../../src/build-report.ts'
import { extractContract } from '../../src/extract-contract.ts'
import { extractFacts } from '../../src/extract-facts.ts'
import { evaluateRules } from '../../src/rule-engine.ts'
import { contractTemplate, ruleSet, statuteLookup } from './data.ts'

export type AnalysisResult = {
  report: ContractReport
  clauseCount: number
  method: 'ARTICLES' | 'PARAGRAPHS'
  skippedBeforeFirstArticle: number
  issues: string[]
}

/**
 * 完整分析链路：合同文本 → 条款 → 事实 → 规则判定 → 报告。
 *
 * 全部纯函数，不碰任何 Node API，所以能原样跑在浏览器里——
 * 这也是"文件不离开设备"能成立的前提。
 *
 * 比对引擎（`diff-template.ts`）不在这条链路里：企业普遍会在范本基础上加自己的制度，
 * 「与官方范本的差异」对求职者没有用，只会把报告淹掉。它现在只作为评测闸门存在
 * （见 `npm run eval:diff`）。
 */
export function analyzeContract(text: string): AnalysisResult {
  const extraction = extractContract(text)
  const facts = extractFacts(extraction.clauses)
  const ruleResult = evaluateRules(ruleSet.rules, extraction.clauses, statuteLookup, facts)

  return {
    report: buildReport({
      template: contractTemplate,
      contractClauses: extraction.clauses,
      facts,
      ruleResult,
      ruleSetVersion: ruleSet.ruleSetVersion,
    }),
    clauseCount: extraction.clauses.length,
    method: extraction.method,
    skippedBeforeFirstArticle: extraction.skippedBeforeFirstArticle,
    issues: extraction.issues,
  }
}
