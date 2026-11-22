import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

// Supply an SEC-compliant contact, for example SEC_USER_AGENT='Name email@example.com'.
const agent = process.env.SEC_USER_AGENT
if (!agent || !agent.includes('@')) throw new Error('Set SEC_USER_AGENT to your name and contact email')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const asOf = process.argv[2]
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf ?? '')) throw new Error('Pass the archive cutoff date as YYYY-MM-DD')
const get = async (url) => {
  const response = await fetch(url, { headers: { 'User-Agent': agent, Accept: 'application/json' } })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  return { data: JSON.parse(bytes), sha256: createHash('sha256').update(bytes).digest('hex') }
}
const tickerSource = 'https://www.sec.gov/files/company_tickers.json'
const tickerIndex = Object.values((await get(tickerSource)).data)
const byTicker = new Map(tickerIndex.map((item) => [item.ticker, item]))
const universe = JSON.parse(await readFile(resolve(root, 'data/raw/state-of-ai-entities.json'), 'utf8'))
const baseFiles = new Map([['microsoft','msft'], ...['alphabet','amazon','meta','oracle','coreweave','nvidia','amd','broadcom'].map(id => [id, id])])
const matches = universe.entities.filter((company) => company.kind === 'company' && company.valuation_live &&
  company.ticker && byTicker.has(company.ticker))
const manifest = []
const skipped = []
const revenueCompanies = []
const archives = []
const revenueTags = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet']
const capexTags = ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets']
const tags = [...capexTags, 'NetCashProvidedByUsedInOperatingActivities', ...revenueTags, 'LongTermDebt']
for (const company of matches) {
  const match = byTicker.get(company.ticker)
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(match.cik_str).padStart(10, '0')}.json`
  try {
    const { data, sha256 } = await get(url)
    if (Number(data.cik) !== Number(match.cik_str)) throw new Error(`Unexpected SEC company CIK at ${url}`)
    const facts = data.facts?.['us-gaap'] ?? {}
    const selected = Object.fromEntries(tags.filter((name) => facts[name]?.units?.USD).map((name) => {
      const { label, description, units } = facts[name]
      const USD = units.USD.filter((row) => row.end >= '2022-01-01' && row.filed <= asOf &&
        ['10-Q', '10-K', '10-Q/A', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A'].includes(row.form))
      return [name, { label, description, units: { USD } }]
    }))
    const concept = capexTags.find(name => selected[name]?.units.USD.length)
    const file = baseFiles.get(company.id) ?? company.id
    archives.push({ file, cik: data.cik, entityName: data.entityName, sourceUrl: url, exportSha256: sha256, facts: selected })
    if (revenueTags.some((name) => selected[name]?.units.USD.length)) revenueCompanies.push({ id: company.id, cik: data.cik, file })
    if (concept && !baseFiles.has(company.id)) manifest.push({id:company.id,name:company.name,ticker:company.ticker,cik:data.cik,concept})
    if (!concept) skipped.push({id:company.id,ticker:company.ticker,reason:'No USD quarterly cash capex facts'})
    console.log(`${company.id} archived${concept ? `; ${concept} ${selected[concept].units.USD.length} facts` : ''}`)
  } catch (error) {
    // A missing SEC company-facts file is a coverage gap; transient failures must not silently truncate the archive.
    if (!String(error.message ?? error).startsWith('404 ')) throw error
    skipped.push({id:company.id,ticker:company.ticker,reason:'SEC company facts unavailable'})
    console.error(`Skipped ${company.id}: ${error.message}`)
  }
  await new Promise(resolve => setTimeout(resolve, 300))
}
await mkdir(resolve(root, 'data/raw/sec-capex'), { recursive: true })
for (const { file, ...archive } of archives) {
  await writeFile(resolve(root, `data/raw/sec-capex/${file}.json`), `${JSON.stringify(archive, null, 2)}\n`)
}
await writeFile(resolve(root, 'data/raw/sec-capex-manifest.json'), `${JSON.stringify({ asOf, tickerSource, companies: manifest, revenueCompanies, skipped }, null, 2)}\n`)
console.log(`Archived ${archives.length} SEC matches; ${revenueCompanies.length} have USD revenue facts; ${skipped.length} capex or source gaps`)
