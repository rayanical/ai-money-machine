import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { csvParse } from 'd3'

async function read(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url)))
}

const [filings, issuers, market, identities] = await Promise.all([
  read('public/data/capex-filings.json'),
  read('public/data/ecosystem-financials.json'),
  read('data/raw/state-of-ai-history.json'),
  read('data/raw/state-of-ai-entities.json'),
])
const [operating, financing, ledger, sourceLedger, outlooks, labs] = await Promise.all([
  read('public/data/operating-revenue.json'),
  read('public/data/obligations.json'),
  read('public/data/deal-ledger.json'),
  read('data/raw/deal-ledger-regards.json'),
  read('public/data/capex-outlooks.json'),
  read('public/data/financial.json'),
])
const [census, capex, rpo, trackerInput, evidence] = await Promise.all([
  read('data/raw/data-center-census-capex.json'),
  read('public/data/capex.json'),
  read('data/raw/rpo-tracker.json'),
  read('data/raw/capex-tracker.json'),
  read('public/data/company-evidence.json'),
])
const canonicalIds = new Set(identities.entities.map(({ id }) => id))
const key = ({ companyId, quarter, basisDetail }) => `${companyId}/${quarter}/${basisDetail}`
assert.equal(new Set(filings.capex.map(key)).size, filings.capex.length)
const archivedFilings = new Map(await Promise.all(filings.companies.map(async ({ id }) => [
  id, await read(`data/raw/sec-capex/${id === 'microsoft' ? 'msft' : id}.json`),
])))

for (const point of filings.capex) {
  assert.ok(canonicalIds.has(point.companyId), point.id)
  assert.ok(point.valueUsd >= 0 && (point.operatingCashFlowUsd == null || Number.isFinite(point.operatingCashFlowUsd)), point.id)
  assert.equal(point.date, point.period.end, point.id)
  assert.ok(point.period.start < point.period.end, point.id)
  assert.equal(point.sourceType, 'filing', point.id)
  const derivations = [[point.sourceDocuments, point.valueUsd]]
  if (point.operatingCashFlowUsd != null) derivations.push([point.cashFlowSources, point.operatingCashFlowUsd])
  for (const [documents, amount] of derivations) {
    const [current, previous] = documents
    for (const doc of documents) {
      const concept = doc.concept.replace('us-gaap:', '')
      const facts = archivedFilings.get(point.companyId).facts[concept].units.USD
      assert.ok(facts.some((fact) => fact.accn === doc.accession && fact.start === doc.start &&
        fact.end === doc.end && fact.filed === doc.date && fact.val === doc.valueUsd), `${point.id} ${doc.concept} ${doc.end}`)
    }
    assert.equal(current.end, point.period.end, point.id)
    assert.equal(amount, current.valueUsd - (previous?.valueUsd ?? 0), point.id)
    if (previous) {
      assert.equal(previous.start, current.start, point.id)
      const nextDay = new Date(Date.parse(previous.end) + 86400000).toISOString().slice(0, 10)
      assert.equal(nextDay, point.period.start, point.id)
    }
  }
}

const q3CashPurchases = filings.capex.filter((point) =>
  point.quarter === '2026-Q3' && ['alphabet', 'meta', 'microsoft'].includes(point.companyId))
assert.deepEqual(q3CashPurchases.map(({ companyId, basisDetail, valueUsd }) => [companyId, basisDetail, valueUsd]), [
  ['alphabet', 'cash-property-equipment', 51355000000],
  ['meta', 'cash-property-equipment', 33942000000],
  ['microsoft', 'cash-property-equipment', 39367000000],
])

const broadcom = filings.capex.find((point) => point.companyId === 'broadcom' && point.date === '2026-08-02')
assert.equal(broadcom?.period.fiscal, 'FY2026 Q3')
assert.equal(broadcom.valueUsd, 532000000)
assert.equal(broadcom.operatingCashFlowUsd, 14197000000)

const marketDate = market.dates.at(-1)
const listed = identities.entities.filter((company) => company.kind === 'company' && company.ticker && company.valuation_live &&
  market.series[company.id]?.at(-1) > 0)
