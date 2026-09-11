import { z } from 'zod'

const urlString = z.string().refine((value) => {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}, '必须是合法的 URL')

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, '必须是 64 位小写十六进制 SHA256')
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须是 YYYY-MM-DD')

/** 人工在 sources/sources.json 里声明的来源。此时还没有哈希，哈希由构建脚本计算。 */
export const DeclaredSourceSchema = z.object({
  id: z.string().min(1),
  file: z.string().min(1),
  url: urlString,
  publisher: z.string().min(1),
  publisherVerified: z.boolean(),
  retrievedAt: isoDate,
  role: z.enum(['primary', 'cross-check']),
  note: z.string().optional(),
})

export const DeclaredLawSchema = z.object({
  name: z.string().min(2),
  shortName: z.string().min(2),
  idPrefix: z.string().regex(/^[A-Z]+$/, 'idPrefix 必须是大写字母'),
  sources: z.array(DeclaredSourceSchema).min(1),
})

export const SourcesFileSchema = z.object({
  laws: z.record(z.string(), DeclaredLawSchema),
})

/** 构建产物中记录的来源，比声明多一个内容哈希，用于确认快照未被改动。 */
export const ProvenanceSourceSchema = DeclaredSourceSchema.extend({
  sha256: sha256Hex,
  /** 该来源抽取时记录到的问题。原样保留，便于审计哪个来源不干净。 */
  issues: z.array(z.string()),
  /** 正文之前的实际段数（可能大于 preamble 的长度，说明被上限截断过）。 */
  preambleBlockCount: z.number().int().nonnegative(),
  /** 判定正文结束的页脚块（若有），用于审计正文边界是怎么定的。 */
  trailingBoundary: z.string().nullable(),
})

export const StatuteArticleSchema = z.object({
  id: z.string().regex(/^[A-Z]+-\d+$/, '条文 ID 形如 LCL-25'),
  articleNo: z.number().int().positive(),
  articleLabel: z.string().min(2),
  chapter: z.string().nullable(),
  section: z.string().nullable(),
  text: z.string().min(1),
})

export const StatuteSchema = z.object({
  lawId: z.string().min(2),
  name: z.string().min(2),
  shortName: z.string().min(2),
  idPrefix: z.string().regex(/^[A-Z]+$/),
  /** 来源页面上位于正文之前的全部文本块（修正决定、公布通知、标题等），原样记录，不做解释。 */
  preamble: z.array(z.string()),
  articles: z.array(StatuteArticleSchema).min(1),
  provenance: z.object({
    generatedAt: z.string(),
    generator: z.string(),
    sources: z.array(ProvenanceSourceSchema).min(1),
    crossCheck: z.object({
      compared: z.number().int().nonnegative(),
      identical: z.number().int().nonnegative(),
      differing: z.array(z.number().int().positive()),
    }),
  }),
})

/** 规则判定方式。引擎只实现这几种确定性算子，规则库可以无限扩而代码不外扩。 */
export const CheckTypeSchema = z.enum(['NUMERIC_COMPARE', 'EXISTENCE', 'PATTERN_MATCH', 'ENUM_MATCH'])

export const RiskLevelSchema = z.enum(['red', 'yellow', 'blue'])

export const RiskRuleSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/, '规则 code 必须是大写下划线形式'),
  title: z.string().min(2),
  level: RiskLevelSchema,
  category: z.string().min(1),
  checkType: CheckTypeSchema,
  params: z.record(z.string(), z.unknown()),
  /** 必须指向真实存在的法条 ID，构建时校验。规则不允许没有法律依据。 */
  statuteRefs: z.array(z.string()).min(1),
  enabled: z.boolean(),
  note: z.string().optional(),
})

export const RiskRuleSetSchema = z.object({
  ruleSetVersion: z.string().min(1),
  rules: z.array(RiskRuleSchema),
})

export const TemplateClauseSchema = z.object({
  sectionNo: z.string().min(1),
  sectionTitle: z.string().min(1),
  clauseText: z.string().min(1),
  /** 是否为法定必备条款：范本比对据此把「范本有合同没有」判为严重风险。 */
  isMandatory: z.boolean(),
  linkedRuleCodes: z.array(z.string()),
})

export const ContractTemplateSchema = z.object({
  regionCode: z.string().regex(/^\d{6}$/, '行政区划代码为 6 位数字'),
  regionName: z.string().min(1),
  templateId: z.string().min(1),
  version: z.string().min(1),
  sourceUrl: urlString,
  sourceOrg: z.string().min(1),
  publishDate: isoDate,
  effectiveFrom: z.string().nullable(),
  effectiveTo: z.string().nullable(),
  clauses: z.array(TemplateClauseSchema).min(1),
})

export type DeclaredSource = z.infer<typeof DeclaredSourceSchema>
export type DeclaredLaw = z.infer<typeof DeclaredLawSchema>
export type SourcesFile = z.infer<typeof SourcesFileSchema>
export type StatuteArticle = z.infer<typeof StatuteArticleSchema>
export type Statute = z.infer<typeof StatuteSchema>
export type RiskRule = z.infer<typeof RiskRuleSchema>
export type RiskRuleSet = z.infer<typeof RiskRuleSetSchema>
export type ContractTemplate = z.infer<typeof ContractTemplateSchema>
