import { cnToInt } from './cn-number.ts'
import type { ContractClause } from './diff-template.ts'
import { FACT_KEYS, type FactKey } from './schema.ts'

/** 事实的中文名与单位，用于把判定结果写成一句人能看懂的话。 */
export const FACT_META: Record<FactKey, { label: string; unit: string }> = {
  contractTermMonths: { label: '合同期限', unit: '个月' },
  probationMonths: { label: '试用期', unit: '个月' },
  monthlyWage: { label: '月工资', unit: '元' },
  probationMonthlyWage: { label: '试用期月工资', unit: '元' },
  nonCompeteMonths: { label: '竞业限制期限', unit: '个月' },
}

export type { FactKey }
export { FACT_KEYS }

export type FactEvidence = {
  clauseLabel: string | null
  /** 命中的原文片段，报告里要原样展示，让人能自己核对。 */
  text: string
}

export type Fact = {
  key: FactKey
  /**
   * 识别出的数值（期限为月、工资为元）。
   * **未识别时一律为 null**——不要当成 0，也不要当成合规：依赖它的规则必须降级为「无法判定」。
   */
  value: number | null
  unit: string | null
  evidence: FactEvidence | null
  method: 'EXPLICIT' | 'DATE_RANGE' | 'DERIVED' | 'UNRECOGNIZED'
  /** method 为 UNRECOGNIZED 时说明原因，便于人工判断是合同写法特殊还是抽取器缺模式。 */
  reason?: string
}

export type FactSet = Record<FactKey, Fact>

const CN_OR_DIGIT = '([0-9]+|[一二三四五六七八九十百两]+)'

function toNumber(raw: string): number | null {
  const cleaned = raw.replace(/[,，\s]/g, '')
  if (cleaned === '') return null
  if (/^\d+$/.test(cleaned)) return Number(cleaned)
  return cnToInt(cleaned)
}

function monthsBetween(y1: number, m1: number, d1: number, y2: number, m2: number, d2: number): number {
  let months = (y2 - y1) * 12 + (m2 - m1)
  if (d2 < d1) months -= 1
  return months
}

const DATE_PATTERN = '(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日'

/**
 * 多选项条款消歧。
 *
 * 范本里大量使用「双方约定按下列第 1 种方式确定劳动合同期限：1.固定期限：… 2.无固定期限：…」这种写法。
 * 直接抓日期范围会抓到没被选中的那一项，得出错误事实。所以先找「第 N 种」标记，
 * 再在后续的编号项目里取第 N 项，只在那一项里做抽取。
 */
export function pickOption(text: string): string {
  const marker = new RegExp(`第\\s*${CN_OR_DIGIT}\\s*种`).exec(text)
  if (marker === null) return text
  const index = toNumber(marker[1] ?? '')
  if (index === null) return text

  const items = text
    .split(/(?=\d+[.．])/)
    .map((part) => part.trim())
    .filter((part) => /^\d+[.．]/.test(part))
  const chosen = items.find((part) => new RegExp(`^${index}[.．]`).test(part))
  return chosen ?? text
}

type DateRange = { years: number; months: number }

/** 在一段文本里找日期区间；找到多个说明仍有歧义，返回 'AMBIGUOUS' 而不是猜一个。 */
function findDateRange(text: string): DateRange | 'AMBIGUOUS' | null {
  const pattern = new RegExp(`自?\\s*${DATE_PATTERN}\\s*起?\\s*至\\s*${DATE_PATTERN}\\s*止`, 'g')
  const found = [...text.matchAll(pattern)]
  if (found.length === 0) return null
  if (found.length > 1) return 'AMBIGUOUS'

  const match = found[0]
  if (match === undefined) return null
  const numbers = match.slice(1, 7).map((part) => Number(part))
  const [y1, m1, d1, y2, m2, d2] = numbers
  if (y1 === undefined || m1 === undefined || d1 === undefined) return null
  if (y2 === undefined || m2 === undefined || d2 === undefined) return null
  return { years: y2 - y1, months: monthsBetween(y1, m1, d1, y2, m2, d2) }
}

function fact(key: FactKey, value: number, unit: string, evidence: FactEvidence, method: Fact['method']): Fact {
  return { key, value, unit, evidence, method }
}

function unrecognized(key: FactKey, reason: string, evidence: FactEvidence | null = null): Fact {
  return { key, value: null, unit: null, evidence, method: 'UNRECOGNIZED', reason }
}

