import type { ContractReport, KeyInfoRow } from './build-report.ts'
import type { RiskLevel } from './schema.ts'

const LEVEL_LABELS: Readonly<Record<RiskLevel, string>> = { red: '🔴 严重', yellow: '🟡 需关注', blue: '🔵 提示' }

function describeRow(row: KeyInfoRow): string {
  if (row.status === 'VALUE') return row.value ?? '—'
  if (row.status === 'MENTIONED') return '有提及（未核对内容）'
  if (row.status === 'NOT_FOUND') return '合同未提及'
  return '未能识别（需人工核对）'
}

/**
 * 把报告渲染成纯文本。
 *
 * 这份渲染同时是"界面看到的内容"的预览：网页端会复用同一份 `ContractReport` 数据，
 * 只是换成卡片与颜色。所以这里也刻意按界面层级排：结论 → 风险 → 无法判定 → 差异 → 关键信息 → 明细。
 */
export function renderReport(report: ContractReport): string {
  const out: string[] = []
  const push = (line = ''): void => void out.push(line)

  push(`劳动合同条款标注`)
  push(`对照范本：${report.template.name}（${report.template.regionName}）`)
  push('='.repeat(64))
  push(
    `共标注 ${report.counts.red + report.counts.yellow + report.counts.blue} 处：严重 ${report.counts.red}　需关注 ${report.counts.yellow}　提示 ${report.counts.blue}　无法判定 ${report.undetermined.length}`,
  )
  push('本工具只把合同里的条款标出来并附上法律条文，不做综合评价，也不替你决定签不签。')
  push()

  if (report.risks.length > 0) {
    push('─'.repeat(64))
    push('标注的条款')
    push()
    for (const risk of report.risks) {
      push(`${LEVEL_LABELS[risk.level]}　${risk.title}`)
      push(`  类别：${risk.category}`)
      push(`  合同原文：${risk.evidence.clauseLabel === null ? '' : `${risk.evidence.clauseLabel}　`}${risk.evidence.text}`)
      push(`  风险说明：${risk.explanation}`)
      if (risk.note !== undefined) push(`  判断依据：${risk.note}`)
      for (const statute of risk.statutes) {
        push(`  法律依据：《${statute.lawName}》${statute.articleLabel}`)
        push(`    ${statute.text}`)
      }
      push(`  建议：${risk.suggestion}`)
      push()
    }
  }

  if (report.undetermined.length > 0) {
    push('─'.repeat(64))
    push('无法判定的事项（不计入标注数，也不等于没问题）')
    push()
    for (const item of report.undetermined) {
      push(`  · ${item.title}（${item.ruleCode}）— ${item.reason}`)
    }
    push()
  }

  push('─'.repeat(64))
  push('关键信息')
  for (const row of report.keyInfo) {
    push(`  ${row.label.padEnd(8, '　')}${describeRow(row)}`)
  }
  push()

  for (const summary of report.summaries) {
    push('─'.repeat(64))
    push(`${summary.title}总结`)
    for (const line of summary.lines) push(`  · ${line}`)
    push()
  }

  push('─'.repeat(64))
  for (const disclaimer of report.disclaimers) push(disclaimer)
  push()
  push(`规则库版本 ${report.versions.ruleSetVersion}　范本 ${report.versions.templateVersion}`)
  push(`生成时间 ${report.versions.generatedAt}`)

  return out.join('\n')
}
