import { readFile, writeFile } from 'node:fs/promises'

const raw = JSON.parse(await readFile(new URL('../data/raw/data-center-census-capex.json', import.meta.url)))
const outlooks = raw.companies.flatMap((company) => company.outlook.map((row) => {
  const lowUsd = row.low ?? row.usd
  const highUsd = row.high ?? row.usd
  if (!(lowUsd >= 0 && highUsd >= lowUsd) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
    throw new Error(`Invalid capex outlook: ${company.id}`)
  }
  return {
    companyId: company.id,
    name: company.name,
    year: row.year,
    date: row.date,
    lowUsd,
    highUsd,
    approximate: row.approx === true,
    basis: row.wording,
    sourceUrl: row.source,
  }
}))
const currentOutlooks = new Map()
for (const row of outlooks.sort((a, b) => a.date.localeCompare(b.date))) {
  currentOutlooks.set(JSON.stringify([row.companyId, row.year, row.basis]), row)
}
await writeFile(new URL('../public/data/capex-outlooks.json', import.meta.url), JSON.stringify({
  publisher: 'Data Center Census',
  sourceUrl: 'https://datacentercensus.com/ai-capex',
  snapshot: raw.as_of,
  license: raw.license,
  outlooks: [...currentOutlooks.values()].sort((a, b) => a.name.localeCompare(b.name) || b.year - a.year || a.basis.localeCompare(b.basis)),
}, null, 2) + '\n')
console.log(`Wrote ${currentOutlooks.size} source-linked capex outlooks`)