assert.deepEqual(issuers.financial.filter((row) => row.basis === 'Public market capitalization').map((row) => row.companyId).sort(),
  listed.map(({ id }) => id).sort())
assert.deepEqual(issuers.financial.filter((row) => row.basis === 'Year revenue'), operating.annual)
for (const company of issuers.companies) {
  assert.ok(canonicalIds.has(company.id), company.id)
  const rows = issuers.financial.filter((row) => row.companyId === company.id)
  const caps = rows.filter((row) => row.basis === 'Public market capitalization')
  if (caps.length) {
    assert.equal(caps[0].date, marketDate, company.id)
    assert.equal(caps[0].valueUsd, market.series[company.id].at(-1) * 1e6, company.id)
    assert.ok(company.ticker && company.sector, company.id)
  }
  const revenues = rows.filter((row) => row.basis === 'Year revenue')
  assert.ok(revenues.every((row) => row.date < row.reportDate), company.id)
}

const secInputs = new Map()
async function readSecInput(input, companyId) {
  const file = companyId === 'microsoft' ? 'msft' : companyId
  assert.equal(input.archive, `data/raw/sec-capex/${file}.json`, companyId)
  if (!secInputs.has(input.archive)) secInputs.set(input.archive, await read(input.archive))
  return secInputs.get(input.archive)
}
async function verifyRevenueInput(input, companyId) {
  const archive = await readSecInput(input, companyId)
  const { archive: archivePath, tag, sourceUrl, ...fact } = input
  assert.ok(archivePath && archive.facts[tag]?.units.USD.some((raw) =>
    Object.keys(raw).length === Object.keys(fact).length && Object.keys(raw).every((key) => raw[key] === fact[key])), companyId)
  assert.equal(sourceUrl, `https://www.sec.gov/Archives/edgar/data/${Number(archive.cik)}/${fact.accn.replaceAll('-', '')}/`, companyId)
}
for (const row of operating.annual) {
  await verifyRevenueInput(row.input, row.companyId)
  assert.equal(row.date, row.input.end, row.id)
  assert.equal(row.valueUsd, row.input.val, row.id)
  assert.equal(row.reportDate, row.input.filed, row.id)
}
const day = 86400000
function verifyQuarterRevenue({ start, end, valueUsd, inputs }, id) {
  const [current, nineMonths] = inputs
  assert.equal(end, current.end, id)
  assert.equal(valueUsd, current.val - (nineMonths?.val ?? 0), id)
  if (nineMonths) {
    assert.equal(current.start, nineMonths.start, id)
    assert.equal(current.tag, nineMonths.tag, id)
    if (start) assert.equal(Date.parse(start) - Date.parse(nineMonths.end), day, id)
  }
}
for (const row of operating.observations) {
  assert.ok(canonicalIds.has(row.companyId), row.id)
  assert.ok(row.reportDate >= row.date && row.sourceUrl.startsWith('https://'), row.id)
  for (const input of row.inputs) await verifyRevenueInput(input, row.companyId)
  assert.equal(row.reportDate, row.inputs.map(({ filed }) => filed).sort().at(-1), row.id)
  assert.deepEqual([...new Set(row.inputs.map(({ sourceUrl }) => sourceUrl))].sort(), [...row.sourceUrls].sort(), row.id)
  if (row.kind === 'trailing') {
    assert.equal(row.quarters.length, 4, row.id)
    assert.equal(row.date, row.quarters[0].end, row.id)
    assert.equal(new Set(row.inputs.map(({ tag }) => tag)).size, 1, row.id)
    assert.deepEqual(row.quarters.flatMap(({ inputs }) => inputs), row.inputs, row.id)
    assert.equal(row.valueUsd, row.quarters.reduce((sum, quarter) => sum + quarter.valueUsd, 0), row.id)
    row.quarters.forEach((quarter, index) => {
      verifyQuarterRevenue(quarter, row.id)
      if (index > 0) assert.equal(Date.parse(row.quarters[index - 1].start) - Date.parse(quarter.end), day, row.id)
    })
  } else {
    assert.equal(row.kind, 'consolidated', row.id)
    verifyQuarterRevenue({ ...row, end: row.date }, row.id)
  }
}