function extractContractTerm(clauses: ContractClause[]): Fact {
  for (const clause of clauses) {
    if (!/期限/.test(clause.text)) continue
    const scoped = pickOption(clause.text)
    const range = findDateRange(scoped)
    if (range === 'AMBIGUOUS') {
      return unrecognized('contractTermMonths', '条款含多个期限区间，无法确定按哪一个计算', {
        clauseLabel: clause.label,
        text: scoped.slice(0, 200),
      })
    }
    if (range !== null) {
      return fact('contractTermMonths', range.months, '月', { clauseLabel: clause.label, text: scoped.slice(0, 200) }, 'DATE_RANGE')
    }

    const years = new RegExp(`期限[为是]?\\s*${CN_OR_DIGIT}\\s*年`).exec(scoped)
    if (years !== null) {
      const value = toNumber(years[1] ?? '')
      if (value !== null) {
        return fact('contractTermMonths', value * 12, '月', { clauseLabel: clause.label, text: years[0] }, 'EXPLICIT')
      }
    }

    const months = new RegExp(`期限[为是]?\\s*${CN_OR_DIGIT}\\s*个?月`).exec(scoped)
    if (months !== null) {
      const value = toNumber(months[1] ?? '')
      if (value !== null) {
        return fact('contractTermMonths', value, '月', { clauseLabel: clause.label, text: months[0] }, 'EXPLICIT')
      }
    }
  }
  return unrecognized('contractTermMonths', '未找到可识别的劳动合同期限表述')
}

function extractProbation(clauses: ContractClause[]): Fact {
  for (const clause of clauses) {
    if (!/试用期/.test(clause.text)) continue
    const scoped = pickOption(clause.text)

    const explicit = new RegExp(`试用期[^。0-9一二三四五六七八九十]{0,12}?${CN_OR_DIGIT}\\s*个?月`).exec(scoped)
    if (explicit !== null) {
      const value = toNumber(explicit[1] ?? '')
      if (value !== null) {
        return fact('probationMonths', value, '月', { clauseLabel: clause.label, text: explicit[0] }, 'EXPLICIT')
      }
    }

    const rangePattern = new RegExp(`试用期[^。]{0,20}?自\\s*${DATE_PATTERN}\\s*起?\\s*至\\s*${DATE_PATTERN}\\s*止`)
    const range = rangePattern.exec(scoped)
    if (range !== null) {
      const numbers = range.slice(1, 7).map((part) => Number(part))
      const [y1, m1, d1, y2, m2, d2] = numbers
      if (y1 !== undefined && m1 !== undefined && d1 !== undefined && y2 !== undefined && m2 !== undefined && d2 !== undefined) {
        return fact(
          'probationMonths',
          monthsBetween(y1, m1, d1, y2, m2, d2),
          '月',
          { clauseLabel: clause.label, text: range[0] },
          'DATE_RANGE',
        )
      }
    }

    // 范本的写法：试用期只给终止日，「从用工之日起」。用工之日即合同起点，用同一条款里的起始日推导。
    const openStart = new RegExp(`试用期[^。]{0,20}?从用工之日起\\s*至\\s*${DATE_PATTERN}\\s*止`).exec(scoped)
    if (openStart !== null) {
      const contractStart = findDateRange(scoped)
      const endNumbers = openStart.slice(1, 4).map((part) => Number(part))
      const [y2, m2, d2] = endNumbers
      if (
        contractStart !== null &&
        contractStart !== 'AMBIGUOUS' &&
        y2 !== undefined &&
        m2 !== undefined &&
        d2 !== undefined
      ) {
        const startMatch = new RegExp(`自\\s*${DATE_PATTERN}`).exec(scoped)
        if (startMatch !== null) {
          const startNumbers = startMatch.slice(1, 4).map((part) => Number(part))
          const [y1, m1, d1] = startNumbers
          if (y1 !== undefined && m1 !== undefined && d1 !== undefined) {
            return fact(
              'probationMonths',
              monthsBetween(y1, m1, d1, y2, m2, d2),
              '月',
              { clauseLabel: clause.label, text: openStart[0] },
              'DERIVED',
            )
          }
        }
      }
      return unrecognized('probationMonths', '试用期只给了终止日，但未能确定合同起始日，无法换算月数', {
        clauseLabel: clause.label,
        text: openStart[0],
      })
    }
  }
  return unrecognized('probationMonths', '未找到可识别的试用期约定')
}

const AMOUNT_PATTERN = /([0-9][0-9,，]*)\s*元/

/** 金额片段的截止符：遇到这些就不再往后找，避免越过本项抓到下一项的钱。 */
const AMOUNT_STOP = /[，,；;。\n]/

