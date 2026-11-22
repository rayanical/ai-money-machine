import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { csvFormat } from 'd3'

const raw = (name) => new URL(`../data/raw/${name}`, import.meta.url)
const output = (name) => new URL(`../public/data/${name}`, import.meta.url)
const read = (name) => readFile(raw(name), 'utf8').then(JSON.parse)
const write = (name, rows) => writeFile(output(name), `${csvFormat(rows)}\n`)
const sourceUrls = (sources) => (sources ?? []).map(({ url }) => url).filter(Boolean).join(' ')

const layers = {
  app: 'Applications',
  chip: 'AI silicon',
  lab: 'Foundation model labs',
  semi: 'Semi supply chain',
  physical: 'Physical AI · robotics',
  agent: 'Agents & dev tools',
  infer: 'Inference & serving',
  cloud: 'Cloud & hyperscalers',
  neo: 'GPU neoclouds',
  data: 'Data & training',
  gateway: 'Gateways & routers',
}

const relationLabels = {
  invests_in: 'invests in',
  owns: 'owns',
  rents: 'rents from',
  commits_to: 'commits spend to',
  fabricated_by: 'fabricated by',
  equipped_by: 'equipped by',
  memory_from: 'buys memory from',
  designed_with: 'designed with',
  packaged_by: 'packaged by',
  builds_on: 'built on',
  routes: 'routes to',
  trains_on: 'trains on',
  rivals: 'competes with',
}

const [network, ties, ledger] = await Promise.all([
  read('state-of-ai-entities.json'),
  read('state-of-ai-relations.json'),
  read('deal-ledger-regards.json'),
])
const entityNames = new Map(network.entities.map(({ id, name }) => [id, name]))
const partyNames = new Map(ledger.entities.map(({ id, name }) => [id, name]))
const namesForRole = (deal, role) => deal.parties
  .filter((party) => party.role === role)
  .map(({ entity }) => partyNames.get(entity) ?? entity)
  .join('; ')

const entities = network.entities.map((entity) => {
  const source = entity.sources?.find((item) => item.backs?.includes('valuation')) ?? entity.sources?.[0]
  return {
    id: entity.id,
    name: entity.name,
    kind: entity.kind,
    parent: entity.parent,
    layer: layers[entity.sector] ?? entity.sector,
    region: entity.region,
    valuation_usd_m: entity.valuation_musd,
    confidence: entity.confidence,
    as_of: entity.as_of,
    ticker: entity.ticker,
    live_market_cap: entity.valuation_live ? 'yes' : '',
    domain: entity.domain,
    source_title: source?.title,
    source_url: source?.url,
    page: `https://stateofai.world/c/${entity.id}`,
  }
})

const relations = ties.relations.map((relation) => ({
  source: relation.source,
  source_name: entityNames.get(relation.source),
  type: relation.type,
  reads_as: relationLabels[relation.type] ?? relation.type,
  target: relation.target,
  target_name: entityNames.get(relation.target),
  confidence: relation.confidence,
  source_url: relation.url,
  as_of: relation.as_of,
  source_title: relation.title,
}))

const deals = ledger.deals.map((deal) => {
  const { value, capacity, dates, flags } = deal
  const mw = capacity?.mw_it
  const amount = value?.amount_usd
  const term = deal.term_years
  const costPerMwYear = value?.basis !== 'program_envelope' && amount && term && mw
    ? Math.round(amount / term / mw)
    : null
  return {
    id: deal.id,
    announced: deal.announced,
    status: deal.status,
    deal_type: deal.deal_type,
    providers: namesForRole(deal, 'provider'),
    buyers: namesForRole(deal, 'buyer'),
    financiers: namesForRole(deal, 'financier'),
    amount_usd: amount,
    value_kind: value?.kind,
    value_basis: value?.basis,
    value_qualifier: value?.qualifier,
    max_with_options_usd: value?.max_with_options_usd,
    value_as_of: value?.as_of,
    term_years: term,
    mw_it: mw,
    usd_per_mw_year: costPerMwYear,
    revenue_start: dates?.revenue_start,
    revenue_start_precision: dates?.revenue_start_precision,
    expansion_of: flags?.expansion_of,
    circular: flags?.circular,
    counterparty_unnamed: flags?.counterparty_unnamed,
    conditions: flags?.conditions,
    sources: sourceUrls(deal.sources),
    notes: deal.notes,
    recorded: deal.recorded,
  }
})

await mkdir(output(''), { recursive: true })
await Promise.all([
  write('entities.csv', entities),
  write('relations.csv', relations),
  write('ai-compute-deal-ledger.csv', deals),
  copyFile(raw('state-of-ai-sources.csv'), output('sources.csv')),
  copyFile(raw('epoch-revenue-reports.csv'), output('ai_companies_revenue_reports.csv')),
])
