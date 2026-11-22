import { z } from 'zod'
import { parsePrivateValuations, type ValuationSnapshot } from './privateValuations'
import { parseCompanyEvidence, type CompanyEvidenceData } from './companyEvidenceData'

export const metrics = ['funding', 'revenue', 'valuation'] as const
export type Metric = (typeof metrics)[number]

const companySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ticker: z.string().optional(),
})

const sourceUrl = z.url({ protocol: /^https?$/ })
const observationSchema = z.object({
  id: z.string().min(1),
  companyId: z.string().min(1),
  valueUsd: z.number().nonnegative(),
  rawValue: z.union([z.number(), z.string()]),
  date: z.iso.date().nullable(),
  sourceUrl,
  sourceName: z.string(),
  sourceType: z.string(),
  confidence: z.string().optional(),
  notes: z.string().optional(),
})

const financialSchema = observationSchema.extend({
  metric: z.enum(metrics),
  basis: z.string().min(1),
  period: z.string().nullish(),
  dateBasis: z.string().optional(),
  reportDate: z.iso.date().nullish(),
  approximate: z.boolean().optional(),
  comparisonEligible: z.boolean().optional(),
  status: z.string().optional(),
  scope: z.string().optional(),
  sourceRecordId: z.string().optional(),
  valueColumn: z.string().optional(),
  qualifier: z.string().optional(),
  origin: z.string().optional(),
  sourceUrls: z.array(sourceUrl).optional(),
  rawRecord: z.record(z.string(), z.string()).optional(),
})

const capexSchema = observationSchema.extend({
  quarter: z.string().regex(/^\d{4}-Q[1-4]$/),
  basis: z.enum(['cash', 'including-finance-leases', 'other']),
  basisDetail: z.string().optional(),
  valueField: z.string().optional(),
  method: z.string().optional(),
  revisions: z.array(z.unknown()).optional(),
  period: z.union([
    z.string(),
    z.object({ start: z.iso.date(), end: z.iso.date(), fiscal: z.string() }),
  ]).optional(),
  sourceDocuments: z.array(z.object({
    url: sourceUrl,
    type: z.string(),
    date: z.iso.date().nullable().optional(),
  })).optional(),
  operatingCashFlowUsd: z.number().nullish(),
  cashFlowSources: z.array(z.object({
    url: sourceUrl,
    type: z.string(),
    date: z.iso.date().nullable().optional(),
  })).optional(),
})

const financialFileSchema = z.object({
  companies: z.array(companySchema),
  financial: z.array(financialSchema),
  metadata: z.object({
    source: z.string(), sourceUrl, license: z.string(), snapshot: z.iso.date(),
  }).optional(),
})

const capexFileSchema = z.object({
  companies: z.array(companySchema),
  capex: z.array(capexSchema),
  metadata: z.object({
    attribution: z.string(), sourceUrl, license: sourceUrl, methodology: sourceUrl, lastUpdated: z.iso.date(),
  }).optional(),
})

const issuerFileSchema = financialFileSchema.pick({ financial: true }).extend({
  companies: z.array(companySchema.extend({ sector: z.string().optional() })),
})
const filingFileSchema = capexFileSchema.pick({ companies: true, capex: true })

const sourcedAmount = z.object({
  id: z.string(), companyId: z.string(), date: z.iso.date(), period: z.string().nullish(),
  valueUsd: z.number().nonnegative(), basis: z.string(), sourceUrl, sourceName: z.string(),
  reportDate: z.iso.date().nullish(), notes: z.string().nullish(),
})
const obligationsFile = z.object({ observations: z.array(sourcedAmount.extend({
  category: z.enum(['unstarted-leases', 'debt', 'backlog', 'guarantees', 'customer-prepayments', 'purchase-lease-commitments']),
  status: z.string(),
})) })
const operatingFile = z.object({ observations: z.array(sourcedAmount.extend({
  kind: z.enum(['consolidated', 'segment', 'trailing']),
  label: z.string(), priorDate: z.iso.date().nullish(), priorValueUsd: z.number().nonnegative().nullish(),
  annualInput: z.object({ sourceUrl }).optional(),
  sourceUrls: z.array(sourceUrl).optional(),
})) })
const outlookFile = z.object({
  publisher: z.string(), sourceUrl,
  outlooks: z.array(z.object({
    companyId: z.string(), name: z.string(), date: z.iso.date(), year: z.number().int(),
    lowUsd: z.number().nonnegative(), highUsd: z.number().nonnegative(),
    approximate: z.boolean(), basis: z.string(), sourceUrl,
  })),
})

