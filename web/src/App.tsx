import { useState } from 'react'
import { analyzeContract, type AnalysisResult } from './pipeline.ts'
import { ReportView } from './ReportView.tsx'
import { cleanSampleText, riskySampleText } from './samples.ts'

export function App(): React.ReactElement {
  const [text, setText] = useState('')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  function analyze(): void {
    try {
      const next = analyzeContract(text)
      if (next.clauseCount === 0) {
        setError('没有识别出任何条款，请检查粘贴的内容是否完整。')
        setResult(null)
        return
      }
      setError(null)
      setResult(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setResult(null)
    }
  }

  function load(sample: string): void {
    setText(sample)
    setResult(null)
    setError(null)
  }

  return (
    <div className="page">
      <header className="hero">
        <h1>劳动合同风险检查</h1>
        <p className="lead">
          把劳动合同与当地人社部门的官方示范文本逐条比对，标出差异、指出可能违反法律规定的条款，并附上对应的法条原文。
        </p>
        <p className="privacy">
          全部在你的浏览器里完成，合同内容不离开设备，也不经过任何服务器。
        </p>
      </header>

      <section className="card input-card">
        <div className="input-head">
          <h2>粘贴合同内容</h2>
          <div className="actions">
            <button type="button" className="ghost" onClick={() => load(cleanSampleText)}>
              填入合规示例
            </button>
            <button type="button" className="ghost" onClick={() => load(riskySampleText)}>
              填入可疑示例
            </button>
            <button type="button" className="ghost" onClick={() => load('')}>
              清空
            </button>
          </div>
        </div>

        <label className="sr-only" htmlFor="contract-text">
          合同内容
        </label>
        <textarea
          id="contract-text"
          value={text}
          rows={12}
          placeholder="把劳动合同的文字内容粘贴到这里。带条款编号（如「第一条」）最好，没有编号也能分析。"
          onChange={(event) => setText(event.target.value)}
        />

        <div className="submit-row">
          <button type="button" className="primary" onClick={analyze} disabled={text.trim() === ''}>
            开始检查
          </button>
          <span className="muted">
            {text.trim() === '' ? '请先粘贴合同内容，或点右上角的示例' : `已粘贴 ${text.length} 字`}
          </span>
        </div>

        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      {result !== null && (
        <>
          <p className="meta">
            识别到 {result.clauseCount} 条
            {result.method === 'PARAGRAPHS' ? '（没找到条款编号，按段落切分）' : ''}
            {result.skippedBeforeFirstArticle > 0
              ? `；条款之前略过 ${result.skippedBeforeFirstArticle} 段（抬头、双方信息等）`
              : ''}
          </p>
          {result.issues.map((issue) => (
            <p key={issue} className="notice">
              ⚠ {issue}
            </p>
          ))}
          <ReportView report={result.report} />
        </>
      )}
    </div>
  )
}