for (const row of financing.observations) {
  assert.ok(canonicalIds.has(row.companyId) && row.sourceUrl.startsWith('https://'), row.id)
  assert.ok(row.date <= (row.reportDate ?? row.date), row.id)
  if (row.category === 'unstarted-leases') {
    const source = census.companies.find(({ id }) => id === row.companyId)?.leases_not_yet_commenced
    assert.ok(source?.some((item) => item.asOf === row.date && item.usd === row.valueUsd && item.source === row.sourceUrl), row.id)
  } else if (row.category === 'backlog') {
    const disclosure = rpo.disclosures.find(({ id }) => `rpo-${id}` === row.id)
    assert.equal(row.valueUsd, disclosure?.amount_usd, row.id)
    assert.equal(row.date, disclosure.period.end, row.id)
    assert.ok(disclosure.sources.some(({ url }) => url === row.sourceUrl), row.id)
  } else {
    assert.equal(row.category, 'debt', row.id)
    const company = await readSecInput(row.input, row.companyId)
    assert.equal(row.input.concept, 'LongTermDebt', row.id)
    assert.ok(company.facts.LongTermDebt.units.USD.some((item) => item.end === row.date && item.val === row.valueUsd &&
      item.accn === row.input.accession && item.filed === row.reportDate && row.sourceUrl.endsWith(`/${item.accn.replaceAll('-', '')}/`)), row.id)
  }
}
assert.deepEqual([...new Set(financing.observations.map(({ category }) => category))].sort(), ['backlog', 'debt', 'unstarted-leases'])
const metaLeaseQuarters = census.companies.find(({ id }) => id === 'meta').quarters
  .filter((row) => row.usd_including_finance_lease_principal != null)
assert.deepEqual(capex.capex.filter((row) => row.basisDetail === 'meta-including-finance-lease-principal-payments')
  .map((row) => [row.quarter, row.valueUsd, row.sourceDocuments[0]?.url]),
metaLeaseQuarters.map((row) => [row.calendar_quarter, row.usd_including_finance_lease_principal, row.filing_url]))
for (const row of capex.capex.filter(({ valueField }) => valueField !== 'usd_including_finance_lease_principal')) {
  const quarter = trackerInput.series.find(({ company }) => company === row.companyId)?.quarters.find(({ period }) => period === row.quarter)
  assert.equal(row.valueUsd, quarter?.[row.valueField], row.id)
  assert.deepEqual(row.sourceDocuments, quarter.sources, row.id)
}
const openAiAnnualized = labs.financial.find(({ sourceRecordId }) => sourceRecordId === 'OpenAI September 50B')
assert.equal(openAiAnnualized?.date, '2026-09-30')
assert.equal(openAiAnnualized.reportDate, null)
assert.equal(openAiAnnualized.approximate, true)
assert.ok(labs.financial.filter(({ metric }) => metric === 'revenue').every(({ date, reportDate }) => !date || !reportDate || reportDate >= date))
const snapshotIndexes = new Map(market.dates.map((date, index) => [date, index]))
for (const { companyId, points } of evidence.history) {
  assert.ok(canonicalIds.has(companyId), companyId)
  for (const point of points) assert.equal(point.valueUsd, market.series[companyId][snapshotIndexes.get(point.date)] * 1e6, companyId)
}
const epochCompute = csvParse(await readFile(new URL('../data/raw/epoch-compute-spend.csv', import.meta.url), 'utf8'))
assert.equal(evidence.compute.length, epochCompute.length)
for (const row of evidence.compute) {
  assert.ok(canonicalIds.has(row.companyId), row.id)
  const source = epochCompute.find((entry) => `${entry.Id}-${entry.Amount}` === row.id)
  assert.equal(row.valueUsd, Number(source?.Amount), row.id)
  assert.equal(row.date, source.Date, row.id)
  assert.equal(row.excludedFromGraph, source['Exclude from graph view'] === 'True', row.id)
}
const readRawCsv = async (name) => csvParse(await readFile(new URL(`../data/raw/${name}`, import.meta.url), 'utf8'))
const [epochFunding, epochRevenue] = await Promise.all([readRawCsv('epoch-funding-rounds.csv'), readRawCsv('epoch-revenue-reports.csv')])
for (const row of labs.financial) {
  const source = (row.metric === 'revenue' ? epochRevenue : epochFunding)
    .find((entry) => entry.Id === row.sourceRecordId && entry.Company === row.rawRecord?.Company)
  assert.ok(source && source[row.valueColumn] !== '', row.id)
  assert.deepEqual(row.rawRecord, { ...source }, row.id)
  assert.equal(row.valueUsd, Number(source[row.valueColumn]), row.id)
}
const amazonTotal = labs.financial.find((row) => row.sourceRecordId === 'Amazon March 2024')
assert.equal(amazonTotal.basis, 'Cumulative Amazon equity investment')
assert.equal(amazonTotal.comparisonEligible, false)
const facility = labs.financial.find((row) => row.sourceRecordId === 'Oct 2024 157B' && row.basis === 'Revolving credit facility capacity')
assert.equal(facility.valueUsd, 4000000000)
assert.equal(facility.comparisonEligible, false)
const secondary = labs.financial.filter((row) => row.metric === 'valuation' && row.rawRecord?.Type === 'Secondary')
assert.ok(secondary.length > 0 && secondary.every((row) => row.basis === 'Secondary sale implied valuation' && !row.comparisonEligible))
assert.ok(labs.financial.some((row) => row.companyId === 'openai' && row.basis === 'Post-money valuation' && row.valueUsd === 852000000000))

