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

/** 关键词命中即判定。exclude 用于排除同一条款里的例外情形（如"竞业限制的违约金"是合法的）。 */
export const PatternParamsSchema = z.object({
  include: z.array(z.string().min(1)).min(1),
  exclude: z.array(z.string().min(1)).optional(),
})

/**
 * 条款存在性判定。
 * MISSING_ANY：所有条款里都找不到任一关键词 → 命中（法定必备条款缺失）
 * PRESENT_ANY：任一关键词出现 → 命中（出现被禁止的内容）
 */
export const ExistenceParamsSchema = z.object({
  mode: z.enum(['MISSING_ANY', 'PRESENT_ANY']),
  keywords: z.array(z.string().min(1)).min(1),
})

/** 数值比较。需要先从合同抽出事实（如合同期限、试用期长度），尚未实现。 */
export const NumericParamsSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['<', '<=', '>', '>=', '==', '!=']),
  value: z.number(),
})

/** 规则自带正反例：改规则必须同时改用例，否则测试会失败。 */
export const RuleCaseSchema = z.object({
  text: z.string().min(2),
  expect: z.enum(['VIOLATION', 'OK']),
  note: z.string().optional(),
})

const RiskRuleBase = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/, '规则 code 必须是大写下划线形式'),
  title: z.string().min(2),
  level: RiskLevelSchema,
  category: z.string().min(1),
  /** 必须指向真实存在的法条 ID，由 validate:data 校验。规则不允许没有法律依据。 */
  statuteRefs: z.array(z.string()).min(1),
  /** 给劳动者看的说明，与法条原文分开——法条原文一律从法条库按 ID 取，规则里不复制。 */
  explanation: z.string().min(5),
  suggestion: z.string().min(5),
  enabled: z.boolean(),
  cases: z.array(RuleCaseSchema).min(2),
  note: z.string().optional(),
})

/**
 * 规则按判定方式做判别联合，params 的形状由 checkType 决定，
 * 这样引擎里不需要把 params 强转成 any。
 */
export const RiskRuleSchema = z.discriminatedUnion('checkType', [
  RiskRuleBase.extend({ checkType: z.literal('PATTERN_MATCH'), params: PatternParamsSchema }),
  RiskRuleBase.extend({ checkType: z.literal('EXISTENCE'), params: ExistenceParamsSchema }),
  RiskRuleBase.extend({ checkType: z.literal('NUMERIC_COMPARE'), params: NumericParamsSchema }),
])

export const RiskRuleSetSchema = z.object({
  ruleSetVersion: z.string().min(1),
  rules: z.array(RiskRuleSchema).min(1),
})

/** 范本来源声明。 */
export const DeclaredTemplateSchema = z.object({
  name: z.string().min(2),
  /** 行政区划代码，6 位。范本按地区选取，比对时需要知道用哪一份。 */
  regionCode: z.string().regex(/^\d{6}$/, '行政区划代码为 6 位数字'),
  regionName: z.string().min(1),
  version: z.string().min(1),
  /** 正文的容器格式。docx 尚未支持（需要单独的读取器）。 */
  format: z.enum(['html', 'doc']),
  file: z.string().min(1),
  url: urlString,
  publisher: z.string().min(1),
  publisherVerified: z.boolean(),
  publishDate: isoDate,
  retrievedAt: isoDate,
  note: z.string().optional(),
})

export const TemplatesFileSchema = z.object({
  templates: z.record(z.string(), DeclaredTemplateSchema),
})

export const TemplateProvenanceSchema = DeclaredTemplateSchema.extend({
  sha256: sha256Hex,
  issues: z.array(z.string()),
})

export const TemplateArticleSchema = z.object({
  articleNo: z.number().int().positive(),
  articleLabel: z.string().min(2),
  /** 条文正文。范本里的待填写位被替换为 mark-blanks 定义的 FILL 标记，比对时视为通配符。 */
  text: z.string().min(1),
})

export const TemplateSectionSchema = z.object({
  sectionNo: z.string().min(1),
  sectionTitle: z.string().min(1),
  articles: z.array(TemplateArticleSchema).min(1),
})

export const ContractTemplateSchema = z.object({
  templateId: z.string().min(1),
  name: z.string().min(2),
  regionCode: z.string().regex(/^\d{6}$/),
  regionName: z.string().min(1),
  /** 正文之前的块：标题、注意事项、甲乙双方信息栏、序言。原样保留，便于审计。 */
  frontMatter: z.array(z.string()),
  notes: z.array(z.string()),
  sections: z.array(TemplateSectionSchema).min(1),
  /** 签署栏之后的块：附件与页脚。 */
  trailing: z.array(z.string()),
  provenance: z.object({
    generatedAt: z.string(),
    generator: z.string(),
    source: TemplateProvenanceSchema,
    sectionCount: z.number().int().positive(),
    articleCount: z.number().int().positive(),
    fillMarker: z.string().min(1),
  }),
})

export type DeclaredSource = z.infer<typeof DeclaredSourceSchema>
export type DeclaredLaw = z.infer<typeof DeclaredLawSchema>
export type SourcesFile = z.infer<typeof SourcesFileSchema>
export type StatuteArticle = z.infer<typeof StatuteArticleSchema>
export type Statute = z.infer<typeof StatuteSchema>
export type RiskRule = z.infer<typeof RiskRuleSchema>
export type RiskLevel = z.infer<typeof RiskLevelSchema>
export type RuleCase = z.infer<typeof RuleCaseSchema>
export type RiskRuleSet = z.infer<typeof RiskRuleSetSchema>
export type ContractTemplate = z.infer<typeof ContractTemplateSchema>
export type DeclaredTemplate = z.infer<typeof DeclaredTemplateSchema>
export type TemplatesFile = z.infer<typeof TemplatesFileSchema>
export type TemplateSection = z.infer<typeof TemplateSectionSchema>
