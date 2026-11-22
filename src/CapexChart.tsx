import { group, line, max, scaleLinear } from 'd3'
import { ArrowUpRight, ChevronDown } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { compactUsd, formatDate, formatUsd, type CapexObservation, type Company } from './data'
import { useChartWidth } from './useChartWidth'
import './styles.css'
import './capex.css'

interface CapexChartProps {
  observations: readonly CapexObservation[]
  companies: readonly Company[]
  selectedCompanyId: string | null
  onCompanySelect: (companyId: string) => void
}

const cashBasis = 'cash-property-equipment'
const definitions: Record<string, { label: string; description: string }> = {
  [cashBasis]: { label: 'Cash · property and equipment', description: 'Company-wide cash paid for property and equipment.' },
  'cash-productive-assets': { label: 'Cash · productive assets', description: 'Company-wide cash for productive assets, which can include software and intangibles.' },
  'microsoft-accrual-including-finance-lease-commencements': { label: 'Microsoft · with lease commencements', description: 'Includes finance leases at their full value when they commence.' },
  'amazon-net-including-equipment-finance-leases': { label: 'Amazon · net with equipment leases', description: 'Net of proceeds and incentives, including equipment finance leases.' },
  'amazon-net-cash-capex': { label: 'Amazon · net cash capex', description: 'Cash spending net of property and equipment proceeds and incentives.' },
  'meta-including-finance-lease-principal-payments': { label: 'Meta · with lease principal', description: 'Includes principal payments on finance leases.' },
  'oracle-cash-capex': { label: 'Oracle · tracker cash capex', description: 'Cash capex as labeled by the Hyperscaler Capex Tracker.' },
  'coreweave-cash-capex': { label: 'CoreWeave · tracker cash capex', description: 'Cash capex as labeled by the tracker, based on a secondary report.' },
}
const companyColors: Record<string, string> = {
  alphabet: '#3e62a2', amazon: '#b65323', microsoft: '#147457', meta: '#9a4b83',
  oracle: '#a34634', coreweave: '#826717', amd: '#376f7a', nvidia: '#527b24', broadcom: '#6551a3',
}
const fallbackColors = ['#3e62a2', '#b65323', '#147457', '#9a4b83', '#826717', '#376f7a']
const noHiddenCompanies: ReadonlySet<string> = new Set()
const defaultCompanies = ['alphabet', 'microsoft', 'meta', 'oracle', 'coreweave', 'amd', 'broadcom', 'amazon', 'nvidia']

type Measure = 'amount' | 'cash-share'
type Quarter = CapexObservation & { index: number }
type Point = { record: Quarter; value: number; window?: readonly Quarter[] }

function basisKey(item: CapexObservation) {
  return item.basisDetail || (item.basis === 'cash' ? item.basis : `${item.basis}:${item.companyId}`)
}

function quarterIndex(quarter: string) {
  const [year, label] = quarter.split('-Q')
  return Number(year) * 4 + Number(label) - 1
}

function quarterLabel(index: number, compact: boolean) {
  const year = Math.floor(index / 4)
  return `Q${index % 4 + 1} ${compact ? `’${String(year).slice(-2)}` : year}`
}

function rollingCashShares(rows: Quarter[]): Point[] {
  return rows.flatMap((record, index) => {
    if (index < 3) return []
    const window = rows.slice(index - 3, index + 1)
    if (record.index - window[0].index !== 3 ||
        window.some((quarter, i) => quarter.index !== window[0].index + i || quarter.operatingCashFlowUsd == null)) return []
    const cash = window.reduce((sum, quarter) => sum + (quarter.operatingCashFlowUsd ?? 0), 0)
    if (cash <= 0) return []
    const spending = window.reduce((sum, quarter) => sum + quarter.valueUsd, 0)
    return [{ record, value: 100 * spending / cash, window }]
  })
}

function breakAtGaps(points: Point[]) {
  const runs: Point[][] = []
  for (const point of points) {
    const last = runs.at(-1)
    const previous = last?.at(-1)
    if (last && previous && point.record.index === previous.record.index + 1) last.push(point)
    else runs.push([point])
  }
  return runs
}

const formatShare = (value: number) => `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`