assert.deepEqual(ledger.deals, sourceLedger.deals)
assert.equal(Object.values(ledger.summary.statusCounts).reduce((total, count) => total + count, 0), ledger.deals.length)
assert.equal(ledger.deals.length, 62)
assert.equal(ledger.summary.baseTerms.count, 40)
assert.equal(ledger.summary.baseTerms.valueUsd, 1297894000000)
assert.ok(ledger.summary.baseTerms.valueUsd < sourceLedger.aggregates.contractValueUsd)
const readCsv = async (name) => csvParse(await readFile(new URL(`../public/data/${name}`, import.meta.url), 'utf8'))
const [manifest, entityRows, relationRows, dealRows] = await Promise.all([
  read('public/data/shared-snapshot.json'),
  readCsv('entities.csv'),
  readCsv('relations.csv'),
  readCsv('ai-compute-deal-ledger.csv'),
])
assert.deepEqual(entityRows.map(({ id }) => id), [...canonicalIds])
assert.equal(entityRows.length, 232)
const { relations } = await read('public/data/relations.json')
assert.equal(relations.length, 540)
assert.deepEqual(relationRows.map((row) => [row.source, row.target, row.type, row.confidence, row.as_of, row.source_url]),
  relations.map((row) => [row.source, row.target, row.type, row.confidence, row.as_of ?? '', row.url ?? '']))
assert.deepEqual(dealRows.map((row) => [row.id, row.status, row.deal_type, row.announced, row.amount_usd, row.value_basis]),
  ledger.deals.map((row) => [row.id, row.status, row.deal_type, row.announced, String(row.value?.amount_usd ?? ''), row.value?.basis ?? '']))
assert.equal(trackerInput.series.flatMap(({ quarters }) => quarters).length, 21)
assert.equal(manifest.ledger_as_of, sourceLedger.last_updated)
for (const { file, bytes, sha256 } of manifest.sources) {
  const content = await readFile(new URL(`../public/data/${file}`, import.meta.url))
  assert.equal(content.length, bytes, file)
  assert.equal(createHash('sha256').update(content).digest('hex'), sha256, file)
}
assert.deepEqual(outlooks.outlooks.map(({ companyId, basis, lowUsd, highUsd }) => [companyId, basis, lowUsd, highUsd]), [
  ['amazon', 'cash capital expenditures', 220000000000, 220000000000],
  ['meta', 'capital expenditures, including principal payments on finance leases', 135000000000, 145000000000],
])

console.log('Verified quarterly capex, valuation and revenue dates and units, financing categories, deal contract basis, and guidance.')
