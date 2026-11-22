import { ChevronRight } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { CapexChart } from './CapexChart'
import { SpendingOutlook } from './SpendingOutlook'
import { CompanyRecords } from './CompanyRecords'
import { FinancialChart } from './FinancialChart'
import { FinancingChart } from './FinancingChart'
import { formatDate, formatUsd, loadFinancialData, privateValuationObservations, type FinancialDataset, type FinancialObservation } from './data'
import './styles.css'
import './analysis-evidence.css'

export interface FinancialAnalysisViewProps {
  dataset?: FinancialDataset
  selectedCompanyId?: string | null
  onCompanySelect?: (companyId: string) => void
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; dataset: FinancialDataset }
  | { status: 'error'; message: string }

export function FinancialAnalysisView({ dataset, selectedCompanyId, onCompanySelect }: FinancialAnalysisViewProps) {
  const headingId = useId()
  const records = useRef<HTMLDetailsElement>(null)
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [localSelection, setLocalSelection] = useState<string | null>(null)

  useEffect(() => {
    if (dataset) return
    const controller = new AbortController()
    loadFinancialData(undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setLoad({ status: 'ready', dataset: data })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoad({ status: 'error', message: error instanceof Error ? error.message : 'Unknown loading error' })
        }
      })
    return () => controller.abort()
  }, [dataset, attempt])

  const data = dataset ?? (load.status === 'ready' ? load.dataset : undefined)
  if (!data) {
    return load.status === 'error' ? (
      <div className="panel loading-panel financial-load" role="alert">
        <strong>Financial data could not load.</strong>
        <p>{load.message}</p>
        <button type="button" className="outline-button" onClick={() => {
          setLoad({ status: 'loading' })
          setAttempt((current) => current + 1)
        }}>Try again</button>
      </div>
    ) : <div className="panel loading-panel financial-load" role="status">Loading financial data…</div>
  }

  const privateCompanies = (data.privateValuations?.valuations ?? []).map(({ id, name }) => ({ id, name }))
  const companies = [...new Map([...privateCompanies, ...data.capexCompanies, ...data.financialCompanies, ...(data.issuers?.companies ?? [])]
    .map((item) => [item.id, item])).values()].sort((a, b) => a.name.localeCompare(b.name))
  const selection = selectedCompanyId === undefined ? localSelection : selectedCompanyId
  const company = companies.find((item) => item.id === selection)
  const hasCapex = Boolean(company && data.capex.some((point) => point.companyId === company.id))
  const hasOutlooks = Boolean(data.outlooks?.outlooks.length)
  const reported: FinancialObservation[] = (data.operating ?? []).map((row) => ({
    ...row, metric: 'revenue', rawValue: row.valueUsd, sourceType: 'Issuer disclosure',
    scope: row.kind === 'segment' ? row.label : 'Consolidated company',
    sourceUrls: row.sourceUrls ?? (row.annualInput ? [row.sourceUrl, row.annualInput.sourceUrl] : undefined),
    notes: [
      row.notes,
      row.priorValueUsd != null && row.priorDate ? `Prior year ${formatDate(row.priorDate)} · ${formatUsd(row.priorValueUsd)}` : null,
    ].filter(Boolean).join(' '),
  }))

  function select(id: string) {
    if (selectedCompanyId === undefined) setLocalSelection(id)
    onCompanySelect?.(id)
  }

  function inspect(id: string, { showRecords = true } = {}) {
    select(id)
    if (records.current) records.current.open = showRecords
  }

  return (
    <div className="financial-analysis">
      <div className="analysis-grid">
        <section id="comparison" className="panel chart-panel" aria-labelledby={`${headingId}-comparison`}>
          <div className="panel-heading">
            <h2 id={`${headingId}-comparison`}>Company financials</h2>
          </div>
          <FinancialChart companies={data.financialCompanies} observations={data.financial} issuers={data.issuers} operating={data.operating}
            privateValuations={data.privateValuations} selectedCompanyId={selection} onCompanySelect={inspect} />
          <div className="chart-disclosures">
            <details ref={records} className="chart-disclosure">
              <summary><ChevronRight aria-hidden="true" size={16} />
                <span>Company records</span>{company && <span className="disclosure-context">{company.name}</span>}
              </summary>
              <CompanyRecords company={company} companies={companies} observations={[...data.financial, ...(data.issuers?.financial ?? []), ...privateValuationObservations(data.privateValuations), ...reported]}
                evidence={data.companyEvidence} hasCapex={hasCapex} onCompanySelect={select} />
            </details>
          </div>
        </section>
        <section id="capex" className="panel chart-panel" aria-labelledby={`${headingId}-capex`}>
          <div className="panel-heading">
            <h2 id={`${headingId}-capex`}>Quarterly capital spending</h2>
          </div>
          <CapexChart companies={companies} observations={data.capex}
            selectedCompanyId={selection} onCompanySelect={select} />
          {company && !hasCapex && <p className="unavailable-capex" role="status">No capex observations for {company.name}.</p>}
          {(hasOutlooks || !!data.financing?.length) && <div className="chart-disclosures">
            {!!data.financing?.length && <details className="chart-disclosure">
              <summary><ChevronRight aria-hidden="true" size={16} /><span>Financing exposure</span></summary>
              <FinancingChart companies={companies} observations={data.financing}
                selectedCompanyId={selection} onCompanySelect={select} />
            </details>}
            {hasOutlooks && data.outlooks && <SpendingOutlook dataset={data.outlooks} />}
          </div>}
        </section>
      </div>
      {(data.sources?.financial || data.sources?.capex || !!data.operating?.length) && (
        <details className="data-notes" id="methodology">
          <summary>Data coverage and methodology</summary>
          {data.sources?.financial && (
            <p>For current valuations, listed labs use the same market cap as Public companies. Unlisted labs use the same sourced mark as Private valuations. The private view prefers a newer eligible Epoch AI round where one exists. Company records include older financing observations. Annualized run rates, ARR, and reported period revenue have separate comparisons. <a href={data.sources.financial.sourceUrl}>Epoch AI snapshot, {formatDate(data.sources.financial.snapshot)}</a> · {data.sources.financial.license}.</p>
          )}
          {data.sources?.capex && (
            <p>Cash series use <a href="https://www.sec.gov/search-filings/edgar-application-programming-interfaces">SEC EDGAR facts</a>. Fiscal year-to-date differences supply standalone quarters where needed. Issuer rounding can cause small differences from published quarterly figures. Other reporting bases come from the <a href={data.sources.capex.sourceUrl}>Hyperscaler Capex Tracker</a> and <a href="https://datacentercensus.com/ai-capex">Data Center Census</a> · <a href={data.sources.capex.license}>CC BY 4.0</a>.</p>
          )}
          {!!data.operating?.length && <p>Public company revenue comes from standardized, consolidated SEC disclosures in USD. Fiscal year ends vary. The trailing measure requires four consecutive quarters on the same revenue basis. <a href="https://www.sec.gov/search-filings/edgar-application-programming-interfaces">SEC Company Facts</a>.</p>}
        </details>
      )}
    </div>
  )
}
