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
  payDayOfMonth: { label: '发薪日期', unit: '日' },
  baseWage: { label: '基本工资', unit: '元' },
  performanceWage: { label: '绩效工资', unit: '元' },
  bonusWage: { label: '奖金', unit: '元' },
  dailyWorkHours: { label: '每日工作时间', unit: '小时' },
  annualLeaveDays: { label: '年休假', unit: '天' },
  confidentialityMonths: { label: '保密期限', unit: '个月' },
  workLocationText: { label: '工作地点', unit: '' },
  socialInsuranceFundText: { label: '五险一金', unit: '' },
  overtimeText: { label: '加班规则', unit: '' },
  breachText: { label: '违约责任', unit: '' },
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
  /**
   * 文本类事实的取值：直接给合同原文片段。
   * 「工作地点是什么」这类项没有可比较的数值，把原文摘出来本身就是"核对内容"——
   * 比「有提及（未核对内容）」这种含糊说法有用得多。
   */
  textValue: string | null
  unit: string | null
  evidence: FactEvidence | null
  /**
   * - `EXPLICIT` / `DATE_RANGE` / `DERIVED`：取到了值，`method` 说明是怎么取的；
   * - `NOT_AGREED`：合同**明确写了这一项不约定**（例如「本岗位…不约定离职后竞业限制义务」）。
   *   这不是"没认出来"，而是一条确定的事实：依赖它的规则应当判为**不适用**，
   *   既不该报违规，也不该出现在"无法判定"里（那会让用户以为工具没查）；
   * - `UNRECOGNIZED`：写了相关内容但没认出来，或根本没写。依赖它的规则只能报"无法判定"。
   */
  method: 'EXPLICIT' | 'DATE_RANGE' | 'DERIVED' | 'NOT_AGREED' | 'UNRECOGNIZED'
  /** method 为 UNRECOGNIZED / NOT_AGREED 时说明原因，便于人工判断是合同写法特殊还是抽取器缺模式。 */
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

/**
 * 起止日期之间的完整月数。
 *
 * 合同里的「自 X 起至 Y 止」是**含首尾两天**的期间：2026-09-15 至 2029-09-14 就是整三年。
 * 所以算月数时把终止日当作含当天（+1 天）。不这么做的话，同一份合同会算成 35 个月，
 * 落进《劳动合同法》第十九条「一年以上不满三年」那一档，把合法的 6 个月试用期误判成超长。
 */
