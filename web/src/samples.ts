import { flattenTemplate } from '../../src/diff-template.ts'
import { fillBlanks } from '../../src/fill-template.ts'
import { contractTemplate } from './data.ts'

const clauses = flattenTemplate(contractTemplate)

/** 合规示例：拿官方范本填空生成，用来演示"零风险"是什么样。 */
export const cleanSampleText = clauses
  .map((clause) => `${clause.articleLabel} ${fillBlanks(clause.text)}`)
  .join('\n')

/**
 * 可疑示例：在合规示例之后追加三条**取自真实案例**的问题条款
 * ——违法违约金、约定放弃社保、工资异议期，正好覆盖三类不同的风险。
 */
export const riskySampleText = [
  cleanSampleText,
  '第九十八条 乙方在合同期内提前离职的，应当向甲方支付违约金人民币五万元。',
  '第九十九条 乙方自愿放弃社会保险，甲方将相应费用随工资发放。',
  '第一百条 乙方对工资发放数额如有异议应在3日内书面提出，未在该期间内提出书面异议的，均视为本月劳动报酬均已结清没有异议。',
].join('\n')
