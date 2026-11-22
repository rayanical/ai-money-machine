import { ArrowUpRight, ChevronDown, ChevronRight, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { CompanyEvidence } from './CompanyEvidence'
import type { CompanyEvidenceData } from './companyEvidenceData'
import {
  formatDate, fundingBasis, issuerRevenueBasis, labValuationBases, marketCapBasis, metricLabels, metrics, observationUsd,
  privateMarkBasis, rankCompanies, revenueBasis,
  type Company, type FinancialObservation, type Metric,
} from './data'
import './company-records.css'

interface CompanyRecordsProps {
  company: Company | undefined
  companies: readonly Company[]
  observations: readonly FinancialObservation[]
  evidence?: CompanyEvidenceData
  hasCapex: boolean
  onCompanySelect: (companyId: string) => void
}

const labValuationLabel = 'Funding-round valuation'

export function CompanyRecords({ company, companies, observations, evidence, hasCapex, onCompanySelect }: CompanyRecordsProps) {
  const [choice, setChoice] = useState<{ id: string; metric: Metric }>()
  const [pins, setPins] = useState<string[]>([])
  const pinned = company ? pins.includes(company.id) : false
  const rows = observations.filter((row) => row.companyId === company?.id)
  const recordCompanies = new Set([...observations, ...(evidence?.history ?? []), ...(evidence?.compute ?? [])].map(({ companyId }) => companyId))
  const eligibleCompanies = companies.filter(({ id }) => recordCompanies.has(id))
  const availableMetrics = metrics.filter((item) => rows.some((row) => row.metric === item))
  const metric = choice && choice.id === company?.id && availableMetrics.includes(choice.metric) ? choice.metric :
    rows.some((row) => row.basis === issuerRevenueBasis && row.scope === 'Consolidated company') ? 'revenue' :
    rows.some((row) => row.metric === 'valuation') ? 'valuation' : rows[0]?.metric ?? 'revenue'
  const visibleRows = rows.filter((row) => row.metric === metric)
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
  const comparison = companies.filter((item) => pins.includes(item.id))
  const columns: { metric: Metric; basis: string; acceptedBases?: readonly string[] }[] = [
    { metric: 'funding', basis: fundingBasis },
    { metric: 'revenue', basis: revenueBasis },
    { metric: 'valuation', basis: privateMarkBasis },
    { metric: 'valuation', basis: labValuationLabel, acceptedBases: labValuationBases },
    { metric: 'revenue', basis: issuerRevenueBasis },
    { metric: 'valuation', basis: marketCapBasis },
  ]
  const ranked = columns.map(({ metric, basis, acceptedBases }) => new Map(rankCompanies(comparison, observations, metric, acceptedBases ?? basis)
    .map((row) => [row.company.id, row])))
  const publicCompany = rows.some((row) => row.basis === marketCapBasis && row.comparisonEligible !== false)
  const privateMark = rows.some((row) => row.basis === privateMarkBasis)
  const snapshot = company ? columns.filter(({ metric, basis }) => {
    if (metric === 'funding') return true
    if (metric === 'valuation') return basis === (publicCompany ? marketCapBasis : privateMark ? privateMarkBasis : labValuationLabel)
    const preferredRevenue = publicCompany || !rows.some((row) => row.basis === revenueBasis && row.comparisonEligible !== false)
      ? issuerRevenueBasis : revenueBasis
    return basis === preferredRevenue
  }).map(({ metric, basis, acceptedBases }) => ({ metric, basis, result: rankCompanies([company], rows, metric, acceptedBases ?? basis)[0] })) : []

  return (
    <section className="records-panel" aria-label="Company records">
      <div className="records-select">
        {eligibleCompanies.length > 0 && <div className="record-actions">
          <label className="compact-select">
            <span className="sr-only">Company to inspect</span>
            <select value={company && recordCompanies.has(company.id) ? company.id : ''} onChange={(event) => onCompanySelect(event.target.value)}>
              <option value="" disabled>Choose a company</option>
              {eligibleCompanies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <ChevronDown aria-hidden="true" size={15} />
          </label>
          {company && rows.length > 0 && <button className="outline-button" type="button" aria-pressed={pinned} onClick={() =>
            setPins((current) => pinned ? current.filter((id) => id !== company.id) : [...current, company.id])}>
            {pinned ? <X size={15} /> : <Plus size={15} />}
            {pinned ? 'Unpin' : 'Pin to compare'}
          </button>}
        </div>}
      </div>
      {comparison.length > 0 && (
        <div className="comparison-table table-scroll" tabIndex={0} role="region" aria-label="Pinned companies">
          <table>
            <caption>Pinned companies · Latest eligible observation by basis</caption>
            <thead><tr><th scope="col">Company</th><th scope="col">Primary equity</th><th scope="col">Run-rate revenue</th><th scope="col">Private valuation mark</th><th scope="col">Historical funding round</th><th scope="col">Full-year revenue</th><th scope="col">Public market cap</th></tr></thead>
            <tbody>
              {comparison.map((item) => <tr key={item.id}>
                <th scope="row"><button type="button" className="text-button" onClick={() => onCompanySelect(item.id)}>{item.name}</button></th>
                {ranked.map((lookup, index) => {
                  const result = lookup.get(item.id)
                  const value = result?.observation
                  return <td key={columns[index].basis}>{value ?
                    <><span className="mono">{observationUsd(value, true)}</span><span className="cell-muted">{formatDate(value.date)}</span></> :
                    result?.conflicting ? 'Conflicting' : 'Unavailable'}</td>
                })}
              </tr>)}
            </tbody>
          </table>
        </div>
      )}
      {company ? <div className="records-body">
        {rows.length > 0 && <div className="records-snapshot">
          <dl>
            {snapshot.map(({ metric: item, basis, result }) => {
              const observation = result.observation
              return <div key={basis}>
                <dt><strong>{metricLabels[item]}</strong><span>{observation?.basis ?? basis}{basis === issuerRevenueBasis && publicCompany ? ' · issuer-wide' : ''}</span></dt>
                <dd>{observation ? <>
                  <a className="source-link mono" href={observation.sourceUrl} target="_blank" rel="noreferrer"
                    aria-label={`${metricLabels[item]}, ${observationUsd(observation)} · ${observation.sourceName}`}>
                    {observationUsd(observation, true)} <ArrowUpRight size={12} aria-hidden="true" />
                  </a>
                  <span>{[observation.period, formatDate(observation.date)].filter(Boolean).join(' · ')}</span>
                </> : <span>{result.conflicting ? 'Conflicting' : 'Unavailable'}</span>}</dd>
              </div>
            })}
          </dl>
        </div>}
        {hasCapex && <a className="records-capex-link" href="#capex">View company capex</a>}
        {rows.length > 0 && <details key={`source-records-${company.id}`} className="chart-disclosure records-history">
          <summary><ChevronRight aria-hidden="true" size={15} /><span>Source records</span>
            <span className="disclosure-context">{rows.length} {rows.length === 1 ? 'observation' : 'observations'}</span>
          </summary>
          <div className="records-tabs">
            <div className="segmented" role="group" aria-label="Company record metric">
              {availableMetrics.map((item) => (
                <button key={item} type="button" aria-pressed={item === metric} onClick={() => setChoice({ id: company.id, metric: item })}>
                  {metricLabels[item]} <span className="record-count">{rows.filter((row) => row.metric === item).length}</span>
                </button>
              ))}
            </div>
          </div>
          {visibleRows.length ? (
            <div className="table-scroll records-table" tabIndex={0} role="region" aria-label={`${company.name} ${metricLabels[metric]} observations`}>
              <table role="table">
                <thead><tr role="row"><th scope="col">Date</th><th scope="col">Reported value</th><th scope="col">Basis</th><th scope="col">Source</th></tr></thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr key={row.id} role="row">
                      <td role="cell"><time dateTime={row.date ?? undefined}>{formatDate(row.date)}</time>{row.dateBasis && <span className="cell-muted">{row.dateBasis}</span>}
                        {row.reportDate && row.reportDate !== row.date && <span className="cell-muted">Reported {formatDate(row.reportDate)}</span>}
                      </td>
                      <td role="cell" className="mono">{observationUsd(row)}</td>
                      <td role="cell">{row.basis}<span className="cell-muted">{[row.period, row.status, row.scope].filter(Boolean).join(' · ')}</span>
                        {row.qualifier && <span className="cell-muted">{row.qualifier}</span>}
                      </td>
                      <td role="cell">
                        <a href={row.sourceUrl} target="_blank" rel="noreferrer" className="source-link">{row.sourceName} <ArrowUpRight size={13} aria-hidden="true" /></a>
                        <span className="cell-muted">{[row.sourceType, row.confidence].filter(Boolean).join(' · ')}</span>
                        {(row.notes || (row.sourceUrls?.length ?? 0) > 1) && <details className="record-notes">
                          <summary>Source notes</summary>
                          {row.notes && <p>{row.notes}</p>}
                          {row.sourceUrls?.slice(1).map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">Supporting source {index + 1}</a>)}
                        </details>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="empty-state">No {metricLabels[metric].toLowerCase()} observations for {company.name}.</p>}
        </details>}
        {evidence && <CompanyEvidence key={company.id} companyId={company.id} data={evidence} />}
      </div> : <p className="empty-state">Select a company in either chart to inspect its records.</p>}
    </section>
  )
}
