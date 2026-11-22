import { z } from 'zod'

const evidenceSchema = z.object({
  snapshot: z.iso.date(),
  history: z.array(z.object({
    companyId: z.string(),
    points: z.array(z.object({ date: z.iso.date(), valueUsd: z.number().positive() })),
  })),
  compute: z.array(z.object({
    id: z.string(), companyId: z.string(), valueUsd: z.number().nonnegative(), rawValue: z.string(),
    date: z.iso.date(), period: z.string(), category: z.string(), reportDate: z.iso.date().nullable(),
    confidence: z.string(), sourceType: z.string(), sources: z.array(z.url({ protocol: /^https?$/ })).min(1),
    notes: z.string(), excludedFromGraph: z.boolean(),
  })),
})
export type CompanyEvidenceData = z.infer<typeof evidenceSchema>
export const parseCompanyEvidence = (value: unknown): CompanyEvidenceData => evidenceSchema.parse(value)
