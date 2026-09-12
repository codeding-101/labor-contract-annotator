import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StatuteLookup, StatuteRef } from './rule-engine.ts'
import { StatuteSchema } from './schema.ts'

const ROOT = join(import.meta.dirname, '..')

/**
 * 载入法条库，返回按 ID 查询的 lookup。
 *
 * 引擎只接受这种 lookup 取条文原文——规则里不复制条文，报告要展示哪条就取哪条；
 * 取不到时引擎会抛错，不会放过没有依据的风险项。
 */
export function loadStatutes(): { lookup: StatuteLookup; ids: Set<string> } {
  const dir = join(ROOT, 'data', 'statutes')
  const byId = new Map<string, StatuteRef>()

  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const statute = StatuteSchema.parse(JSON.parse(readFileSync(join(dir, file), 'utf8')))
    for (const article of statute.articles) {
      byId.set(article.id, {
        id: article.id,
        lawName: statute.name,
        articleLabel: article.articleLabel,
        text: article.text,
      })
    }
  }

  return { lookup: (id) => byId.get(id) ?? null, ids: new Set(byId.keys()) }
}
