import { AnalysisRanking, type AnalysisRow } from './AnalysisRanking'
import {
  compactUsd, formatDate, formatUsd, marketCapBasis,
  type Company, type FinancialObservation, type OperatingObservation,
} from './data'

export type OperatingMode = OperatingObservation['kind'] | 'sales-multiple'

interface OperatingRankingProps {
  companies: readonly Company[]
  observations: readonly OperatingObservation[]
  issuerFinancial: readonly FinancialObservation[]
  measure: OperatingMode
  selectedCompanyId: string | null
  onCompanySelect: (companyId: string) => void
}

const multipleFormat = (amount: number) => `${amount.toFixed(1)}×`
const measureLabels: Record<OperatingMode, string> = {
  consolidated: 'Latest quarterly revenue',
  segment: 'Selected chip and cloud revenue',
  trailing: 'Trailing twelve months revenue',
  'sales-multiple': 'Public market cap divided by trailing sales',
}

export function OperatingRanking({ companies, observations, issuerFinancial, measure, selectedCompanyId, onCompanySelect }: OperatingRankingProps) {
  const isMultiple = measure === 'sales-multiple'
  const kind = isMultiple ? 'trailing' : measure
  const marketDates = [...new Set(issuerFinancial.filter((row) => row.basis === marketCapBasis && row.date).map((row) => row.date))]
    .sort((a, b) => String(b).localeCompare(String(a)))
  const snapshot = marketDates[0]
  const rows = observations.filter((item) => item.kind === kind).flatMap((item): AnalysisRow[] => {
    const company = companies.find((entry) => entry.id === item.companyId)
    if (!company) return []
    const market = isMultiple ? issuerFinancial.find((row) => row.companyId === company.id && row.basis === marketCapBasis &&
      row.date === snapshot && item.reportDate && snapshot && item.reportDate <= snapshot &&
      item.date <= snapshot && (Date.parse(snapshot) - Date.parse(item.date)) / 86400000 <= 120) : undefined
    if (isMultiple && (!market || item.valueUsd <= 0)) return []
    const value = market ? market.valueUsd / item.valueUsd : item.valueUsd
    const growth = !isMultiple && item.priorValueUsd && item.priorDate ?
      (item.valueUsd / item.priorValueUsd - 1) * 100 : null
    return [{
      id: item.id,
      companyId: company.id,
      name: company.name,
      caption: kind === 'segment' ? item.label : formatDate(item.date),
      value,
      valueCaption: growth !== null ? `${growth > 0 ? '+' : ''}${growth.toFixed(1)}% YoY` :
        kind === 'segment' ? formatDate(item.date) : undefined,
      exact: market ? multipleFormat(value) : formatUsd(item.valueUsd),
      detail: <>
        <div>{item.label} · {item.period} · Ended {formatDate(item.date)}</div>
        {market ? <div>{formatUsd(market.valueUsd)} market cap ÷ {formatUsd(item.valueUsd)} trailing sales</div> : <div>{item.basis}</div>}
        {item.notes && <div>{item.notes}</div>}
        {growth !== null && item.priorDate && item.priorValueUsd != null &&
          <div>Prior year · {formatDate(item.priorDate)} · {formatUsd(item.priorValueUsd)}</div>}
        <div><a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceName}</a>
          {item.reportDate && ` · Reported ${formatDate(item.reportDate)}`}
          {item.annualInput && item.annualInput.sourceUrl !== item.sourceUrl && <> · <a href={item.annualInput.sourceUrl} target="_blank" rel="noreferrer">Annual input</a></>}
          {item.sourceUrls?.filter((url) => url !== item.sourceUrl).map((url, index) =>
            <span key={url}> · <a href={url} target="_blank" rel="noreferrer">Input filing {index + 2}</a></span>)}
          {market && <> · <a href={market.sourceUrl} target="_blank" rel="noreferrer">Market-cap source</a></>}
        </div>
      </>,
    }]
  })
  const subtitle = isMultiple && snapshot ? `Market caps on ${formatDate(snapshot)}. Trailing revenue ends on each date shown.` :
    kind === 'segment' ? 'Selected issuer disclosures. Business definitions vary.' :
      kind === 'trailing' ? 'Consolidated revenue over the latest four fiscal quarters.' : 'Consolidated revenue. Fiscal quarter ends vary.'
  return (
    <>
      <p className="evidence-description">{subtitle}</p>
      <AnalysisRanking rows={rows} label={measureLabels[measure]} format={isMultiple ? multipleFormat : compactUsd}
        selectedCompanyId={selectedCompanyId} onCompanySelect={onCompanySelect} />
    </>
  )
}
