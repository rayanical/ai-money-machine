import { ChevronRight } from 'lucide-react'
import { compactUsd, formatDate, type CapexOutlooks } from './data'

export function SpendingOutlook({ dataset }: { dataset: CapexOutlooks }) {
  if (!dataset.outlooks.length) return null
  return (
    <details className="chart-disclosure capex-guidance">
      <summary><ChevronRight aria-hidden="true" size={16} /><span>Spending outlook</span></summary>
      <p className="evidence-description">Company forecasts for the years shown.</p>
      <dl>
        {dataset.outlooks.map((row) => (
          <div key={`${row.companyId}-${row.year}-${row.basis}`}>
            <dt>{row.name} · {row.year} outlook</dt>
            <dd><strong className="mono">{row.approximate ? '≈ ' : ''}{compactUsd(row.lowUsd)}
              {row.highUsd !== row.lowUsd && `–${compactUsd(row.highUsd)}`}</strong></dd>
            <dd>{row.basis} · <a href={row.sourceUrl} target="_blank" rel="noreferrer">Issued {formatDate(row.date)}</a></dd>
          </div>
        ))}
      </dl>
      <a href={dataset.sourceUrl} className="exposure-source" target="_blank" rel="noreferrer">{dataset.publisher} outlook dataset</a>
    </details>
  )
}