export function CapexChart({ observations, companies, selectedCompanyId, onCompanySelect }: CapexChartProps) {
  const bases = [...new Set(observations.map(basisKey))]
  const [basisChoice, setBasisChoice] = useState(cashBasis)
  const [measure, setMeasure] = useState<Measure>('amount')
  const [hiddenByBasis, setHiddenByBasis] = useState<Record<string, ReadonlySet<string>>>({})
  const [included, setIncluded] = useState<ReadonlySet<string>>(() => {
    const ids = new Set(observations.map(({ companyId }) => companyId))
    const defaults = defaultCompanies.filter((id) => ids.has(id))
    return new Set(defaults.length ? defaults : [...ids].slice(0, 7))
  })
  const [companyQuery, setCompanyQuery] = useState('')
  const [pickerMessage, setPickerMessage] = useState('')
  const [hoveredCompany, setHoveredCompany] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const [hoverQuarter, setHoverQuarter] = useState<number | null>(null)
  const { ref, width } = useChartWidth()
  const controlId = useId()
  const basis = bases.includes(basisChoice) ? basisChoice : bases[0]
  const hidden = hiddenByBasis[basis] ?? noHiddenCompanies
  const companyNames = new Map(companies.map(({ id, name }) => [id, name]))
  const colors = new Map(companies.map(({ id }, index) => [id, companyColors[id] ?? fallbackColors[index % fallbackColors.length]]))

  useEffect(() => {
    setPinnedId((current) => current && observations.some(({ id, companyId }) =>
      id === current && companyId === selectedCompanyId) ? current : null)
    if (!selectedCompanyId) return
    const matching = observations.filter((item) => item.companyId === selectedCompanyId).map(basisKey)
    const preferred = matching.find((key) => key === cashBasis || key === 'cash-productive-assets') ?? matching[0]
    if (!preferred) return
    setIncluded((current) => new Set([...current, selectedCompanyId]))
    setBasisChoice((current) => matching.includes(current) ? current : preferred)
    setHiddenByBasis((current) => Object.fromEntries(Object.entries(current).map(([key, ids]) =>
      [key, new Set([...ids].filter((id) => id !== selectedCompanyId))],
    )))
  }, [observations, selectedCompanyId])

  const allSeries = useMemo(() => {
    const rows: Quarter[] = observations.filter((item) => basisKey(item) === basis)
      .map((item) => ({ ...item, index: quarterIndex(item.quarter) }))
      .filter((item) => Number.isFinite(item.index) && Number.isFinite(item.valueUsd))
    return [...group(rows, (item) => item.companyId)].map(([id, periods]) => {
      const ordered = periods.sort((a, b) => a.index - b.index)
      return { id, amount: ordered.map((record): Point => ({ record, value: record.valueUsd / 1e9 })), ratios: rollingCashShares(ordered) }
    })
  }, [basis, observations])
  const series = allSeries.filter(({ id }) => included.has(id))
  const supportsCashShare = series.some(({ ratios }) => ratios.length > 0)
  const cashShare = measure === 'cash-share' && supportsCashShare
  const plotted = series.map(({ id, amount, ratios }) => ({ id, points: cashShare ? ratios : amount }))
    .filter(({ points }) => points.length > 0)
  const all = plotted.flatMap(({ points }) => points)
  const visible = plotted.filter(({ id }) => !hidden.has(id))
  const visiblePoints = visible.flatMap(({ points }) => points)
  const active = visiblePoints.find((point) => point.record.id === (hoverId ?? pinnedId))
  const selectedVisible = visible.some(({ id }) => id === selectedCompanyId)
  const highlight = hoveredCompany ?? (selectedVisible ? selectedCompanyId : null)
  const minimum = all.length ? Math.min(...all.map(({ record }) => record.index)) : 0
  const maximum = all.length ? Math.max(...all.map(({ record }) => record.index)) : 0
  const previewQuarter = hoverQuarter ?? active?.record.index ?? maximum
  const preview = visiblePoints.filter(({ record }) => record.index === previewQuarter)
    .sort((a, b) => b.value - a.value)
  const chartWidth = Math.max(width, 260)
  const compact = chartWidth < 460
  const chartHeight = compact ? 270 : 325
  const margin = { left: 48, right: 22, top: 33, bottom: 35 }
  const x = scaleLinear().domain([minimum, maximum === minimum ? minimum + 1 : maximum]).range([margin.left, chartWidth - margin.right])
  const y = scaleLinear().domain([0, max(all, (point) => point.value) || 1]).nice(5).range([chartHeight - margin.bottom, margin.top])
  const tickCount = all.length ? Math.min(maximum - minimum + 1, compact ? 4 : 8) : 0
  const ticks = Array.from({ length: tickCount }, (_, i) =>
    minimum + Math.round(i * (maximum - minimum) / Math.max(1, tickCount - 1)))
  const path = line<Point>().x(({ record }) => x(record.index)).y(({ value }) => y(value))
  const display = (point: Point) => cashShare ? formatShare(point.value) : compactUsd(point.record.valueUsd)
  const amountLabel = cashShare ? '% of operating cash flow' : 'USD billions'

  function labelFor(key: string) {
    if (definitions[key]) return definitions[key].label
    const match = observations.find((item) => basisKey(item) === key)
    if (!match || match.basisDetail) return key
    if (match.basis === 'cash') return 'Cash capex'
    return `${companyNames.get(match.companyId) ?? match.companyId} · ${match.basis === 'other' ? 'Other basis' : 'Including finance leases'}`
  }

  function clearPoint() {
    setHoverId(null)
    setPinnedId(null)
    setHoverQuarter(null)
  }

  function activate(point: Point) {
    setPinnedId(point.record.id)
    onCompanySelect(point.record.companyId)
  }

  const eligibleIds = new Set(allSeries.filter(({ amount, ratios }) =>
    cashShare ? ratios.length > 0 : amount.length > 0).map(({ id }) => id))
  const searchTerm = companyQuery.trim().toLocaleLowerCase()
  const matches = companies.filter((company) => eligibleIds.has(company.id) &&
    (!searchTerm || company.name.toLocaleLowerCase().includes(searchTerm) ||
      company.ticker?.toLocaleLowerCase().includes(searchTerm)))
    .sort((a, b) => a.name.localeCompare(b.name))

  function addCompany(company: Company) {
    setIncluded((current) => new Set([...current, company.id]))
    setHiddenByBasis((current) => {
      const next = new Set(current[basis])
      next.delete(company.id)
      return { ...current, [basis]: next }
    })
    setPickerMessage(`${company.name} added.`)
    clearPoint()
    onCompanySelect(company.id)
  }

  return (
    <div className="capex-chart" role="group" aria-label="Quarterly capital expenditure chart">
      <div className="capex-chart__header">
        {series.length > 0 && (
          <div className="segmented" role="group" aria-label="Spending measure">
            <button type="button" aria-pressed={!cashShare} onClick={() => { setMeasure('amount'); clearPoint() }}>Quarterly amount</button>
            <button type="button" aria-pressed={cashShare} disabled={!supportsCashShare}
              onClick={() => { setMeasure('cash-share'); clearPoint() }}>Capex / cash flow</button>
          </div>
        )}
        {bases.length > 0 && (
          <label className="compact-select">
            <span className="sr-only">Accounting basis</span>
            <select value={basis} onChange={(event) => { setBasisChoice(event.target.value); clearPoint() }}>
              {bases.map((option) => <option value={option} key={option}>{labelFor(option)}</option>)}
            </select>
            <ChevronDown aria-hidden="true" size={15} />
          </label>
        )}
      </div>
      <details className="capex-picker">
        <summary>Add company</summary>
        <label>
          <span className="sr-only">Search companies for capex</span>
          <input type="search" value={companyQuery} placeholder="Search name or ticker" onChange={(event) => setCompanyQuery(event.target.value)} />
        </label>
        <p className="capex-picker__count">{matches.length} {matches.length === 1 ? 'company' : 'companies'}{matches.length > 8 ? ' · showing first 8, search to narrow' : ''}</p>
        <div className="capex-picker__results" aria-label="Company search results">
          {matches.slice(0, 8).map((company) => (
            <button type="button" key={company.id} onClick={() => addCompany(company)}>
              <span>{company.name}{company.ticker ? ` · ${company.ticker}` : ''}</span>
              <span>{included.has(company.id) && !hidden.has(company.id) ? 'Show' : 'Add'}</span>
            </button>
          ))}
          {!matches.length && <p>No companies match this search and accounting basis.</p>}
        </div>
        <p className="capex-picker__status" role="status">{pickerMessage}</p>
      </details>
      {all.length > 0 ? <>
        <p className="capex-chart__basis-note">
          {cashShare ? 'Trailing four quarters. Values above 100% exceed operating cash flow.' : definitions[basis]?.description ?? 'Grouped by accounting basis.'}
        </p>
        <div className="capex-chart__legend" role="group" aria-label="Company visibility">
          {plotted.map(({ id }) => (
            <div className={`capex-chart__legend-item${id === selectedCompanyId ? ' is-selected' : ''}`} key={id}
              onMouseEnter={() => setHoveredCompany(id)} onMouseLeave={() => setHoveredCompany(null)}>
              <button type="button" className="capex-chart__toggle" aria-pressed={!hidden.has(id)}
                onFocus={() => setHoveredCompany(id)} onBlur={() => setHoveredCompany(null)}
                onClick={() => setHiddenByBasis((previous) => {
                  const next = new Set(previous[basis])
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return { ...previous, [basis]: next }
                })}>
                <span aria-hidden="true" className="capex-chart__swatch" style={{ backgroundColor: colors.get(id) }} />
                {companyNames.get(id) ?? id}
              </button>
              {plotted.length > 1 && <button type="button" className="capex-chart__isolate"
                aria-label={`Show only ${companyNames.get(id) ?? id}`}
                onClick={() => {
                  setHiddenByBasis((previous) => ({ ...previous, [basis]: new Set(plotted.map((item) => item.id).filter((item) => item !== id)) }))
                  onCompanySelect(id)
                }}>Only</button>}
            </div>
          ))}
          {hidden.size > 0 && <button type="button" className="capex-chart__show-all"
            onClick={() => setHiddenByBasis((previous) => ({ ...previous, [basis]: noHiddenCompanies }))}>Show all</button>}
        </div>
        <div className="capex-chart__plot" ref={ref}>
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="group"
            aria-label={`Quarterly capex chart, ${amountLabel}. Focus a company's last point and use arrow keys to inspect its series.`}
            onPointerMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect()
              const position = (event.clientX - box.left) * chartWidth / box.width
              if (position >= margin.left && position <= chartWidth - margin.right) {
                setHoverQuarter(Math.min(maximum, Math.max(minimum, Math.round(x.invert(position)))))
              }
            }}
            onPointerLeave={() => setHoverQuarter(null)}>
            <text className="capex-chart__units" x={margin.left} y={17}>{amountLabel}</text>
            {y.ticks(5).map((tick) => (
              <g key={tick}>
                <line className="capex-chart__grid" x1={margin.left} x2={chartWidth - margin.right} y1={y(tick)} y2={y(tick)} />
                <text className="capex-chart__axis-label" x={margin.left - 9} y={y(tick)} textAnchor="end" dominantBaseline="middle">{tick}</text>
              </g>
            ))}
            {cashShare && y.domain()[1] >= 100 && (
              <line className="capex-chart__threshold" x1={margin.left} x2={chartWidth - margin.right} y1={y(100)} y2={y(100)} />
            )}
            <line className="capex-chart__crosshair" x1={x(previewQuarter)} x2={x(previewQuarter)}
              y1={margin.top} y2={chartHeight - margin.bottom} />
            {ticks.map((index) => <text key={index} className="capex-chart__axis-label" x={x(index)} y={chartHeight - 12}
              textAnchor={index === minimum ? 'start' : index === maximum ? 'end' : 'middle'}>{quarterLabel(index, compact)}</text>)}
            {visible.map(({ id, points }) => (
              <g key={id} className="capex-chart__series" data-company={id} opacity={highlight && highlight !== id ? .25 : 1}>
                {breakAtGaps(points).filter((run) => run.length > 1).map((run) =>
                  <path key={run[0].record.id} d={path(run) ?? undefined} fill="none" stroke={colors.get(id)}
                    strokeWidth={highlight === id ? 3.2 : 2.2} strokeLinecap="round" strokeLinejoin="round" />)}
                {points.map((point, index) => {
                  const pointId = `${controlId}-${point.record.id}`
                  return <g key={point.record.id} id={pointId} className="capex-chart__point" role="button"
                    tabIndex={index === points.length - 1 ? 0 : -1}
                    aria-label={`${companyNames.get(id) ?? id}, ${point.record.quarter}, ${display(point)}. View source details`}
                    transform={`translate(${x(point.record.index)},${y(point.value)})`}
                    onPointerEnter={() => { setHoverId(point.record.id); setHoveredCompany(id) }}
                    onPointerLeave={() => { setHoverId(null); setHoveredCompany(null) }}
                    onFocus={() => { setHoverId(point.record.id); setHoveredCompany(id); setHoverQuarter(point.record.index) }}
                    onBlur={() => { setHoverId(null); setHoveredCompany(null); setHoverQuarter(null) }}
                    onClick={() => activate(point)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(point) }
                      if (event.key === 'Escape') clearPoint()
                      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                      const target = points[index + (event.key === 'ArrowLeft' ? -1 : 1)]
                      if (target) {
                        event.preventDefault()
                        document.getElementById(`${controlId}-${target.record.id}`)?.focus()
                      }
                    }}>
                    <circle r="9" fill="transparent" />
                    <circle className="capex-chart__mark" r={active?.record.id === point.record.id ? 5 : 3.2}
                      fill={colors.get(id)} stroke="white" strokeWidth="1.2" />
                  </g>
                })}
              </g>
            ))}
          </svg>
          {visible.length === 0 && <p className="capex-chart__empty">All company series are hidden.</p>}
        </div>
        <div className="capex-chart__preview">
          <div className="capex-chart__preview-heading">
            <strong>{quarterLabel(previewQuarter, false)}</strong>
            <span>Select a point for its source</span>
          </div>
          {preview.length ? <div className="capex-chart__preview-values">
            {preview.map((point, index) =>
              <button key={point.record.id} type="button"
                className={point.record.companyId === selectedCompanyId ? 'is-selected' : undefined}
                onClick={() => activate(point)}>
                <span className="capex-chart__rank">{index + 1}</span>
                <span className="capex-chart__swatch" style={{ backgroundColor: colors.get(point.record.companyId) }} />
                <span>{companyNames.get(point.record.companyId) ?? point.record.companyId}</span>
                <b className="mono">{display(point)}</b>
              </button>)}
          </div> : <span className="capex-chart__no-values">No visible observations for this quarter</span>}
        </div>
        {active && <CapexDetail point={active} company={companyNames.get(active.record.companyId) ?? active.record.companyId}
          basisLabel={labelFor(basis)} display={display(active)} onClear={pinnedId ? clearPoint : undefined} />}
      </> : <p className="empty-state">No capital expenditure observations are available.</p>}
    </div>
  )
}

