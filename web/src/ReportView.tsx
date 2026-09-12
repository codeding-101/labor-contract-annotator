import type { ContractReport } from '../../src/build-report.ts'

const LEVEL_LABEL: Record<string, string> = { red: '严重', yellow: '需关注', blue: '提示' }

const DIFF_LABEL: Record<string, string> = {
  MISSING_IN_CONTRACT: '范本有、合同没有',
  EXTRA_IN_CONTRACT: '范本没有、合同多了',
  MODIFIED: '关键条款被改写',
  BLANK_LEFT: '填空处留白',
}

function scoreTone(score: number): string {
  if (score >= 85) return 'good'
  if (score >= 60) return 'warn'
  return 'bad'
}

function describeKeyInfo(status: string, value: string | null): string {
  if (status === 'VALUE') return value ?? '—'
  if (status === 'MENTIONED') return '有提及（未核对内容）'
  if (status === 'NOT_FOUND') return '合同未提及'
  return '未能识别（需人工核对）'
}

export function ReportView({ report }: { report: ContractReport }): React.ReactElement {
  const diffTotal = Object.values(report.diffs.counts).reduce((sum, value) => sum + value, 0)

  return (
    <div className="report">
      <section className="card score-card">
        <div className={`score ${scoreTone(report.score.score)}`}>
          <span className="score-number">{report.score.score}</span>
          <span className="score-total">/ 100</span>
        </div>
        <div className="score-side">
          <p className="recommendation">{report.recommendation}</p>
          <div className="counts">
            <span className="chip red">严重 {report.counts.red}</span>
            <span className="chip yellow">需关注 {report.counts.yellow}</span>
            <span className="chip blue">提示 {report.counts.blue}</span>
            <span className="chip muted">无法判定 {report.score.undeterminedCount}</span>
          </div>
        </div>
      </section>

      {report.score.capped && <p className="notice">⚠ {report.score.capReason}</p>}

      {report.score.deductions.length > 0 && (
        <details className="card details">
          <summary>评分明细（{report.score.deductions.length} 项扣分）</summary>
          <ul className="plain">
            {report.score.deductions.map((item) => (
              <li key={item.ruleCode}>
                − {item.deduction} · {item.title}
              </li>
            ))}
          </ul>
          <p className="muted">
            分数 = 100 − 各项扣分之和（下限 0）。评分只反映本工具检查项的命中情况，不代表对这份合同的法律评价。
          </p>
        </details>
      )}

      {report.risks.length > 0 && (
        <section>
          <h2>风险事项</h2>
          {report.risks.map((risk) => (
            <article key={risk.ruleCode} className={`card risk ${risk.level}`}>
              <header>
                <span className={`badge ${risk.level}`}>{LEVEL_LABEL[risk.level] ?? risk.level}</span>
                <h3>{risk.title}</h3>
                <span className="category">{risk.category}</span>
              </header>
              <dl>
                <dt>合同原文</dt>
                <dd className="quote">
                  {risk.evidence.clauseLabel !== null && <span className="clause">{risk.evidence.clauseLabel}</span>}
                  {risk.evidence.text}
                </dd>
                <dt>风险说明</dt>
                <dd>{risk.explanation}</dd>
                {risk.note !== undefined && (
                  <>
                    <dt>判断依据</dt>
                    <dd>{risk.note}</dd>
                  </>
                )}
                <dt>法律依据</dt>
                {risk.statutes.map((statute) => (
                  <dd key={statute.id} className="statute">
                    <span className="law">
                      《{statute.lawName}》{statute.articleLabel}
                    </span>
                    <span className="statute-text">{statute.text}</span>
                  </dd>
                ))}
                <dt>建议</dt>
                <dd>{risk.suggestion}</dd>
              </dl>
            </article>
          ))}
        </section>
      )}

      {report.undetermined.length > 0 && (
        <section>
          <h2>无法判定的事项</h2>
          <p className="muted">
            这些项因为合同里缺少可识别信息而无法判断——<strong>不等于没问题</strong>，也不计入评分。
          </p>
          <ul className="card list">
            {report.undetermined.map((item) => (
              <li key={item.ruleCode}>
                <strong>{item.title}</strong>
                <span className="muted">　{item.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>与官方范本的差异（{diffTotal} 处）</h2>
        <p className="muted">对照范本：{report.template.name}（{report.template.regionName}）</p>
        {diffTotal === 0 ? (
          <p className="card empty">逐条比对后没有发现差异。</p>
        ) : (
          report.diffs.items.map((item, index) => (
            <article key={`${item.kind}-${index}`} className="card diff">
              <header>
                <span className="badge muted">{DIFF_LABEL[item.kind] ?? item.kind}</span>
                <span className="muted">
                  范本 {item.templateLabel ?? '—'} · 合同 {item.contractLabel ?? '—'}
                </span>
              </header>
              {item.templateText !== null && (
                <p className="quote">
                  <span className="clause">范本</span>
                  {item.templateText}
                </p>
              )}
              {item.contractText !== null && (
                <p className="quote">
                  <span className="clause">合同</span>
                  {item.contractText}
                </p>
              )}
            </article>
          ))
        )}
      </section>

      <section>
        <h2>关键信息</h2>
        <table className="card key-info">
          <tbody>
            {report.keyInfo.map((row) => (
              <tr key={row.label} className={row.status === 'NOT_FOUND' ? 'missing' : undefined}>
                <th scope="row">{row.label}</th>
                <td>{describeKeyInfo(row.status, row.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {report.summaries.map((summary) => (
        <section key={summary.title}>
          <h2>{summary.title}总结</h2>
          <ul className="card list">
            {summary.lines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </section>
      ))}

      <footer className="disclaimers">
        {report.disclaimers.map((line) => (
          <p key={line}>{line}</p>
        ))}
        <p className="muted">
          规则库版本 {report.versions.ruleSetVersion} · 范本 {report.versions.templateVersion}
        </p>
      </footer>
    </div>
  )
}
