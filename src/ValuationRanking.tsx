import { max, scaleLinear } from 'd3'
import { ArrowDown, ArrowUpRight, ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { compactUsd, formatDate, formatUsd } from './data'
import type { ValuationSnapshot } from './privateValuations'
import './private-valuations.css'

interface ValuationRankingProps {
  snapshot: ValuationSnapshot
  mode: 'private' | 'public'
  selectedCompanyId: string | null
  onCompanySelect: (id: string) => void
}

const pageSize = 8

export function ValuationRanking({ snapshot, mode, selectedCompanyId, onCompanySelect }: ValuationRankingProps) {
  const [query, setQuery] = useState('')
  const [sector, setSector] = useState('')
  const [requestedPage, setRequestedPage] = useState(0)
  const market = mode === 'public'
  const label = market ? 'Market cap ranking' : 'Private valuation ranking'

  const ranked = useMemo(() => [...snapshot.valuations].sort((a, b) =>
    b.valueUsd - a.valueUsd || a.name.localeCompare(b.name)), [snapshot.valuations])
  const sectors = useMemo(() => [...new Set(ranked.map((item) => item.sector))]
    .sort((a, b) => a.localeCompare(b)), [ranked])
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return ranked.filter((item) => (!sector || item.sector === sector) &&
      (!term || item.name.toLocaleLowerCase().includes(term) || item.ticker?.toLocaleLowerCase().includes(term)))
  }, [ranked, query, sector])
  const pageCount = Math.ceil(filtered.length / pageSize)
  const page = Math.min(requestedPage, Math.max(0, pageCount - 1))
  const pageRows = filtered.slice(page * pageSize, (page + 1) * pageSize)
  const selected = filtered.find((item) => item.id === selectedCompanyId)
  const scale = scaleLinear().domain([0, max(filtered, (item) => item.valueUsd) || 1]).nice(4).range([0, 100])
  const ticks = scale.ticks(4)

  return (
    <div className="private-valuations">
      <div className="private-valuation-controls">
        <label className="private-valuation-search">
          <span className="sr-only">Search {mode} companies</span>
          <input type="search" placeholder={market ? 'Name or ticker' : 'Search companies'} value={query} onChange={(event) => {
            setQuery(event.target.value)
            setRequestedPage(0)
          }} />
        </label>
        <label className="compact-select private-valuation-sector">
          <span className="sr-only">Company sector</span>
          <select value={sector} onChange={(event) => {
            setSector(event.target.value)
            setRequestedPage(0)
          }}>
            <option value="">All sectors</option>
            {sectors.map((name) => <option value={name} key={name}>{name}</option>)}
          </select>
          <ChevronDown size={15} aria-hidden="true" />
        </label>
      </div>

      <div className="chart-context private-valuation-context">
        <span>{market ? `Market cap · ${formatDate(snapshot.asOf)}` : 'Latest sourced valuation mark'}</span>
        <span className="units">{filtered.length} {filtered.length === 1 ? 'company' : 'companies'} · USD</span>
      </div>
      {pageRows.length ? (
        <div className="ranking" role="group" aria-label={label}>
          <div className="ranking-head" aria-hidden="true">
            <span>Company</span>
            <div className="ranking-axis">{ticks.filter((tick) => scale(tick) <= 99.9).map((tick) => (
              <span key={tick} style={{ left: `${scale(tick)}%` }}>{compactUsd(tick)}</span>
            ))}</div>
            <span className="ranking-sort">Value <ArrowDown size={12} /></span>
          </div>
          <div className="ranking-rows">
            {pageRows.map((item) => (
              <button key={item.id} type="button" className="ranking-row" aria-pressed={selectedCompanyId === item.id}
                aria-label={`${item.name}, ${formatUsd(item.valueUsd)}, ${formatDate(item.date)}. Show valuation source`}
                onClick={() => onCompanySelect(item.id)}>
                <span className="ranking-name">{item.name}</span>
                <svg className="ranking-track" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
                  {ticks.map((tick) => <line key={tick} x1={scale(tick)} x2={scale(tick)} y1="0" y2="24" vectorEffect="non-scaling-stroke" />)}
                  <rect className="ranking-bar" x="0" y="5" width={scale(item.valueUsd)} height="14" />
                </svg>
                <span className="ranking-value"><strong>{compactUsd(item.valueUsd)}</strong>
                  {market ? <span className="rank-subtitle">{item.ticker}</span> :
                    <time className="rank-subtitle" dateTime={item.date}>{formatDate(item.date)}</time>}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : <p className="empty-state">No companies match your search and sector.</p>}

      {pageCount > 1 && <div className="private-valuation-pagination" aria-label={`${label} pages`}>
        <span aria-live="polite">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length}</span>
        <div>
          <button type="button" className="outline-button" disabled={page === 0} onClick={() => setRequestedPage(page - 1)}>Previous</button>
          <button type="button" className="outline-button" disabled={page >= pageCount - 1} onClick={() => setRequestedPage(page + 1)}>Next</button>
        </div>
      </div>}

      {selected && <section className="private-valuation-detail" aria-label={`${selected.name} valuation details`}>
        <div className="private-valuation-detail-heading"><strong>{selected.name}</strong><strong className="mono">{formatUsd(selected.valueUsd)}</strong></div>
        <p>{[selected.sector, formatDate(selected.date), selected.basis,
          selected.confidence === 'verified' ? 'Verified source' : selected.confidence === 'reported' ? 'Reported source' : null].filter(Boolean).join(' · ')}</p>
        <a href={selected.source.url} target="_blank" rel="noreferrer">{selected.source.title} <ArrowUpRight size={12} aria-hidden="true" /></a>
        {selected.otherMark && <p>Other sourced mark · {compactUsd(selected.otherMark.valueUsd)} · {formatDate(selected.otherMark.date)} · <a href={selected.otherMark.source.url} target="_blank" rel="noreferrer">{selected.otherMark.source.title.startsWith('Epoch AI') ? 'Epoch AI citation' : 'State of AI World citation'}</a></p>}
      </section>}
      <p className="private-valuation-note">{market ? 'Revenue coverage varies by metric.' : 'Dated publisher marks and newer eligible Epoch AI funding rounds. Transaction types vary.'} <a href="https://stateofai.world/open-data" target="_blank" rel="noreferrer">State of AI World</a>{!market && ` · snapshot ${formatDate(snapshot.asOf)}`} · CC BY 4.0</p>
    </div>
  )
}
