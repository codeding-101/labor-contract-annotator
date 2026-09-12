import { useState } from 'react'
import { extractDocument, kindOf } from './document.ts'
import { analyzeContract, type AnalysisResult } from './pipeline.ts'
import { ReportView } from './ReportView.tsx'
import { cleanSampleText, riskySampleText } from './samples.ts'

type SourceInfo = { label: string; detail: string }

export function App(): React.ReactElement {
  const [text, setText] = useState('')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<SourceInfo | null>(null)
  const [dragging, setDragging] = useState(false)

  function reset(clearText: boolean): void {
    if (clearText) setText('')
    setResult(null)
    setError(null)
    setSource(null)
  }

  function load(sample: string, label: string): void {
    reset(false)
    setText(sample)
    setSource({ label, detail: '由工具预置的示例文本' })
  }

  async function handleFile(file: File): Promise<void> {
    reset(true)
    if (kindOf(file) === null) {
      setError(
        '暂不支持这种文件。本工具只读两种：带文字层的 PDF，和 Word（.docx）。' +
          '老式 .doc 请在 Word 里打开后另存为 .docx；扫描件、拍照图片读不出文字，请从原件复制文字，或只把需要核对的条款手工录入。',
      )
      return
    }

    try {
      // 各格式的读取器按需加载，首屏不为它们买单
      const extraction = await extractDocument(file)
      if (!extraction.hasTextLayer) {
        setError(
          `这个文件读不到文字（${extraction.detail}）——常见于扫描件、拍照生成的图片（Word 里只贴了图片也会这样），或加密文档。` +
            '这种情况本工具暂时无法解析，请改用其他方式提供合同文本（例如从原件复制，或手工录入需要核对的条款）。',
        )
        return
      }
      setText(extraction.text)
      setSource({ label: file.name, detail: extraction.detail })
    } catch (cause) {
      setError(`读取文件失败：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  function analyze(): void {
    try {
      const next = analyzeContract(text)
      if (next.clauseCount === 0) {
        setError('没有识别出任何条款，请检查内容是否完整。')
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

  /** 直接拖文件进来。对方发来的合同多半就是桌面或聊天窗口里的一个 .docx，拖比找按钮快。 */
  function handleDrop(event: React.DragEvent): void {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file !== undefined) void handleFile(file)
  }

  return (
    <div className="page">
      <header className="hero">
        <h1>劳动合同风险检查</h1>
        <p className="lead">
          把劳动合同与当地人社部门的官方示范文本逐条比对，指出可能违反法律规定的条款，并附上对应的法条原文。
        </p>
        <p className="privacy">全部在你的浏览器里完成，合同内容不离开设备，也不经过任何服务器。</p>
      </header>

      <section
        className={`card input-card${dragging ? ' dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <div className="input-head">
          <h2>提供合同内容</h2>
          <div className="actions">
            <input
              id="pdf-input"
              className="sr-only"
              type="file"
              accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file !== undefined) void handleFile(file)
                event.target.value = ''
              }}
            />
            <label className="ghost button-like" htmlFor="pdf-input">
              选择合同文件
            </label>
            <button type="button" className="ghost" onClick={() => load(cleanSampleText, '合规示例')}>
              填入合规示例
            </button>
            <button type="button" className="ghost" onClick={() => load(riskySampleText, '可疑示例')}>
              填入可疑示例
            </button>
            <button type="button" className="ghost" onClick={() => reset(true)}>
              清空
            </button>
          </div>
        </div>

        <p className="muted hint">
          支持<b>带文字层</b>的 PDF、Word（.docx），或直接把合同文字粘贴到下面。也可以把文件<b>拖进来</b>。老式 .doc 请先另存为 .docx；扫描件与拍照图片读不出文字，请复制或手工录入条款——本工具会明确说明原因，而不是给出一份空报告。
        </p>
        {dragging && <p className="drop-hint">松开鼠标即可读取这个文件</p>}

        <label className="sr-only" htmlFor="contract-text">
          合同内容
        </label>
        <textarea
          id="contract-text"
          value={text}
          rows={12}
          placeholder="把劳动合同的文字内容粘贴到这里，或用上方的「选择合同文件」。带条款编号（如「第一条」）最好，没有编号也能分析。"
          onChange={(event) => {
            setText(event.target.value)
            setSource(null)
          }}
        />

        <div className="submit-row">
          <button type="button" className="primary" onClick={analyze} disabled={text.trim() === ''}>
            开始检查
          </button>
          <span className="muted">
            {source !== null
              ? `来源：${source.label}（${source.detail}）`
              : text.trim() === ''
                ? '请先提供合同内容'
                : `已输入 ${text.length} 字`}
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
