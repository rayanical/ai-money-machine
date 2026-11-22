import { ArrowUpRight, ChevronRight } from 'lucide-react'
import { compactUsd, formatDate } from './data'
import type { CompanyEvidenceData } from './companyEvidenceData'
import './company-evidence.css'

interface CompanyEvidenceProps {
  companyId: string
  data: CompanyEvidenceData
}

type ComputeRecord = CompanyEvidenceData['compute'][number]

function ComputeRows({ rows }: { rows: readonly ComputeRecord[] }) {
  return <div className="evidence-records">
    {rows.map((row) => <div className="evidence-record" key={row.id}>
      <div className="evidence-record__heading">
        <strong>{row.period} · {formatDate(row.date)}</strong>
        <strong className="mono">≈ {compactUsd(row.valueUsd)}</strong>
      </div>
      <p>{row.category} · {row.confidence || 'Confidence unavailable'}
        {row.reportDate && ` · Reported ${formatDate(row.reportDate)}`}</p>
      {row.reportDate && row.reportDate < row.date && row.period !== 'Annualized' &&
        <p>Report published before the period end.</p>}
      {row.sources.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">
        {index === 0 ? 'Source' : `Source ${index + 1}`} <ArrowUpRight size={12} aria-hidden="true" />
      </a>)}
      {row.notes && <details className="evidence-record__notes" open={row.excludedFromGraph}>
        <summary>Dataset notes</summary><p>{row.notes}</p>
      </details>}
    </div>)}
  </div>
}

export function CompanyEvidence({ companyId, data }: CompanyEvidenceProps) {
  const history = data.history.find((item) => item.companyId === companyId)
  const points = [...(history?.points ?? [])].reverse()
  const records = data.compute.filter((item) => item.companyId === companyId)
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
  const unflagged = records.filter((item) => !item.excludedFromGraph)
  const flagged = records.filter((item) => item.excludedFromGraph)
  if (!points.length && !records.length) return null
  const renderHistory = (rows: typeof points) => <table>
    <thead><tr><th scope="col">Snapshot</th><th scope="col">Value</th></tr></thead>
    <tbody>{rows.map((point) => <tr key={point.date}>
      <td><time dateTime={point.date}>{formatDate(point.date)}</time></td>
      <td className="mono">{compactUsd(point.valueUsd)}</td>
    </tr>)}</tbody>
  </table>
  return <div className="company-evidence">
    {points.length > 0 && <details className="chart-disclosure">
      <summary><ChevronRight aria-hidden="true" size={15} /><span>Valuation history</span>
        <span className="disclosure-context">{points.length} marks</span></summary>
      <p className="company-evidence__intro">Publisher snapshot marks. Dates show when a value appeared in the dataset. Marks can be carried forward, and the basis can change when a company lists.</p>
      <div className="company-evidence__history">{renderHistory(points.slice(0, 8))}</div>
      {points.length > 8 && <details className="company-evidence__earlier">
        <summary>Show {points.length - 8} earlier values</summary>
        <div className="company-evidence__history">{renderHistory(points.slice(8))}</div>
      </details>}
      <a className="company-evidence__source" href="https://stateofai.world/open-data" target="_blank" rel="noreferrer">
        State of AI World <ArrowUpRight size={12} aria-hidden="true" />
      </a>
    </details>}
    {records.length > 0 && <details className="chart-disclosure">
      <summary><ChevronRight aria-hidden="true" size={15} /><span>Compute spending estimates</span>
        <span className="disclosure-context">{records.length} records</span></summary>
      <p className="company-evidence__intro">Estimates and projections from Epoch AI. Definitions and periods vary, and figures may overlap.</p>
      <ComputeRows rows={unflagged} />
      {flagged.length > 0 && <details className="company-evidence__flagged">
        <summary>Additional estimates flagged by Epoch AI ({flagged.length})</summary>
        <ComputeRows rows={flagged} />
      </details>}
      <a className="company-evidence__source" href="https://epoch.ai/data/ai-companies" target="_blank" rel="noreferrer">
        Epoch AI dataset <ArrowUpRight size={12} aria-hidden="true" />
      </a>
    </details>}
  </div>
}
