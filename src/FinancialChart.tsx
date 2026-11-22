import { max, scaleLinear } from 'd3'
import { ArrowDown, ChevronDown } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import {
  compactUsd, formatDate, fundingBasis, issuerRevenueBasis, labValuationBases, marketCapBasis, metricLabels, metrics, observationUsd,
  privateMarkBasis, privateValuationObservations, rankCompanies, revenueBasis, revenueBases,
  type Company, type FinancialObservation, type IssuerFinancials, type Metric, type OperatingObservation, type RankingRow,
} from './data'
import { OperatingRanking, type OperatingMode } from './OperatingRanking'
import { ValuationRanking } from './ValuationRanking'
import type { ValuationSnapshot } from './privateValuations'
import './styles.css'
import './financial-ranking.css'

interface FinancialChartProps {
  companies: readonly Company[]
  observations: readonly FinancialObservation[]
  issuers?: IssuerFinancials
  operating?: readonly OperatingObservation[]
  privateValuations?: ValuationSnapshot
  selectedCompanyId: string | null
  onCompanySelect: (companyId: string, options?: { showRecords: boolean }) => void
}

const monthYear = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })

function annualGrowth(latest: FinancialObservation, observations: readonly FinancialObservation[]) {
  const year = Number(latest.period?.match(/^FY(\d{4})$/)?.[1])
  const previous = observations.filter((item) => item.companyId === latest.companyId &&
    item.metric === 'revenue' && item.basis === latest.basis && item.period === `FY${year - 1}` &&
    item.comparisonEligible !== false)
  if (previous.length !== 1 || previous[0].valueUsd <= 0) return null
  const growth = 100 * (latest.valueUsd / previous[0].valueUsd - 1)
  return `${growth > 0 ? '+' : ''}${growth.toFixed(1)}% YoY`
}

type IssuerMetric = 'revenue' | 'valuation' | OperatingMode
const issuerMetrics: { id: IssuerMetric; label: string }[] = [
  { id: 'consolidated', label: 'Latest quarterly revenue' },
  { id: 'segment', label: 'Chip and cloud revenue' },
  { id: 'trailing', label: 'Trailing twelve months revenue' },
  { id: 'revenue', label: 'Fiscal-year revenue' },
  { id: 'valuation', label: 'Market capitalization' },
  { id: 'sales-multiple', label: 'Market cap / trailing sales' },
]
const noOperating: readonly OperatingObservation[] = []