/**
 * 带标签的金额抽取：先定位标签，再取标签**后面第一个**金额，且不越过标点。
 *
 * 不能用「这一条里最后一个金额」这种按位置猜的启发式。实测被一份真实合同打穿过：
 * 「试用期工资：人民币4800元/月，试用期满转正工资：人民币6000元/月，包含基本工资4500元、绩效工资1500元」
 * ——取最后一个金额得到 1500，那是绩效工资，结论完全错了。
 */
function amountAfterLabel(
  text: string,
  labelPattern: RegExp,
  maxWindow = 40,
): { value: number; text: string } | null {
  const label = labelPattern.exec(text)
  if (label === null) return null

  const from = label.index + label[0].length
  const window = text.slice(from, from + maxWindow)
  const stop = AMOUNT_STOP.exec(window)
  const scope = stop === null ? window : window.slice(0, stop.index)

  const amount = AMOUNT_PATTERN.exec(scope)
  if (amount === null) return null
  const value = toNumber(amount[1] ?? '')
  if (value === null) return null

  return { value, text: `${label[0]}${scope.slice(0, amount.index)}${amount[0]}` }
}

/** 试用期工资的标签写法。 */
const PROBATION_WAGE_LABEL = /试用期[^。，；]{0,12}?工资/
/** 转正后（即约定工资）的标签写法。 */
const REGULAR_WAGE_LABEL = /(?:转正后|转正|正式录用后|月工资|税前月工资)/

function extractMonthlyWage(clauses: ContractClause[]): Fact {
  for (const clause of clauses) {
    if (!/(月工资|工资|薪资|薪酬)/.test(clause.text)) continue

    const labelled = amountAfterLabel(clause.text, REGULAR_WAGE_LABEL)
    if (labelled !== null) {
      return fact('monthlyWage', labelled.value, '元', { clauseLabel: clause.label, text: labelled.text }, 'EXPLICIT')
    }

    // 没有「转正/月工资」这类标签时，若这一条只讲了试用期工资，就不能拿它的金额当约定工资——
    // 那会低估 80% 的比对基准。宁可报未识别。
    if (/试用期/.test(clause.text)) continue

    const first = AMOUNT_PATTERN.exec(clause.text)
    if (first === null) continue
    const value = toNumber(first[1] ?? '')
    if (value === null) continue
    return fact('monthlyWage', value, '元', { clauseLabel: clause.label, text: first[0] }, 'EXPLICIT')
  }
  return unrecognized('monthlyWage', '未找到可识别的约定工资')
}

function extractProbationWage(clauses: ContractClause[]): Fact {
  for (const clause of clauses) {
    if (!/试用期/.test(clause.text)) continue
    if (!/工资/.test(clause.text)) continue

    const hit = amountAfterLabel(clause.text, PROBATION_WAGE_LABEL)
    if (hit === null) continue
    return fact('probationMonthlyWage', hit.value, '元', { clauseLabel: clause.label, text: hit.text }, 'EXPLICIT')
  }
  return unrecognized('probationMonthlyWage', '未找到可识别的试用期工资约定')
}

function extractNonCompete(clauses: ContractClause[]): Fact {
  for (const clause of clauses) {
    if (!/竞业限制/.test(clause.text)) continue
    const match = new RegExp(`${CN_OR_DIGIT}\\s*年`).exec(clause.text)
    if (match === null) {
      return unrecognized('nonCompeteMonths', '竞业限制条款里没有写明期限', {
        clauseLabel: clause.label,
        text: clause.text.slice(0, 200),
      })
    }
    const years = toNumber(match[1] ?? '')
    if (years === null) continue
    return fact('nonCompeteMonths', years * 12, '月', { clauseLabel: clause.label, text: match[0] }, 'EXPLICIT')
  }
  return unrecognized('nonCompeteMonths', '合同中未约定竞业限制')
}

/**
 * 从合同条款里抽取结构化事实。
 *
 * 抽取是纯确定性的（正则 + 中文数字换算 + 多选项消歧），不调用模型：
 * 数值类规则要拿这些值去和法条比对，值错了结论就错了，所以宁可返回「未识别」也不猜。
 */
export function extractFacts(clauses: ContractClause[]): FactSet {
  return {
    contractTermMonths: extractContractTerm(clauses),
    probationMonths: extractProbation(clauses),
    monthlyWage: extractMonthlyWage(clauses),
    probationMonthlyWage: extractProbationWage(clauses),
    nonCompeteMonths: extractNonCompete(clauses),
  }
}