export type Company = z.infer<typeof companySchema>
export type FinancialObservation = z.infer<typeof financialSchema>
export type CapexObservation = z.infer<typeof capexSchema>
export type IssuerFinancials = z.infer<typeof issuerFileSchema>
export type FinancingObservation = z.infer<typeof obligationsFile>['observations'][number]
export type OperatingObservation = z.infer<typeof operatingFile>['observations'][number]
export type CapexOutlooks = z.infer<typeof outlookFile>

export interface FinancialDataset {
  financialCompanies: readonly Company[]
  capexCompanies: readonly Company[]
  financial: readonly FinancialObservation[]
  capex: readonly CapexObservation[]
  issuers?: IssuerFinancials
  privateValuations?: ValuationSnapshot
  companyEvidence?: CompanyEvidenceData
  financing?: readonly FinancingObservation[]
  operating?: readonly OperatingObservation[]
  outlooks?: CapexOutlooks
  sources?: {
    financial?: z.infer<typeof financialFileSchema>['metadata']
    capex?: z.infer<typeof capexFileSchema>['metadata']
  }
}

export async function loadFinancialData(
  baseUrl = `${import.meta.env.BASE_URL}data/`,
  signal?: AbortSignal,
): Promise<FinancialDataset> {
  async function read(file: string, optional = false): Promise<unknown> {
    const response = await fetch(`${baseUrl}${file}`, { signal })
    if (optional && (response.status === 404 || response.headers.get('content-type')?.includes('text/html'))) return null
    if (!response.ok) throw new Error(`${file} returned HTTP ${response.status}`)
    return response.json()
  }

  const [financialFile, tracker, issuers, filings, financing, operating, outlooks, privateValuations, companyEvidence] = await Promise.all([
    read('financial.json').then((value) => financialFileSchema.parse(value)),
    read('capex.json').then((value) => capexFileSchema.parse(value)),
    read('ecosystem-financials.json').then((value) => issuerFileSchema.parse(value)),
    read('capex-filings.json').then((value) => filingFileSchema.parse(value)),
    read('obligations.json').then((value) => obligationsFile.parse(value)),
    read('operating-revenue.json').then((value) => operatingFile.parse(value)),
    read('capex-outlooks.json').then((value) => outlookFile.parse(value)),
    read('entities.json', true).then((value) => value == null ? undefined : parsePrivateValuations(value)),
    read('company-evidence.json', true).then((value) => value == null ? undefined : parseCompanyEvidence(value)),
  ])

  const key = (item: CapexObservation) => `${item.companyId}/${item.quarter}/${item.basisDetail ?? item.basis}`
  const filedKeys = new Set(filings.capex.map(key))
  const companies = new Map([...tracker.companies, ...filings.companies].map((item) => [item.id, item]))
  return {
    financialCompanies: financialFile.companies,
    capexCompanies: [...companies.values()],
    financial: financialFile.financial,
    capex: [...filings.capex, ...tracker.capex.filter((item) => !filedKeys.has(key(item)))],
    issuers, privateValuations: privateValuations && latestPrivateValuations(privateValuations, financialFile.companies, financialFile.financial),
    financing: financing.observations, operating: operating.observations, outlooks, companyEvidence,
    sources: { financial: financialFile.metadata, capex: tracker.metadata },
  }
}

export const metricLabels: Record<Metric, string> = {
  funding: 'Funding',
  revenue: 'Revenue',
  valuation: 'Valuation',
}

export const revenueBasis = 'Annualized run rate'
export const issuerRevenueBasis = 'Year revenue'
export const marketCapBasis = 'Public market capitalization'
export const privateMarkBasis = 'Private valuation mark'
export const fundingBasis = 'Primary equity funding'
export const valuationBasis = 'Post-money valuation'
export const labValuationBases = [valuationBasis, 'Reported funding-round valuation']

