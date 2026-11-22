import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { csvParse } from 'd3'

const root = new URL('../', import.meta.url)
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'))
const [history, identities, companyText, computeText] = await Promise.all([
  readJson('data/raw/state-of-ai-history.json'),
  readJson('data/raw/state-of-ai-entities.json'),
  readFile(new URL('data/raw/epoch-companies.csv', root), 'utf8'),
  readFile(new URL('data/raw/epoch-compute-spend.csv', root), 'utf8'),
])
const names = new Map(identities.entities.map(({ id, name }) => [name, id]))
const aliases = new Map([['Google', 'deepmind'], ['Mistral AI', 'mistral'], ['Z.ai (Zhipu)', 'zhipu'], ['Moonshot AI', 'moonshot']])
const companyIds = new Map(csvParse(companyText).flatMap(({ Name }) => {
  const id = aliases.get(Name) ?? names.get(Name)
  if (!id) throw new Error(`Unknown Epoch company: ${Name}`)
  return [[Name, id]]
}))
const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date)
const validUrl = (text) => {
  try { return ['http:', 'https:'].includes(new URL(text).protocol) } catch { return false }
}

if (!history.dates.every(validDate)) throw new Error('Invalid valuation snapshot date')
const historyData = Object.entries(history.series).flatMap(([id, values]) => {
  if (!identities.entities.some((item) => item.id === id)) return []
  if (!Array.isArray(values) || values.length !== history.dates.length) throw new Error(`Invalid history series: ${id}`)
  let previous = null
  const points = []
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) { previous = null; continue }
    if (value !== previous) points.push({ date: history.dates[i], valueUsd: value * 1_000_000 })
    previous = value
  }
  return points.length ? [{ companyId: id, points }] : []
})
const compute = csvParse(computeText).flatMap((row) => {
  const companyId = companyIds.get(row.Company)
  const amount = Number(row.Amount)
  const sources = [row['Source 1'], row['Source 2'], row['Source 3']].map((url) => url.trim()).filter(validUrl)
  if (!companyId || !row.Amount || !Number.isFinite(amount) || amount < 0 || !validDate(row.Date) || !sources.length) return []
  return [{
    id: `${row.Id}-${row.Amount}`,
    companyId,
    valueUsd: amount,
    rawValue: row.Amount,
    date: row.Date,
    period: row['Period type'],
    category: row.Category,
    reportDate: validDate(row['Report date']) ? row['Report date'] : null,
    confidence: row.Confidence,
    sourceType: row['Source Type'],
    sources,
    notes: row.Notes,
    excludedFromGraph: row['Exclude from graph view'] === 'True',
  }]
})
const output = { snapshot: history.generated, history: historyData, compute }
await mkdir(new URL('public/data/', root), { recursive: true })
await writeFile(new URL('public/data/company-evidence.json', root), JSON.stringify(output) + '\n')
console.log(`Wrote ${historyData.length} valuation histories and ${compute.length} Epoch compute estimates`)
