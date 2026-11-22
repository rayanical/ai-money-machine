import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { AnalysisRanking, type AnalysisRow } from './AnalysisRanking'
import { compactUsd, formatDate, formatUsd, type Company, type FinancingObservation } from './data'
import './financing-chart.css'

type Category = FinancingObservation['category']
const categories: Record<Category, { label: string; description: string }> = {
  'unstarted-leases': { label: 'Leases not yet started', description: 'Future lease payments for leases that have not commenced. The terms and timing differ by company.' },
  debt: { label: 'Long-term debt', description: 'Carrying amounts of long-term debt, excluding finance leases.' },
  backlog: { label: 'Contract backlog', description: 'Disclosed contracted revenue. Select a measure and scope to compare like records.' },
  guarantees: { label: 'Guarantees', description: 'Disclosed guarantee ceilings.' },
  'customer-prepayments': { label: 'Customer prepayments', description: 'Customer payments received during the reported period.' },
  'purchase-lease-commitments': { label: 'Purchase and lease commitments', description: 'Combined obligations as disclosed by the issuer.' },
}

interface FinancingChartProps {
  companies: readonly Company[]
  observations: readonly FinancingObservation[]
  selectedCompanyId: string | null
  onCompanySelect: (id: string) => void
}

export function FinancingChart({ companies, observations, selectedCompanyId, onCompanySelect }: FinancingChartProps) {
  const [categoryChoice, setCategory] = useState<Category>('unstarted-leases')
  const [basisChoice, setBasis] = useState('')
  const [query, setQuery] = useState('')
  const [requestedPage, setRequestedPage] = useState(0)
  const available = Object.keys(categories).filter((key) => observations.some((row) => row.category === key))
  const category = available.includes(categoryChoice) ? categoryChoice : available[0]
  const amounts = observations.filter((row) => row.category === category)
  const coverage = new Map<string, Set<string>>()
  for (const row of amounts) {
    const ids = coverage.get(row.basis) ?? new Set<string>()
    ids.add(row.companyId)
    coverage.set(row.basis, ids)
  }
  const bases = [...coverage.keys()].sort((a, b) => (coverage.get(b)?.size ?? 0) - (coverage.get(a)?.size ?? 0) || a.localeCompare(b))
  const basis = bases.includes(basisChoice) ? basisChoice : bases[0]
  const names = new Map(companies.map((company) => [company.id, company]))
  const matched = amounts.filter((row) => row.basis === basis && names.has(row.companyId))
  const ids = [...new Set(matched.map((row) => row.companyId))]
  const rows = ids.flatMap((id): AnalysisRow[] => {
    const company = names.get(id)
    const history = matched.filter((row) => row.companyId === id).sort((a, b) => b.date.localeCompare(a.date))
    const [latest, prior] = history
    if (!latest || !company) return []
    return [{
      id: latest.id, name: company.name, companyId: id, caption: latest.period ?? formatDate(latest.date),
      value: latest.valueUsd, previous: prior?.valueUsd, exact: formatUsd(latest.valueUsd),
      detail: <>
        <div>{latest.basis} · {formatDate(latest.date)}</div>
        {latest.notes && <div>{latest.notes}</div>}
        <div><a href={latest.sourceUrl} target="_blank" rel="noreferrer">{latest.sourceName}</a>
          {latest.reportDate && ` · Reported ${formatDate(latest.reportDate)}`}</div>
        {prior && <div>Earlier disclosure · {formatDate(prior.date)} · {formatUsd(prior.valueUsd)} · <a href={prior.sourceUrl} target="_blank" rel="noreferrer">Source</a></div>}
      </>,
    }]
  }).filter((row) => {
    const term = query.trim().toLocaleLowerCase()
    return row.name.toLocaleLowerCase().includes(term) || names.get(row.companyId)?.ticker?.toLocaleLowerCase().includes(term)
  })
    .sort((a, b) => b.value - a.value)
  const pageSize = 8
  const pageCount = Math.ceil(rows.length / pageSize)
  const page = Math.min(requestedPage, Math.max(0, pageCount - 1))
  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize)
  const selectedCategory = Object.entries(categories).find(([key]) => key === category)?.[1]
  return (
    <div className="financing-chart">
      <div className="financing-controls">
        <label className="compact-select">
          <span className="sr-only">Financing measure</span>
          <select value={category ?? ''} onChange={(event) => {
            const next = observations.find((row) => row.category === event.target.value)?.category
            if (next) setCategory(next)
            setBasis(''); setQuery(''); setRequestedPage(0)
          }}>
            {Object.entries(categories).filter(([key]) => available.includes(key)).map(([key, item]) =>
              <option key={key} value={key}>{item.label}</option>)}
          </select>
          <ChevronDown size={15} aria-hidden="true" />
        </label>
        {bases.length > 1 && <label className="compact-select">
          <span className="sr-only">Disclosure basis</span>
          <select value={basis} onChange={(event) => { setBasis(event.target.value); setQuery(''); setRequestedPage(0) }}>
            {bases.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <ChevronDown size={15} aria-hidden="true" />
        </label>}
      </div>
      <p className="evidence-description">{selectedCategory?.description}</p>
      {bases.length === 1 && <p className="financing-basis">{basis}</p>}
      <label className="financing-search"><span className="sr-only">Search financing companies</span>
        <input type="search" placeholder="Search available companies" value={query} onChange={(event) => { setQuery(event.target.value); setRequestedPage(0) }} />
      </label>
      <p className="financing-count">{rows.length} {rows.length === 1 ? 'company' : 'companies'}</p>
      <AnalysisRanking rows={pageRows} label={selectedCategory?.label ?? 'Financing exposure'} format={compactUsd} preview
        selectedCompanyId={selectedCompanyId} onCompanySelect={onCompanySelect} />
      {pageCount > 1 && <div className="financing-pagination">
        <span>{page * pageSize + 1}–{Math.min((page + 1) * pageSize, rows.length)} of {rows.length}</span>
        <div><button className="outline-button" type="button" disabled={page === 0} onClick={() => setRequestedPage(page - 1)}>Previous</button>
          <button className="outline-button" type="button" disabled={page >= pageCount - 1} onClick={() => setRequestedPage(page + 1)}>Next</button></div>
      </div>}
      {pageRows.some(({ previous }) => previous != null) && <p className="evidence-key"><i /> Earlier reported value</p>}
      {category === 'backlog' && <a className="exposure-source" href="https://www.regardsofwallstreet.com/data/rpo" target="_blank" rel="noreferrer">Backlog source and methodology</a>}
    </div>
  )
}
