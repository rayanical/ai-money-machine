import { scaleLinear } from 'd3'
import type { ReactNode } from 'react'
import { useState } from 'react'

export interface AnalysisRow {
  id: string
  companyId: string
  name: string
  caption: string
  value: number
  valueCaption?: string
  previous?: number
  exact: string
  detail: ReactNode
}

interface AnalysisRankingProps {
  rows: readonly AnalysisRow[]
  label: string
  format: (value: number) => string
  preview?: boolean
  selectedCompanyId: string | null
  onCompanySelect: (companyId: string) => void
}

export function AnalysisRanking({ rows, label, format, preview = false, selectedCompanyId, onCompanySelect }: AnalysisRankingProps) {
  const [inspectedId, setInspectedId] = useState<string>()
  const ordered = [...rows].sort((a, b) => b.value - a.value)
  const maximum = Math.max(1, ...rows.map((row) => Math.max(row.value, row.previous ?? 0)))
  const scale = scaleLinear().domain([0, maximum]).nice(3).range([0, 100])
  const ticks = scale.ticks(3)
  const active = rows.find(({ id }) => id === inspectedId) ?? rows.find(({ companyId }) => companyId === selectedCompanyId) ??
    (preview ? ordered[0] : undefined)

  if (!rows.length) return <p className="empty-state">No comparable observations on this basis.</p>
  return (
    <>
      <div className="ranking" role="group" aria-label={label}>
        <div className="ranking-head" aria-hidden="true">
          <span>Company</span>
          <div className="ranking-axis">{ticks.filter((value) => scale(value) < 98).map((value) =>
            <span key={value} style={{ left: `${scale(value)}%` }}>{format(value)}</span>)}</div>
          <span className="ranking-sort">Value</span>
        </div>
        {ordered.map((row) => (
          <button key={row.id} type="button" className="ranking-row evidence-row"
            aria-pressed={row.companyId === selectedCompanyId}
            aria-label={`${row.name}, ${row.caption}, ${row.exact}. Inspect source`}
            onMouseEnter={() => setInspectedId(row.id)} onMouseLeave={() => setInspectedId(undefined)}
            onFocus={() => setInspectedId(row.id)} onBlur={() => setInspectedId(undefined)}
            onClick={() => onCompanySelect(row.companyId)}>
            <span className="ranking-name">{row.name}<span className="rank-subtitle">{row.caption}</span></span>
            <svg className="ranking-track" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
              {ticks.map((tick) => <line key={tick} x1={scale(tick)} x2={scale(tick)} y1="0" y2="24" vectorEffect="non-scaling-stroke" />)}
              <rect className="ranking-bar" x="0" y="5" width={scale(row.value)} height="14" />
              {row.previous != null && <line className="prior-marker" x1={scale(row.previous)} x2={scale(row.previous)}
                y1="2" y2="22" vectorEffect="non-scaling-stroke" />}
            </svg>
            <span className="ranking-value"><strong>{format(row.value)}</strong>
              {row.valueCaption && <span className="rank-subtitle">{row.valueCaption}</span>}
            </span>
          </button>
        ))}
      </div>
      {active && <div className="ranking-inspect" aria-live="polite">
        <div className="inspect-top"><strong>{active.name}</strong><strong className="mono">{active.exact}</strong></div>
        {active.detail}
      </div>}
    </>
  )
}
