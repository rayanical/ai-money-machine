import { readdir, readFile, writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = async (file) => JSON.parse(await readFile(new URL(file, root), 'utf8'))
const archive = 'data/raw/sec-capex/'
const [census, identities, tracker, manifest, archiveFiles] = await Promise.all([
  read('data/raw/data-center-census-capex.json'),
  read('data/raw/state-of-ai-entities.json'),
  read('data/raw/rpo-tracker.json'),
  read('data/raw/sec-capex-manifest.json'),
  readdir(new URL(archive, root)),
])
const companies = new Map(identities.entities.filter(({ ticker }) => ticker).map(({ ticker, id }) => [ticker, id]))
const trackerCompanies = new Map(tracker.entities.map(({ id, ticker }) => [id, companies.get(ticker)]))
const leases = census.companies.flatMap((company) => company.leases_not_yet_commenced.map((row) => ({
  id: `${company.id}-unstarted-leases-${row.asOf}`, companyId: company.id,
  category: 'unstarted-leases', date: row.asOf, basis: 'Future lease payments on leases not yet commenced',
  valueUsd: row.usd, sourceUrl: row.source, sourceName: 'Company filing via Data Center Census',
  notes: row.text, status: 'Reported',
})))
const metricLabels = {
  rpo: 'Remaining performance obligations',
  revenue_backlog: 'Revenue backlog',
  contracted_lease_backlog: 'Contracted lease backlog',
}
const scopeLabels = { total_company: 'Company-wide', commercial: 'Commercial business', segment: 'Reported segment' }
const backlog = tracker.disclosures.flatMap((row) => {
  const companyId = trackerCompanies.get(row.entity)
  const metric = metricLabels[row.metric]
  const scope = scopeLabels[row.scope]
  const source = row.sources.find((item) => /^https?:\/\//.test(item.url ?? ''))
  if (!companyId || !metric || !scope || !source || !Number.isFinite(row.amount_usd) || !row.period?.end) return []
  return [{
    id: `rpo-${row.id}`, companyId, category: 'backlog', valueUsd: row.amount_usd,
    date: row.period.end, reportDate: row.period.reported, period: row.period.label,
    basis: `${metric} · ${scope}`, sourceUrl: source.url,
    sourceName: 'Company disclosure via Regards of Wallstreet', status: 'Reported',
    notes: row.scope_note ?? '',
  }]
})
const listed = new Set(companies.values())
const borrowed = (await Promise.all(archiveFiles.filter((file) => file.endsWith('.json')).sort().map(async (file) => {
  const companyId = file === 'msft.json' ? 'microsoft' : file.slice(0, -5)
  if (!listed.has(companyId)) return []
  const company = await read(`${archive}${file}`)
  return (company.facts.LongTermDebt?.units?.USD ?? []).flatMap((row) => {
    if (row.start || !row.end || row.end < '2025-01-01' || row.filed < row.end || row.filed > manifest.asOf ||
      !row.accn || !Number.isFinite(row.val) || row.val < 0) return []
    return [{
      id: `${companyId}-long-term-debt-${row.end}-${row.accn}`, companyId, category: 'debt',
      date: row.end, reportDate: row.filed, basis: 'Long-term debt carrying amount', valueUsd: row.val,
      sourceUrl: `https://www.sec.gov/Archives/edgar/data/${Number(company.cik)}/${row.accn.replaceAll('-', '')}/`,
      sourceName: 'SEC EDGAR', status: 'Reported',
      input: { archive: `${archive}${file}`, concept: 'LongTermDebt', accession: row.accn },
    }]
  })
}))).flat()
const debtByPeriod = new Map()
for (const row of borrowed.sort((a, b) => a.reportDate.localeCompare(b.reportDate))) {
  const key = `${row.companyId}/${row.date}`
  if (!debtByPeriod.has(key)) debtByPeriod.set(key, row)
}
const observations = [...leases, ...backlog, ...debtByPeriod.values()]
if (new Set(observations.map(({id}) => id)).size !== observations.length) throw new Error('Duplicate financing observation')
await writeFile(new URL('public/data/obligations.json', root), `${JSON.stringify({ metadata: {
  sources: [tracker.url, 'https://datacentercensus.com/ai-capex', 'https://data.sec.gov/api/xbrl/companyfacts/'],
  snapshot: tracker.last_updated, license: tracker.license,
}, observations }, null, 2)}\n`)
console.log(`Wrote ${observations.length} observations: ${leases.length} lease, ${backlog.length} backlog, ${debtByPeriod.size} debt`)