export function revenueBases(records: readonly FinancialObservation[]) {
  return [...new Set(records
    .filter((record) => record.metric === 'revenue' && record.comparisonEligible !== false)
    .map((record) => record.basis)
    .filter((basis) => basis !== 'Period interpolation' && !basis.toLowerCase().includes('unspecified')))]
    .sort((a, b) => a === revenueBasis ? -1 : b === revenueBasis ? 1 : a.localeCompare(b))
}

export type RankingRow = {
  company: Company
  observation: FinancialObservation | null
  conflicting: boolean
}

export function rankCompanies(
  companies: readonly Company[],
  records: readonly FinancialObservation[],
  metric: Metric,
  basis: string | readonly string[],
): RankingRow[] {
  const bases = typeof basis === 'string' ? [basis] : basis
  return companies.map((company) => {
    const candidates = records.filter((record) =>
      record.companyId === company.id && record.metric === metric &&
      bases.includes(record.basis) && record.comparisonEligible !== false && record.date)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    const latest = candidates[0]
    const conflicting = !!latest && candidates.some((candidate) =>
      candidate.date === latest.date && candidate.valueUsd !== latest.valueUsd)
    return { company, observation: conflicting ? null : latest ?? null, conflicting }
  }).sort((a, b) =>
    (b.observation?.valueUsd ?? -1) - (a.observation?.valueUsd ?? -1) ||
    a.company.name.localeCompare(b.company.name))
}

export function privateValuationObservations(snapshot?: ValuationSnapshot): FinancialObservation[] {
  return (snapshot?.valuations ?? []).map((mark) => ({
    id: `state-of-ai-${mark.id}-${mark.date}`,
    companyId: mark.id,
    metric: 'valuation',
    basis: privateMarkBasis,
    valueUsd: mark.valueUsd,
    rawValue: mark.valueUsd / 1_000_000,
    date: mark.date,
    dateBasis: 'Publisher mark date',
    sourceUrl: mark.source.url,
    sourceName: mark.basis ? 'Epoch AI' : 'State of AI World',
    sourceType: mark.basis ?? 'Publisher valuation snapshot',
    confidence: mark.confidence,
    notes: mark.source.title,
  }))
}

function latestPrivateValuations(snapshot: ValuationSnapshot, companies: readonly Company[], observations: readonly FinancialObservation[]): ValuationSnapshot {
  const rounds = new Map(rankCompanies(companies, observations, 'valuation', valuationBasis).map((row) => [row.company.id, row]))
  return { ...snapshot, valuations: snapshot.valuations.map((mark) => {
    const row = rounds.get(mark.id)
    const record = row?.observation
    const name = row?.company.name ?? mark.name
    if (!record?.date || (record.reportDate ?? record.date) > snapshot.asOf) return { ...mark, name }
    const round = {
      valueUsd: record.valueUsd, date: record.date,
      source: { title: `Epoch AI · ${record.basis}`, url: record.sourceUrl },
    }
    if (record.date <= mark.date) return {
      ...mark, name,
      otherMark: record.valueUsd === mark.valueUsd && record.date === mark.date ? undefined : round,
    }
    return {
      ...mark, ...round, name, basis: record.basis,
      confidence: record.confidence === 'Likely' ? 'reported' : undefined,
      otherMark: { valueUsd: mark.valueUsd, date: mark.date, source: mark.source },
    }
  }) }
}

const exactCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2,
})
const compactCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2,
})
const calendarDate = new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
})

export const formatUsd = (value: number) => exactCurrency.format(value)
export const compactUsd = (value: number) => compactCurrency.format(value)
export function observationUsd(observation: FinancialObservation, compact = false) {
  if (observation.approximate) return `≈ ${compactUsd(observation.valueUsd)}`
  return (compact ? compactUsd : formatUsd)(observation.valueUsd)
}
export const formatDate = (value: string | null) =>
  value ? calendarDate.format(new Date(`${value}T00:00:00Z`)) : 'Date unavailable'
