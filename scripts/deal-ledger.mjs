import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Offline snapshot of the publisher's JSON export.
const source = JSON.parse(await readFile(new URL('../data/raw/deal-ledger-regards.json', import.meta.url), 'utf8'));
if (!Array.isArray(source.deals) || !Array.isArray(source.entities) || source.deals.length !== source.aggregates.dealCount) {
  throw new Error('Deal ledger snapshot is incomplete');
}
const entityIds = new Set(source.entities.map((entity) => entity.id));
const dealIds = new Set();
for (const deal of source.deals) {
  if (!deal.id || dealIds.has(deal.id) || deal.parties.some((party) => !entityIds.has(party.entity))) {
    throw new Error(`Invalid deal or party: ${deal.id}`);
  }
  dealIds.add(deal.id);
}
const counts = (select) => Object.fromEntries(source.deals.reduce((counts, deal) => {
  const key = select(deal);
  counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}, new Map()));
const contractTypes = new Set(['capacity_lease', 'cloud_services', 'chip_purchase', 'build_contract']);
const byType = {};
let valueUsd = 0;
let count = 0;
for (const row of source.deals) {
  if (row.status !== 'binding' || !contractTypes.has(row.deal_type) || row.value?.basis !== 'base_term' ||
      !Number.isFinite(row.value.amount_usd) || row.value.amount_usd <= 0) continue;
  const entry = byType[row.deal_type] ??= { valueUsd: 0, count: 0 };
  entry.valueUsd += row.value.amount_usd;
  entry.count += 1;
  valueUsd += row.value.amount_usd;
  count += 1;
}
const output = {
  ...source,
  snapshot: {
    retrieved: '2026-11-21',
    exportUrl: 'https://www.regardsofwallstreet.com/data/ai-deals.json',
    retrievalNote: 'Downloaded directly from the publisher’s machine-readable export.',
    independentContext: {
      name: 'AI Compute Deals',
      methodology: 'https://aicomputedeals.com/methodology/',
      note: 'A separate ledger with different scope and methodology. Its headline total includes plans, ceilings and annual figures at face value and does not net overlapping rows. Do not add it to this dataset.'
    }
  },
  summary: {
    baseTerms: { valueUsd, count, byType },
    statusCounts: counts((deal) => deal.status),
    typeCounts: counts((deal) => deal.deal_type),
    valueBasisCounts: counts((deal) => deal.value?.basis ?? 'undisclosed')
  }
};
const dataDir = new URL('../public/data/', import.meta.url);
await mkdir(dataDir, { recursive: true });
await writeFile(new URL('deal-ledger.json', dataDir), `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${output.deals.length} deals and ${output.entities.length} entities`);