function CapexDetail({ point, company, basisLabel, display, onClear }: {
  point: Point; company: string; basisLabel: string; display: string; onClear?: () => void
}) {
  const { record, window } = point
  const quarters = window ?? [record]
  const sourceDocs = quarters.flatMap((item) => [...(item.sourceDocuments ?? []), ...(window ? item.cashFlowSources ?? [] : [])])
  const uniqueSources = [...new Map(sourceDocs.map((source) => [source.url, source])).values()]
  const capex = quarters.reduce((sum, item) => sum + item.valueUsd, 0)
  const cash = quarters.reduce((sum, item) => sum + (item.operatingCashFlowUsd ?? 0), 0)
  const fiscal = typeof record.period === 'object' ? record.period.fiscal : record.period

  return (
    <div className="capex-chart__detail" aria-live="polite">
      <div className="capex-detail-title"><strong>{company} · {record.quarter}</strong><strong className="mono">{display}</strong></div>
      <p>
        {window ? `${formatUsd(capex)} capex / ${formatUsd(cash)} operating cash flow · Four quarters ended ${formatDate(record.date)}` :
          `${formatUsd(capex)} · ${fiscal ? `${fiscal} · ` : ''}Ended ${formatDate(record.date)}`}
      </p>
      <p>{basisLabel}{record.method === 'difference_of_fiscal_ytd' && !window ? ' · Difference between consecutive fiscal YTD filings' : ''}</p>
      <div className="capex-detail-links">
        <a href={record.sourceUrl} target="_blank" rel="noreferrer">{record.sourceType === 'filing' ? 'SEC filing' : record.sourceName} <ArrowUpRight size={12} aria-hidden="true" /></a>
        {uniqueSources.filter((source) => source.url !== record.sourceUrl).map((source) => (
          <a href={source.url} key={source.url} target="_blank" rel="noreferrer">{source.type === 'primary' ? 'Source filing' : 'Source report'}{source.date ? ` · ${formatDate(source.date)}` : ''} <ArrowUpRight size={12} aria-hidden="true" /></a>
        ))}
        {onClear && <button type="button" className="text-button" onClick={onClear}>Clear details</button>}
      </div>
    </div>
  )
}