export function FinancialChart({ companies, observations, issuers, operating = noOperating, privateValuations, selectedCompanyId, onCompanySelect }: FinancialChartProps) {
  const [universe, setUniverse] = useState<'issuers' | 'labs' | 'private'>('labs')
  const [issuerMetric, setIssuerMetric] = useState<IssuerMetric>('valuation')
  const [labMetric, setLabMetric] = useState<Metric>('valuation')
  const [chosenRevenueBasis, setChosenRevenueBasis] = useState(revenueBasis)
  const [activeRow, setActiveRow] = useState<string | null>(null)
  const hintId = useId()
  const previousSelection = useRef<string | null | undefined>(undefined)
  const publicAvailable = Boolean(issuers?.financial.length)
  const publicView = publicAvailable && universe === 'issuers'
  const privateAvailable = Boolean(privateValuations?.valuations.length)
  const privateView = privateAvailable && universe === 'private'
  const labView = !publicView && !privateView
  const hasMarketCap = issuers?.financial.some((observation) => observation.basis === marketCapBasis)
  const currentLabView = labView && labMetric === 'valuation' && Boolean(privateValuations || hasMarketCap)

  useEffect(() => {
    if (selectedCompanyId === previousSelection.current) return
    previousSelection.current = selectedCompanyId
    if (!selectedCompanyId) return
    const hasPrivateMark = privateValuations?.valuations.some(({ id }) => id === selectedCompanyId)
    setUniverse((current) => {
      if (current === 'private' && hasPrivateMark) return current
      const inLabs = companies.some(({ id }) => id === selectedCompanyId)
      const inPublic = issuers?.financial.length && issuers.companies.some(({ id }) => id === selectedCompanyId)
      if (current === 'labs' && inLabs) return current
      if (inPublic) return 'issuers'
      if (inLabs) return 'labs'
      return hasPrivateMark ? 'private' : current
    })
  }, [companies, issuers, privateValuations, selectedCompanyId])

  const choices = issuerMetrics.filter(({ id }) => {
    if (id === 'valuation') return hasMarketCap
    if (id === 'revenue') return issuers?.financial.some((observation) => observation.basis === issuerRevenueBasis)
    if (id === 'sales-multiple') return hasMarketCap && operating.some((item) => item.kind === 'trailing')
    return operating.some((item) => item.kind === id)
  })
  const publicMetric = choices.find(({ id }) => id === issuerMetric)?.id ?? choices[0]?.id ?? 'revenue'
  const operatingMeasure = publicView && publicMetric !== 'revenue' && publicMetric !== 'valuation' ? publicMetric : null
  const metric = publicView ? (publicMetric === 'valuation' ? 'valuation' : 'revenue') : labMetric
  const bases = revenueBases(observations)
  const activeRevenueBasis = bases.includes(chosenRevenueBasis) ? chosenRevenueBasis : bases[0] ?? revenueBasis
  const labBasis = metric === 'funding' ? fundingBasis : metric === 'valuation' ? labValuationBases : activeRevenueBasis
  const basis = publicView ? (metric === 'revenue' ? issuerRevenueBasis : marketCapBasis) : labBasis
  const data = publicView && issuers ? issuers.financial : observations
  const rankable = publicView && issuers ? (metric === 'revenue' && !operatingMeasure
    ? issuers.companies.filter(({ id }) => data.some((row) => row.companyId === id && row.basis === issuerRevenueBasis))
    : issuers.companies) : companies
  const ranked = rankCompanies(rankable, data, metric, basis)
  const available = ranked.filter((row) => row.observation)
  const unavailable = ranked.filter((row) => !row.observation)
  const dates = [...new Set(available.map((row) => row.observation?.date))]
  const sharedMarketDate = basis === marketCapBasis && dates.length === 1 ? dates[0] : null
  const marketSnapshot: ValuationSnapshot | null = sharedMarketDate && issuers ? {
    asOf: sharedMarketDate,
    valuations: available.flatMap(({ company, observation }) => {
      const issuer = issuers.companies.find(({ id }) => id === company.id)
      if (!observation?.date) return []
      return [{ ...company, sector: issuer?.sector ?? 'Unclassified', ticker: issuer?.ticker,
        valueUsd: observation.valueUsd, date: observation.date,
        source: { title: `${observation.sourceName} market-cap snapshot`, url: observation.sourceUrl } }]
    }),
  } : null
  const listedLabs = new Set(issuers?.companies.map(({ id }) => id))
  const labMarket = currentLabView ? rankCompanies(companies.filter(({ id }) => listedLabs.has(id)), issuers?.financial ?? [], 'valuation', marketCapBasis) : []
  const labPrivate = currentLabView ? rankCompanies(companies.filter(({ id }) => !listedLabs.has(id)), privateValuationObservations(privateValuations), 'valuation', privateMarkBasis) : []
  const missing = currentLabView ? [...labPrivate, ...labMarket].filter((row) => !row.observation) : unavailable
  const definition = publicView ? (metric === 'revenue' ? 'Consolidated annual revenue · Fiscal year ends vary' :
    `Public market capitalization · ${sharedMarketDate ? formatDate(sharedMarketDate) : 'Dates vary'}`) : {
    funding: 'Latest comparable closed primary equity round',
    revenue: 'Latest full-company report',
    valuation: 'Historical funding-round valuation',
  }[metric]

  function renderRow(row: RankingRow, x: (value: number) => number, ticks: readonly number[]) {
    const { company, observation, conflicting } = row
    const missingLabel = conflicting ? 'Conflicting' : 'Unavailable'
    const growth = publicView && metric === 'revenue' && observation ? annualGrowth(observation, data) : null
    return (
      <div key={company.id} className="financial-ranking-item">
        <button type="button" className="ranking-row" aria-pressed={selectedCompanyId === company.id}
          aria-describedby={activeRow === company.id ? `${hintId}-${company.id}` : undefined}
          aria-label={`${company.name}, ${observation ? `${observationUsd(observation)}, ${formatDate(observation.date)}` : missingLabel}. Inspect company records`}
          onMouseEnter={() => setActiveRow(company.id)} onMouseLeave={() => setActiveRow(null)}
          onFocus={() => setActiveRow(company.id)} onBlur={() => setActiveRow(null)}
          onKeyDown={(event) => { if (event.key === 'Escape') setActiveRow(null) }}
          onClick={() => { setActiveRow(null); onCompanySelect(company.id) }}>
          <span className="ranking-name">{company.name}
            {publicView && metric === 'revenue' && observation?.date && <time className="rank-subtitle" dateTime={observation.date}>
              {monthYear.format(new Date(`${observation.date}T00:00:00Z`))}
            </time>}
          </span>
          <svg className="ranking-track" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
            {observation && ticks.map((tick) => <line key={tick} x1={x(tick)} x2={x(tick)} y1="0" y2="24" vectorEffect="non-scaling-stroke" />)}
            {observation && <rect className="ranking-bar" x="0" y="5" width={x(observation.valueUsd)} height="14" />}
          </svg>
          {observation ? (
            <span className="ranking-value">
              <strong>{observationUsd(observation, true)}</strong>
              {publicView && metric === 'revenue' ? <span className="rank-subtitle">{growth ?? observation.period}</span> :
                !sharedMarketDate && <time className="rank-subtitle" dateTime={observation.date ?? undefined}>{formatDate(observation.date)}</time>}
              {currentLabView && observation.confidence === 'reported' && <span className="rank-subtitle">Reported</span>}
            </span>
          ) : <span className="ranking-missing">{missingLabel}</span>}
        </button>
        {activeRow === company.id && <div id={`${hintId}-${company.id}`} role="tooltip" className="ranking-inspect financial-ranking-tooltip"><FinancialTooltip row={row} /></div>}
      </div>
    )
  }

  function renderRanking(rows: readonly RankingRow[], label: string) {
    const values = rows.filter((row) => row.observation)
    if (!values.length) return null
    const x = scaleLinear().domain([0, max(values, (row) => row.observation?.valueUsd) || 1]).nice(4).range([0, 100])
    const ticks = x.ticks(4)
    return (
      <div className="ranking" role="group" aria-label={label} aria-describedby={hintId}>
        <div className="ranking-head" aria-hidden="true">
          <span>Company</span>
          <div className="ranking-axis">{ticks.filter((tick) => x(tick) <= 99.9).map((tick) => (
            <span key={tick} style={{ left: `${x(tick)}%` }}>{compactUsd(tick)}</span>
          ))}</div>
          <span className="ranking-sort">Value <ArrowDown size={12} /></span>
        </div>
        <div className="ranking-rows">{values.map((row) => renderRow(row, x, ticks))}</div>
      </div>
    )
  }

  return (
    <div className="financial-chart">
      <div className="chart-controls">
        {(publicAvailable || privateAvailable) && (
          <div className="segmented company-universe" role="group" aria-label="Company universe">
            <button type="button" aria-pressed={labView} onClick={() => { setUniverse('labs'); setActiveRow(null) }}>AI labs</button>
            {publicAvailable && <button type="button" aria-pressed={publicView} onClick={() => { setUniverse('issuers'); setActiveRow(null) }}>Public companies</button>}
            {privateAvailable && <button type="button" aria-pressed={privateView} onClick={() => { setUniverse('private'); setActiveRow(null) }}>Private valuations</button>}
          </div>
        )}
        {publicView && choices.length > 1 && (
          <label className="compact-select">
            <span className="sr-only">Public company metric</span>
            <select value={publicMetric} onChange={(event) => {
              const next = choices.find(({ id }) => id === event.target.value)
              if (next) { setIssuerMetric(next.id); setActiveRow(null) }
            }}>
              {choices.map(({ id, label }) => <option value={id} key={id}>{label}</option>)}
            </select>
            <ChevronDown size={15} aria-hidden="true" />
          </label>
        )}
        {labView && (
          <div className="segmented" role="group" aria-label="Financial metric">
            {metrics.map((choice) => <button key={choice} type="button" aria-pressed={labMetric === choice}
              onClick={() => { setLabMetric(choice); setActiveRow(null) }}>{metricLabels[choice]}</button>)}
          </div>
        )}
        {labView && metric === 'revenue' && bases.length > 0 && (
          <label className="compact-select revenue-basis">
            <span className="sr-only">Revenue reporting basis</span>
            <select value={activeRevenueBasis} onChange={(event) => { setChosenRevenueBasis(event.target.value); setActiveRow(null) }}>
              {bases.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <ChevronDown aria-hidden="true" size={15} />
          </label>
        )}
      </div>
      {privateView && privateValuations ? <ValuationRanking key="private" mode="private" snapshot={privateValuations} selectedCompanyId={selectedCompanyId}
        onCompanySelect={(id) => onCompanySelect(id, { showRecords: false })} /> :
      marketSnapshot ? <ValuationRanking key="public" mode="public" snapshot={marketSnapshot} selectedCompanyId={selectedCompanyId}
        onCompanySelect={(id) => onCompanySelect(id, { showRecords: false })} /> :
      operatingMeasure && issuers ? <OperatingRanking companies={issuers.companies} observations={operating}
        issuerFinancial={issuers.financial} measure={operatingMeasure} selectedCompanyId={selectedCompanyId} onCompanySelect={onCompanySelect} /> : <>
      {currentLabView ? <>
        <div className="chart-context" id={hintId}><span>Current sourced valuations</span><span className="units">USD</span></div>
        {labPrivate.some(({ observation }) => observation) && <section className="lab-valuation-group" aria-label="Private lab valuations">
          <h3>Private valuation marks</h3>
          {renderRanking(labPrivate, 'Private lab valuation ranking')}
        </section>}
        {labMarket.some(({ observation }) => observation) && <section className="lab-valuation-group" aria-label="Listed lab market caps">
          <h3>Public market capitalization</h3>
          {renderRanking(labMarket, 'Listed lab market cap ranking')}
        </section>}
        {missing.length === companies.length && <p className="empty-state">No current valuation marks are available.</p>}
      </> : <>
      <div className="chart-context" id={hintId}>
        <span>{definition}</span>
        <span className="units">{available.length} of {ranked.length}<span className="sr-only"> available</span> · USD</span>
      </div>
      {renderRanking(available, `${basis === marketCapBasis ? 'Market cap' : metricLabels[metric]} ranking`) ??
        <p className="empty-state">No comparable observations on this basis.</p>}
      </>}
      {missing.length > 0 && (
        <details className="missing-ranks">
          <summary>{missing.length} {missing.length === 1 ? 'company' : 'companies'} without {currentLabView ? 'a current valuation' : 'a comparable value'}</summary>
          {missing.map((row) => renderRow(row, () => 0, []))}
        </details>
      )}
      </>}
    </div>
  )
}

function FinancialTooltip({ row }: { row: RankingRow }) {
  const { company, observation } = row
  if (!observation) {
    return <span><strong>{company.name}</strong> · {row.conflicting ? 'The latest records disagree.' : 'No observation for this metric and basis.'}</span>
  }
  return (
    <>
      <div className="inspect-top">
        <strong>{company.name}</strong><strong className="mono">{observationUsd(observation)}</strong>
      </div>
      <div>{observation.period ? `${observation.period} · ` : ''}{observation.basis} · {formatDate(observation.date)}</div>
      <div>{observation.sourceName} · {observation.sourceType}</div>
      {observation.basis === privateMarkBasis && observation.notes && <div>{observation.notes}</div>}
      {observation.qualifier && <div>{observation.qualifier}</div>}
    </>
  )
}