function monthsBetween(y1: number, m1: number, d1: number, y2: number, m2: number, d2: number): number {
  const start = Date.UTC(y1, m1 - 1, d1)
  const end = Date.UTC(y2, m2 - 1, d2 + 1)
  const startDate = new Date(start)
  const endDate = new Date(end)
  let months = (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 + (endDate.getUTCMonth() - startDate.getUTCMonth())
  if (endDate.getUTCDate() < startDate.getUTCDate()) months -= 1
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

type DateRange = { index: number; months: number; text: string }

/** 在一段文本里找出所有日期区间，并记下各自位置。多个区间要不要消歧由调用方决定。 */
function findDateRanges(text: string): DateRange[] {
  const pattern = new RegExp(`自?\\s*${DATE_PATTERN}\\s*起?\\s*至\\s*${DATE_PATTERN}\\s*止`, 'g')
  const ranges: DateRange[] = []
  for (const match of text.matchAll(pattern)) {
    const numbers = match.slice(1, 7).map((part) => Number(part))
    const [y1, m1, d1, y2, m2, d2] = numbers
    if (
      y1 === undefined ||
      m1 === undefined ||
      d1 === undefined ||
      y2 === undefined ||
      m2 === undefined ||
      d2 === undefined
    ) {
      continue
    }
    ranges.push({ index: match.index ?? 0, months: monthsBetween(y1, m1, d1, y2, m2, d2), text: match[0] })
  }
  return ranges
}

/** 只有一个区间时才用它；多个区间说明仍有歧义，返回 'AMBIGUOUS' 而不是猜一个。 */
function findDateRange(text: string): DateRange | 'AMBIGUOUS' | null {
  const ranges = findDateRanges(text)
  if (ranges.length === 0) return null
  if (ranges.length > 1) return 'AMBIGUOUS'
  return ranges[0] ?? null
}

/**
 * 一条条款里有多个日期区间时，先按上下文排除**试用期**那一处：
 * 「本合同…自 X 起至 Y 止。其中试用期自 X 起至 Z 止」说的是两件事，合同期限是前者。
 * 剩下的还不唯一就报歧义——不猜。
 */
function pickTermRange(text: string, ranges: readonly DateRange[]): DateRange | 'AMBIGUOUS' | null {
  if (ranges.length === 0) return null
  if (ranges.length === 1) return ranges[0] ?? null
  const outsideProbation = ranges.filter(
    (range) => !/试用期/.test(text.slice(Math.max(0, range.index - 12), range.index)),
  )
  if (outsideProbation.length === 1) return outsideProbation[0] ?? null
  return 'AMBIGUOUS'
}

function fact(key: FactKey, value: number, unit: string, evidence: FactEvidence, method: Fact['method']): Fact {
  return { key, value, textValue: null, unit, evidence, method }
}

function unrecognized(key: FactKey, reason: string, evidence: FactEvidence | null = null): Fact {
  return { key, value: null, textValue: null, unit: null, evidence, method: 'UNRECOGNIZED', reason }
}

/** 文本类事实：值就是合同原文片段。 */
function textFact(key: FactKey, textValue: string, evidence: FactEvidence): Fact {
  return { key, value: null, textValue, unit: null, evidence, method: 'EXPLICIT' }
}

/** 合同明确写了"本项不约定"：不是没认出来，而是一条确定的事实。 */
function notAgreed(key: FactKey, reason: string, evidence: FactEvidence): Fact {
  return { key, value: null, textValue: null, unit: null, evidence, method: 'NOT_AGREED', reason }
}

function extractContractTerm(clauses: ContractClause[]): Fact {
  for (const clause of clauses) {
    if (!/期限/.test(clause.text)) continue
    const scoped = pickOption(clause.text)
    const range = pickTermRange(scoped, findDateRanges(scoped))
    if (range === 'AMBIGUOUS') {
      return unrecognized('contractTermMonths', '条款含多个期限区间，无法确定按哪一个计算', {
        clauseLabel: clause.label,
        text: scoped.slice(0, 200),
      })
    }
    if (range !== null) {
      return fact('contractTermMonths', range.months, '月', { clauseLabel: clause.label, text: range.text }, 'DATE_RANGE')
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
 * 带标签的金额抽取：定位标签，取标签**后面第一个**金额，且不越过标点。
 *
 * 不能用「这一条里最后一个金额」这种按位置猜的启发式。实测被一份真实合同打穿过：
 * 「试用期工资：人民币4800元/月，试用期满转正工资：人民币6000元/月，包含基本工资4500元、绩效工资1500元」
 * ——取最后一个金额得到 1500，那是绩效工资，结论完全错了。
 *
 * 标签可能出现多次，且**前面的那几次不一定带金额**：同一份合同里
 * 「试用期工资：人民币4800元/月（不低于转正工资80%）」的「转正」后面只有百分数，
 * 只认第一次出现就会整条放弃，最后退到别的条款抓到「每月200元餐补」。所以按出现顺序逐个试，
 * 取第一个后面确实跟着金额的。
 */
function amountAfterLabel(
  text: string,
  labelPattern: RegExp,
  maxWindow = 40,
): { value: number; text: string } | null {
  const pattern = new RegExp(labelPattern.source, labelPattern.flags.replace('g', '') + 'g')

  for (const label of text.matchAll(pattern)) {
    const from = (label.index ?? 0) + label[0].length
    const window = text.slice(from, from + maxWindow)
    const stop = AMOUNT_STOP.exec(window)
    const scope = stop === null ? window : window.slice(0, stop.index)

    const amount = AMOUNT_PATTERN.exec(scope)
    if (amount === null) continue
    const value = toNumber(amount[1] ?? '')
    if (value === null) continue

    return { value, text: `${label[0]}${scope.slice(0, amount.index)}${amount[0]}` }
  }
  return null
}

/** 试用期工资的标签写法。 */
const PROBATION_WAGE_LABEL = /试用期[^。，；]{0,12}?工资/
/** 转正后（即约定工资）的标签写法。 */
const REGULAR_WAGE_LABEL = /(?:转正后|转正|正式录用后|月工资|税前月工资)/

function extractMonthlyWage(clauses: ContractClause[]): Fact {
  for (const clause of clauses) {
    if (!/(月工资|工资|薪资|薪酬)/.test(clause.text)) continue

    // 先看被选中的发放方式与前缀；没被选中的那一项里写着「月工资 X 元」不算数
    const scopeList = applicableScopes(clause.text)
    for (const scope of scopeList) {
      const labelled = amountAfterLabel(scope, REGULAR_WAGE_LABEL)
      if (labelled !== null) {
        return fact('monthlyWage', labelled.value, '元', { clauseLabel: clause.label, text: labelled.text }, 'EXPLICIT')
      }
    }

    // 没有「转正/月工资」这类标签时，只有在这一条明显只讲一个固定月薪时才兜底。
    // 讲工资构成（基本工资/绩效工资）或计件的条款里没有"约定月工资"这个单一数字，
    // 逮住第一个金额会把它错当成月薪——那正是 80% 那条规则的比对基准。
    // 只讲试用期工资的条款同理，宁可报未识别。
    if (/试用期|基本工资|绩效工资|计件/.test(clause.text)) continue

    const first = AMOUNT_PATTERN.exec(scopeList[0] ?? clause.text)
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

    for (const scope of applicableScopes(clause.text)) {
      const hit = amountAfterLabel(scope, PROBATION_WAGE_LABEL)
      if (hit === null) continue
      return fact('probationMonthlyWage', hit.value, '元', { clauseLabel: clause.label, text: hit.text }, 'EXPLICIT')
    }
  }
  return unrecognized('probationMonthlyWage', '未找到可识别的试用期工资约定')
}

const YEAR_PATTERN = /([0-9]+|[一二三四五六七八九十百千两]+)\s*年/

/**
 * 从「数字 + 年」里取期限，**排除日历年份**。
 *
 * 实测被真实合同打穿过：「本岗位…不约定离职后竞业限制义务」那句话所在条款里有个 2026 年的日期，
 * 旧实现把 2026 当成"2026 年的竞业限制期限"，算出 24312 个月。
 * 四位数字落在 1900–2200 之间时一律按日期处理——期限不可能是这个数。
 */
function yearsFromMatch(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '')
  const years = /^\d+$/.test(cleaned) ? Number(cleaned) : cnToInt(cleaned)
  if (years === null) return null
  if (/^\d{4}$/.test(cleaned) && years >= 1900 && years <= 2200) return null
  return years
}

function extractNonCompete(clauses: ContractClause[]): Fact {
  for (const clause of clauses) {
    if (!/竞业限制/.test(clause.text)) continue

    // 明确写「不约定竞业限制」的条款：这是一条确定的结论，不该再去找期限
    if (/不约定[^。；]{0,20}?竞业限制|竞业限制[^。；]{0,20}?不(?:适用|约定)/.test(clause.text)) {
      return notAgreed('nonCompeteMonths', '合同明确不约定竞业限制义务', {
        clauseLabel: clause.label,
        text: clause.text.slice(0, 200),
      })
    }

    // 优先取「竞业限制期限」标签之后的期限；没有标签再退回该条第一个非日历年份
    const label = /竞业限制[^。，；]{0,12}?期限(?:为|是)?/.exec(clause.text)
    const scopes =
      label === null
        ? [clause.text]
        : [clause.text.slice(label.index + label[0].length), clause.text]

    for (const scope of scopes) {
      for (const match of scope.matchAll(new RegExp(YEAR_PATTERN.source, 'g'))) {
        const years = yearsFromMatch(match[1] ?? '')
        if (years === null) continue
        return fact(
          'nonCompeteMonths',
          years * 12,
          '月',
          { clauseLabel: clause.label, text: match[0] },
          'EXPLICIT',
        )
      }
    }
  }
  return unrecognized('nonCompeteMonths', '合同中未约定竞业限制')
}

/**
 * 从合同条款里抽取结构化事实。
 *
 * 抽取是纯确定性的（正则 + 中文数字换算 + 多选项消歧），不调用模型：
 * 数值类规则要拿这些值去和法条比对，值错了结论就错了，所以宁可返回「未识别」也不猜。
 */
/**
 * 「关键信息」表里原先只做关键词判断的项，升级为真值抽取。
 *
 * 每一项都必须**自带标签**（「每月」「基本工资」这种），不按形状猜——这条是实测三次打穿换来的。
 * 数字类的组 1 是数值；文本类的标签命中后向后取一段原文（原文本身就是"核对内容"）。
 */
type ValueSpec = { key: FactKey; pattern: RegExp; unit: string; scale?: number }
/**
 * 文本类事实的写法。
 * `preferred` 是更明确的"约定式"写法，先按它找一遍，找不到再退回通用标签——
 * 例如「工作地点：」「工作地点为」是在约定工作地点，而章节标题里的「工作内容和工作地点」
 * 只是标题，把标题连同正文摘出来对用户没有用。
 */
type TextSpec = { key: FactKey; preferred?: RegExp; label: RegExp; maxLength?: number }

const VALUE_SPECS: readonly ValueSpec[] = [
  { key: 'payDayOfMonth', pattern: /每月\s*([0-9]{1,2})\s*日/, unit: '日' },
  {
    key: 'baseWage',
    pattern: /基本工资[^0-9一二三四五六七八九十]{0,12}?([0-9][0-9,，]*|[一二三四五六七八九十]+)\s*元/,
    unit: '元',
  },
  {
    key: 'performanceWage',
    pattern: /绩效(?:工资|奖金)[^0-9一二三四五六七八九十]{0,12}?([0-9][0-9,，]*|[一二三四五六七八九十]+)\s*元/,
    unit: '元',
  },
  {
    key: 'bonusWage',
    pattern: /奖金[^0-9一二三四五六七八九十]{0,12}?([0-9][0-9,，]*|[一二三四五六七八九十]+)\s*元/,
    unit: '元',
  },
  {
    key: 'dailyWorkHours',
    pattern: /(?:每日|每天)[^0-9一二三四五六七八九十]{0,10}?([0-9]+(?:\.[0-9]+)?|[一二三四五六七八九十]+)\s*(?:个)?小时/,
    unit: '小时',
  },
  {
    key: 'annualLeaveDays',
    pattern: /年休假[^0-9一二三四五六七八九十]{0,12}?([0-9]+|[一二三四五六七八九十]+)\s*天/,
    unit: '天',
  },
  {
    key: 'confidentialityMonths',
    pattern: /保密(?:期限|期)[^0-9一二三四五六七八九十]{0,12}?([0-9]+|[一二三四五六七八九十两]+)\s*年/,
    unit: '个月',
    scale: 12,
  },
]

const TEXT_SPECS: readonly TextSpec[] = [
  { key: 'workLocationText', preferred: /工作地点[为是：:]/, label: /工作地点/, maxLength: 40 },
  { key: 'overtimeText', label: /加班/, maxLength: 60 },
  { key: 'breachText', label: /(?:违约金|违约责任)/, maxLength: 60 },
]

/** 摘出来的原文片段太短就没有核对价值，继续往后找下一条。 */
const MIN_SNIPPET = 6

/** 合理性检查：荒谬值一律拒绝。宁可报未识别，也不给看起来合理实际错的值。 */
function isPlausible(key: FactKey, value: number): boolean {
  if (key === 'payDayOfMonth') return value >= 1 && value <= 31
  if (key === 'dailyWorkHours') return value >= 1 && value <= 24
  if (key === 'annualLeaveDays') return value >= 1 && value <= 60
  if (key === 'confidentialityMonths') return value >= 1 && value <= 600
  return value >= 1 && value <= 10_000_000
}

/**
 * 带「第 N 种」的条款 = 选项清单 + 清单前后的共用文字：只有被选中的那一项算数，
 * 清单之前的文字（例如「于每月 X 日前足额支付」）对所有选项都适用。
 * 所以候选范围是被选中的项 + 清单之前的文字，**绝不包含没被选中的项**——
 * 那正是"把没选的发放方式里的数额报成约定工资"的来源。
 * 条款没有选项标记时，候选范围就是整条原文。
 */
function applicableScopes(text: string): string[] {
  const marker = new RegExp(`第\\s*${CN_OR_DIGIT}\\s*种`).exec(text)
  if (marker === null) return [text]
  const chosen = pickOption(text)
  if (chosen === text) return [text]
  const itemStart = /\d+[.．]/.exec(text)?.index ?? marker.index
  return [chosen, text.slice(0, itemStart)]
}

function extractByValueSpec(clauses: ContractClause[], spec: ValueSpec): Fact {
  for (const clause of clauses) {
    for (const candidate of applicableScopes(clause.text)) {
      const match = spec.pattern.exec(candidate)
      if (match === null) continue
      const parsed = toNumber(match[1] ?? '')
      if (parsed === null) continue
      const value = parsed * (spec.scale ?? 1)
      if (!isPlausible(spec.key, value)) continue
      return fact(spec.key, value, spec.unit, { clauseLabel: clause.label, text: match[0] }, 'EXPLICIT')
    }
  }
  return unrecognized(spec.key, `未找到可识别的${FACT_META[spec.key].label}`)
}

/**
 * 取标签所在的那一句（含结尾标点，摘出来才是一句完整的话）。
 *
 * 不能从标签起往后截固定长度：条款里的句号、分号、换行都很密，截出来会跨句，
 * 报告里就会出现「加班加点。方 2.依法实行以示例为周期…」这种半截不相干的原文。
 */
export function sentenceAround(text: string, index: number, maxLength: number): string {
  const start = Math.max(
    text.lastIndexOf('。', index - 1),
    text.lastIndexOf('；', index - 1),
    text.lastIndexOf('\n', index - 1),
  )
  const ends = ['。', '；', '\n']
    .map((mark) => text.indexOf(mark, index))
    .filter((found) => found !== -1)
  const end = ends.length === 0 ? text.length : Math.min(...ends) + 1
  return text
    .slice(start + 1, end)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

/** 章节标题的上限。中文合同的标题都短。 */
const HEADING_MAX_LENGTH = 20

/**
 * 看着像章节标题的一行：很短，且没有句号/分号这类结尾标点。
 *
 * 为什么需要它：合同里「违约责任」「工作内容和工作地点」「劳动报酬及支付」这些标题
 * 会命中同一批关键词，但它们不是内容——把标题当成"合同对这个事项的约定"摘出来，
 * 用户什么也得不到。真实正文句子几乎都以标点收尾。
 */
export function looksLikeHeading(sentence: string): boolean {
  return sentence.length <= HEADING_MAX_LENGTH && !/[。；;!？?]$/.test(sentence)
}

function extractByTextSpec(clauses: ContractClause[], spec: TextSpec): Fact {
  const passes = spec.preferred === undefined ? [spec.label] : [spec.preferred, spec.label]
  for (const label of passes) {
    for (const clause of clauses) {
      const match = label.exec(clause.text)
      if (match === null) continue
      const snippet = sentenceAround(clause.text, match.index, spec.maxLength ?? 40)
      if (snippet.length < MIN_SNIPPET) continue
      // 标题不是内容：命中「四、违约责任」这种章节标题时继续往后找真正的条款句子
      if (looksLikeHeading(snippet)) continue
      return textFact(spec.key, snippet, { clauseLabel: clause.label, text: snippet })
    }
  }
  return unrecognized(spec.key, `合同中未提及${FACT_META[spec.key].label}`)
}

/** 五险一金单独处理：这一项真正要核对的是「含不含住房公积金」。 */
function extractSocialInsuranceFund(clauses: ContractClause[]): Fact {
  const social = clauses.find((clause) => /(社会保险|社保)/.test(clause.text))
  const fund = clauses.find((clause) => /住房公积金|公积金/.test(clause.text))
  const source = fund ?? social
  if (source === undefined) {
    return unrecognized('socialInsuranceFundText', '合同中未提及社会保险与住房公积金')
  }
  return textFact(
    'socialInsuranceFundText',
    fund === undefined ? '只提到社会保险，未提住房公积金' : '含住房公积金',
    { clauseLabel: source.label, text: source.text.slice(0, 60) },
  )
}

/** 把同一套逻辑读到的事实按 key 取出来，缺规则时直接抛错而不是静默为空。 */
function makePicker(clauses: ContractClause[]): (key: FactKey) => Fact {
  const byPattern = new Map(VALUE_SPECS.map((spec) => [spec.key, extractByValueSpec(clauses, spec)]))
  const byText = new Map(TEXT_SPECS.map((spec) => [spec.key, extractByTextSpec(clauses, spec)]))
  return (key) => {
    const found = byPattern.get(key) ?? byText.get(key)
    if (found === undefined) throw new Error(`事实 ${key} 没有对应的抽取规则`)
    return found
  }
}

/**
 * 从合同条款里抽取结构化事实。
 *
 * 抽取是纯确定性的（正则 + 中文数字换算 + 多选项消歧），不调用模型：
 * 数值类规则要拿这些值去和法条比对，值错了结论就错了，所以宁可返回「未识别」也不猜。
 */
export function extractFacts(clauses: ContractClause[]): FactSet {
  const pick = makePicker(clauses)
  return {
    contractTermMonths: extractContractTerm(clauses),
    probationMonths: extractProbation(clauses),
    monthlyWage: extractMonthlyWage(clauses),
    probationMonthlyWage: extractProbationWage(clauses),
    nonCompeteMonths: extractNonCompete(clauses),
    payDayOfMonth: pick('payDayOfMonth'),
    baseWage: pick('baseWage'),
    performanceWage: pick('performanceWage'),
    bonusWage: pick('bonusWage'),
    dailyWorkHours: pick('dailyWorkHours'),
    annualLeaveDays: pick('annualLeaveDays'),
    confidentialityMonths: pick('confidentialityMonths'),
    workLocationText: pick('workLocationText'),
    socialInsuranceFundText: extractSocialInsuranceFund(clauses),
    overtimeText: pick('overtimeText'),
    breachText: pick('breachText'),
  }
}
