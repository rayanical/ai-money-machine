import { readdir, readFile, writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = async (path) => JSON.parse(await readFile(new URL(path, root)))
const archivePath = 'data/raw/sec-capex/'
const [manifest, identities, files] = await Promise.all([
  read('data/raw/sec-capex-manifest.json'),
  read('data/raw/state-of-ai-entities.json'),
  readdir(new URL(archivePath, root)),
])
const listed = new Set(identities.entities.filter((item) => item.kind === 'company' && item.valuation_live).map(({ id }) => id))
const tags = ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet']
const annual = []
const observations = []
const day = 86400000
const days = (from, to) => (Date.parse(to) - Date.parse(from)) / day
const nextDay = (date) => new Date(Date.parse(date) + day).toISOString().slice(0, 10)
const latestFirst = (a, b) => b.end.localeCompare(a.end)

for (const file of files.filter((name) => name.endsWith('.json')).sort()) {
  const companyId = file === 'msft.json' ? 'microsoft' : file.slice(0, -5)
  if (!listed.has(companyId)) continue
  const archive = archivePath + file
  const { cik, facts } = await read(archive)
  const candidates = tags.flatMap((tag) => (facts[tag]?.units?.USD ?? []).flatMap((fact) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fact.start ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(fact.end ?? '') ||
      !/^\d{4}-\d{2}-\d{2}$/.test(fact.filed ?? '') || !/^\d{10}-\d{2}-\d{6}$/.test(fact.accn ?? '') ||
      !Number.isInteger(fact.fy) || !Number.isFinite(fact.val) || fact.val < 0 ||
      fact.filed > manifest.asOf || !['10-K', '10-K/A', '10-Q', '10-Q/A', '20-F', '20-F/A', '40-F', '40-F/A'].includes(fact.form)) return []
    const lag = days(fact.end, fact.filed)
    if (lag < 0 || lag > 150) return []
    return [{ ...fact, tag, archive, sourceUrl: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${fact.accn.replaceAll('-', '')}/` }]
  })).sort((a, b) => a.filed.localeCompare(b.filed) || tags.indexOf(a.tag) - tags.indexOf(b.tag) || a.accn.localeCompare(b.accn))

  const firstPerEnd = (test) => {
    const chosen = new Map()
    for (const row of candidates) {
      if (test(row, days(row.start, row.end) + 1) && !chosen.has(row.end)) chosen.set(row.end, row)
    }
    return [...chosen.values()].sort(latestFirst)
  }
  const years = firstPerEnd((row, duration) => row.fp === 'FY' && duration >= 350 && duration <= 380)
  for (const row of years) {
    annual.push({
      id: `${companyId}-sec-revenue-${row.end}`, companyId, metric: 'revenue',
      valueUsd: row.val, rawValue: row.val, basis: 'Year revenue', period: `FY${row.fy}`,
      date: row.end, dateBasis: 'Fiscal year end', reportDate: row.filed,
      sourceUrl: row.sourceUrl, sourceName: 'SEC Company Facts', sourceType: 'Company filing',
      confidence: 'Reported', comparisonEligible: true, scope: 'Consolidated company',
      notes: `Fiscal year ${row.start} through ${row.end}. Company-wide revenue includes non-AI business.`,
      input: row,
    })
  }

  const quarters = firstPerEnd((row, duration) => /^Q[1-3]$/.test(row.fp) && duration >= 75 && duration <= 105)
    .map((row) => ({ start: row.start, end: row.end, period: `FY${row.fy} ${row.fp}`, valueUsd: row.val, inputs: [row] }))
  for (const row of years) {
    const ytd = candidates.find((candidate) => candidate.tag === row.tag && candidate.start === row.start &&
      candidate.fp === 'Q3' && candidate.end < row.end && days(candidate.end, row.end) >= 75 && days(candidate.end, row.end) <= 105)
    if (ytd && ytd.val <= row.val) {
      quarters.push({ start: nextDay(ytd.end), end: row.end, period: `FY${row.fy} Q4`, valueUsd: row.val - ytd.val, inputs: [row, ytd] })
    }
  }
  quarters.sort(latestFirst)
  const latest = quarters[0]
  if (!latest) continue

  const record = ({ kind, basis, label, period, end, valueUsd, inputs, notes }) => {
    const newestInput = [...inputs].sort((a, b) => b.filed.localeCompare(a.filed))[0]
    return {
      id: `${companyId}-sec-${kind}-${end}`, companyId, kind, basis, label, period, date: end,
      valueUsd, reportDate: newestInput.filed, sourceUrl: newestInput.sourceUrl, sourceName: 'SEC Company Facts',
      sourceUrls: [...new Set([newestInput.sourceUrl, ...inputs.map(({ sourceUrl }) => sourceUrl)])], notes, inputs,
    }
  }
  observations.push(record({
    ...latest, kind: 'consolidated', basis: 'Reported quarterly revenue', label: 'Consolidated revenue',
    notes: latest.inputs.length === 2 ? 'Fiscal Q4 equals fiscal-year revenue minus the first nine months of the same fiscal year.' : undefined,
  }))

  const window = quarters.slice(0, 4)
  const inputTags = new Set(window.flatMap((quarter) => quarter.inputs.map(({ tag }) => tag)))
  if (window.length === 4 && inputTags.size === 1 &&
      window.slice(1).every((quarter, index) => nextDay(quarter.end) === window[index].start) &&
      days(window[3].start, latest.end) >= 350 && days(window[3].start, latest.end) <= 380) {
    observations.push({
      ...record({ kind: 'trailing', basis: 'Trailing twelve months revenue', label: 'Consolidated revenue',
        end: latest.end, period: `Four quarters through ${latest.period}`,
        valueUsd: window.reduce((sum, quarter) => sum + quarter.valueUsd, 0), inputs: window.flatMap((quarter) => quarter.inputs),
        notes: 'Sum of four consecutive fiscal quarters from the same revenue tag.' }),
      quarters: window,
    })
  }
}
await writeFile(new URL('public/data/operating-revenue.json', root), `${JSON.stringify({
  metadata: { asOf: manifest.asOf, source: 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces', currency: 'USD' },
  annual, observations,
}, null, 2)}\n`)
console.log(`Wrote ${annual.length} annual and ${observations.length} quarterly or trailing SEC revenue records`)
