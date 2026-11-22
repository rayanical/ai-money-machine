import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { csvParse } from 'd3'

const raw = (name) => new URL(`../data/raw/${name}`, import.meta.url)
const asset = (name) => new URL(`../public/data/${name}`, import.meta.url)
const [entitySource, relationSource, entityCsv, dealSource] = await Promise.all([
  readFile(raw('state-of-ai-entities.json'), 'utf8').then(JSON.parse),
  readFile(raw('state-of-ai-relations.json'), 'utf8').then(JSON.parse),
  readFile(asset('entities.csv'), 'utf8').then(csvParse),
  readFile(raw('deal-ledger-regards.json'), 'utf8').then(JSON.parse),
])

const layers = new Map(entityCsv.map(({ id, layer }) => [id, layer]))
assert.equal(layers.size, entitySource.entities.length, 'Entity exports must have the same unique IDs')
const entities = entitySource.entities.map((entity) => {
  const layer = layers.get(entity.id)
  assert.ok(layer, `Missing published layer for ${entity.id}`)
  return { ...entity, layer }
})
const ids = new Set(entities.map(({ id }) => id))
assert.equal(ids.size, entities.length, 'Duplicate entity ID')
assert.equal(relationSource.as_of, entitySource.as_of, 'Network inputs have different snapshot dates')
const edgeKeys = new Set()
for (const { source, target, type } of relationSource.relations) {
  assert.ok(ids.has(source) && ids.has(target), `Unknown relationship endpoint: ${source} → ${target}`)
  const key = JSON.stringify([source, target, type])
  assert.ok(!edgeKeys.has(key), `Duplicate relationship: ${key}`)
  edgeKeys.add(key)
}

const save = (name, value) => writeFile(asset(name), `${JSON.stringify(value, null, 2)}\n`)
await Promise.all([
  save('entities.json', { ...entitySource, entities }),
  save('relations.json', relationSource),
])

const files = [
  ['entities.json', 'https://stateofai.world/data/entities.json'],
  ['entities.csv', 'https://stateofai.world/data/entities.csv'],
  ['relations.json', 'https://stateofai.world/data/relations.json'],
  ['relations.csv', 'https://stateofai.world/data/relations.csv'],
  ['sources.csv', 'https://stateofai.world/data/sources.csv'],
  ['deal-ledger.json', 'https://www.regardsofwallstreet.com/data/ai-deals.json'],
  ['ai-compute-deal-ledger.csv', 'https://www.regardsofwallstreet.com/data/ai-deals.csv'],
  ['ai_companies_revenue_reports.csv', 'https://epoch.ai/data/ai-companies-documentation/downloads'],
]
const sources = await Promise.all(files.map(async ([file, url]) => {
  const data = await readFile(asset(file))
  return { file, url, sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length, license: 'CC BY 4.0' }
}))
await save('shared-snapshot.json', {
  retrieved_on: '2026-11-21',
  network_as_of: entitySource.as_of,
  network_verified_at: entitySource.verified_at,
  ledger_as_of: dealSource.last_updated,
  sources,
})
console.log(`Shared snapshot: ${entities.length} entities, ${edgeKeys.size} relationships, ${dealSource.deals.length} deals`)
