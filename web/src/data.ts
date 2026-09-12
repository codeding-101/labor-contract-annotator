import contractTemplateJson from '../../data/templates/liangzihu-420702.json'
import ruleSetJson from '../../rules/labor-contract-law.json'
import laborContractLaw from '../../data/statutes/labor-contract-law.json'
import laborLaw from '../../data/statutes/labor-law.json'
import socialInsuranceLaw from '../../data/statutes/social-insurance-law.json'
import type { StatuteLookup, StatuteRef } from '../../src/rule-engine.ts'
import { ContractTemplateSchema, RiskRuleSetSchema, StatuteSchema } from '../../src/schema.ts'

/**
 * 法条库、范本与规则库都是构建产物（`data/` 不入库），这里在**加载时就用 schema 校验一遍**：
 * 数据有问题就立刻失败，而不是等到出报告时才发现结论不可信。
 */
export const contractTemplate = ContractTemplateSchema.parse(contractTemplateJson)
export const ruleSet = RiskRuleSetSchema.parse(ruleSetJson)

const statuteById = new Map<string, StatuteRef>()
for (const raw of [laborContractLaw, laborLaw, socialInsuranceLaw]) {
  const statute = StatuteSchema.parse(raw)
  for (const article of statute.articles) {
    statuteById.set(article.id, {
      id: article.id,
      lawName: statute.name,
      articleLabel: article.articleLabel,
      text: article.text,
    })
  }
}

export const statuteLookup: StatuteLookup = (id) => statuteById.get(id) ?? null
export const statuteCount = statuteById.size
