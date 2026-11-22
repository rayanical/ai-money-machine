import { z } from 'zod'

const networkSnapshot = z.object({ as_of: z.iso.date(), entities: z.array(z.unknown()) })
const privateCompany = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  layer: z.string().min(1),
  kind: z.literal('company'),
  ticker: z.literal('').optional(),
  valuation_live: z.literal(false).optional(),
  valuation_musd: z.number().positive(),
  as_of: z.iso.date(),
  confidence: z.enum(['verified', 'reported']),
  sources: z.array(z.unknown()),
})
const valuationCitation = z.object({
  title: z.string().min(1),
  url: z.url({ protocol: /^https?$/ }),
  as_of: z.string().optional(),
  backs: z.array(z.string()),
}).refine(({ backs }) => backs.includes('valuation'))

export interface ValuationMark {
  id: string
  name: string
  sector: string
  ticker?: string
  valueUsd: number
  date: string
  confidence?: 'verified' | 'reported'
  basis?: string
  source: { title: string; url: string }
  otherMark?: Pick<ValuationMark, 'valueUsd' | 'date' | 'source'>
}

export interface ValuationSnapshot {
  asOf: string
  valuations: readonly ValuationMark[]
}

export function parsePrivateValuations(value: unknown): ValuationSnapshot {
  const snapshot = networkSnapshot.parse(value)
  const valuations = snapshot.entities.flatMap((entity) => {
    const parsed = privateCompany.safeParse(entity)
    if (!parsed.success) return []
    const company = parsed.data
    const citations = company.sources.flatMap((citation) => {
      const result = valuationCitation.safeParse(citation)
      return result.success ? [result.data] : []
    })
    // Publication date can differ from the date assigned to the valuation by the publisher.
    const citation = citations.find(({ as_of }) => as_of === company.as_of) ?? citations[0]
    if (!citation) return []
    return [{
      id: company.id,
      name: company.name,
      sector: company.layer,
      valueUsd: company.valuation_musd * 1_000_000,
      date: company.as_of,
      confidence: company.confidence,
      source: { title: citation.title, url: citation.url },
    }]
  })
  return { asOf: snapshot.as_of, valuations }
}
