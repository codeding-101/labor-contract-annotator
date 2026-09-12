import type { ContractReport } from '../../src/build-report.ts'

const LEVEL_LABEL: Record<string, string> = { red: '严重', yellow: '需关注', blue: '提示' }

function describeKeyInfo(status: string, value: string | null): string {
  if (status === 'VALUE') return value ?? '—'
  if (status === 'MENTIONED') return '有提及（未核对内容）'
  if (status === 'NOT_FOUND') return '合同未提及'
  return '未能识别（需人工核对）'
}

export function ReportView({ report }: { report: ContractReport }): React.ReactElement {
  const annotated = report.counts.red + report.counts.yellow + report.counts.blue

  return (
    <div className="report">
      <section className="card overview">
        <p className="overview-line">
          共标注 <strong>{annotated}</strong> 处
        </p>
        <div className="counts">
          <span className="chip red">严重 {report.counts.red}</span>
          <span className="chip yellow">需关注 {report.counts.yellow}</span>
          <span className="chip blue">提示 {report.counts.blue}</span>
          <span className="chip muted">无法判定 {report.undetermined.length}</span>
        </div>
        <p className="muted">
          本工具只把合同里的条款标出来、附上对应的法律条文，<strong>不做综合评价，也不替你决定签不签</strong>。
        </p>
      </section>

      {report.risks.length > 0 && (
        <section>
          <h2>标注的条款</h2>
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
            这些项因为合同里缺少可识别信息而无法判断——<strong>不等于没问题</strong>，也不计入上面的标注数。
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
