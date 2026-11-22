import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const companies = [
  ['microsoft', 'Microsoft', 'msft', false],
  ['alphabet', 'Alphabet', 'alphabet', false],
  ['amazon', 'Amazon', 'amazon', true],
  ['meta', 'Meta', 'meta', false],
  ['oracle', 'Oracle', 'oracle', false],
  ['coreweave', 'CoreWeave', 'coreweave', false],
  ['nvidia', 'NVIDIA', 'nvidia', true],
  ['amd', 'AMD', 'amd', false],
  ['broadcom', 'Broadcom', 'broadcom', false],
];
const manifest = JSON.parse(await readFile(resolve(root, 'data/raw/sec-capex-manifest.json'), 'utf8'));
for (const company of manifest.companies) {
  if (companies.some(([id]) => id === company.id)) continue;
  if (!['PaymentsToAcquireProductiveAssets', 'PaymentsToAcquirePropertyPlantAndEquipment'].includes(company.concept)) continue;
  const input = JSON.parse(await readFile(resolve(root, `data/raw/sec-capex/${company.id}.json`), 'utf8'));
  if (!input.facts[company.concept]?.units?.USD) continue;
  companies.push([company.id, company.name, company.id, company.concept === 'PaymentsToAcquireProductiveAssets']);
}

const day = 86400000;
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / day + 1;
const nextDay = (date) => new Date(Date.parse(date) + day).toISOString().slice(0, 10);
const source = (fact, cik, concept) => ({
  url: `https://www.sec.gov/Archives/edgar/data/${cik}/${fact.accn.replaceAll('-', '')}/`,
  type: 'primary', date: fact.filed, accession: fact.accn, form: fact.form,
  concept: `us-gaap:${concept}`, start: fact.start, end: fact.end, valueUsd: fact.val, fiscalYear: fact.fy,
});

// Select original current-period YTD facts; later comparative values can have a
// different fp/fy and cannot establish the period of the current filing.
function quarterize(facts, cik, concept) {
  const byPeriod = new Map();
  for (const f of facts) {
    const q = { Q1: 1, Q2: 2, Q3: 3, FY: 4 }[f.fp];
    const duration = f.start && days(f.start, f.end);
    if (!q || !duration || Math.abs(duration - q * 91.3) > 20 || days(f.end, f.filed) > 120) continue;
    const key = `${f.start}/${f.end}`;
    const old = byPeriod.get(key);
    if (!old || f.filed < old.filed || (f.filed === old.filed && f.accn < old.accn)) byPeriod.set(key, f);
  }
  const selected = [...byPeriod.values()].sort((a, b) => a.end.localeCompare(b.end));
  const result = new Map();
  for (const f of selected) {
    const q = { Q1: 1, Q2: 2, Q3: 3, FY: 4 }[f.fp];
    const previous = q === 1 ? null : selected.find((p) => p.start === f.start && ({ Q1: 1, Q2: 2, Q3: 3 }[p.fp] === q - 1) && days(p.end, f.end) >= 70 && days(p.end, f.end) <= 110);
    if (q > 1 && !previous) continue;
    const start = previous ? nextDay(previous.end) : f.start;
    const value = f.val - (previous?.val ?? 0);
    if (!Number.isFinite(value)) throw new Error(`Invalid value ${cik} ${f.end}`);
    result.set(f.end, { start, end: f.end, value, q, facts: [f, ...(previous ? [previous] : [])].map((v) => source(v, cik, concept)) });
  }
  return result;
}

const capex = [];
for (const [id, , file, productive] of companies) {
  const input = JSON.parse(await readFile(resolve(root, `data/raw/sec-capex/${file}.json`), 'utf8'));
  const concept = productive ? 'PaymentsToAcquireProductiveAssets' : 'PaymentsToAcquirePropertyPlantAndEquipment';
  const costs = quarterize(input.facts[concept]?.units?.USD ?? [], input.cik, concept);
  const operating = quarterize(input.facts.NetCashProvidedByUsedInOperatingActivities?.units.USD ?? [], input.cik, 'NetCashProvidedByUsedInOperatingActivities');
  for (const record of costs.values()) {
    if (record.end < '2023-01-01' || record.value < 0) continue;
    const date = new Date(`${record.end}T00:00:00Z`);
    // A 52/53-week period ending just after month-end belongs to the nearest calendar quarter.
    if (date.getUTCDate() <= 7) date.setUTCDate(date.getUTCDate() - 7);
    const quarter = `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
    const startYear = Number(record.facts[0].start.slice(0, 4));
    const startMonth = Number(record.facts[0].start.slice(5, 7));
    const fiscalYear = startYear + (['microsoft', 'oracle', 'nvidia', 'broadcom'].includes(id) || (id === 'amd' && startMonth === 12) ? 1 : 0);
    const fiscalLabel = manifest.companies.some((item) => item.id === id) ? `Fiscal Q${record.q}` : `FY${fiscalYear} Q${record.q}`;
    const ocf = operating.get(record.end);
    const comparableOcf = ocf && ocf.start === record.start;
    capex.push({
      id: `${id}-${quarter}-sec-cash`, companyId: id, quarter,
      valueUsd: record.value, rawValue: record.value, valueField: 'sec-cash-flow',
      basis: 'cash', basisDetail: productive ? 'cash-productive-assets' : 'cash-property-equipment',
      date: record.end, period: { start: record.start, end: record.end, fiscal: fiscalLabel },
      sourceUrl: record.facts[0].url, sourceName: 'SEC EDGAR company facts', sourceType: 'filing',
      sourceDocuments: record.facts, confidence: 'xbrl', method: record.q === 1 ? 'as_reported' : 'difference_of_fiscal_ytd',
      notes: productive ? 'Cash payments for productive assets; the XBRL concept also includes software and other intangible assets.' : 'Cash payments to acquire property, plant and equipment.',
      ...(comparableOcf ? { operatingCashFlowUsd: ocf.value, cashFlowSources: ocf.facts } : {}),
    });
  }
}
capex.sort((a, b) => a.companyId.localeCompare(b.companyId) || a.date.localeCompare(b.date));
if (new Set(capex.map((r) => r.id)).size !== capex.length) throw new Error('Duplicate company/calendar quarter');
const output = {
  metadata: {
    sourceUrl: 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces',
    sourceName: 'SEC EDGAR XBRL company facts', retrievedThrough: manifest.asOf,
    methodology: 'Original 10-Q and 10-K fiscal-year-to-date cash flows. Q2–Q4 are the difference from the immediately preceding fiscal YTD fact with the same start. Missing predecessor periods are omitted; no interpolation. Calendar quarter follows the fiscal period end, with dates in the first seven days of a month assigned to the preceding month to align 52/53-week fiscal calendars.',
    notes: ['Cash payments exclude noncash lease commencements and are not a measure of AI-only spending.', 'Productive-assets concepts include software and intangibles and are kept separate from property-and-equipment concepts.', 'Operating cash flow is attached only when its exact quarter dates match the capex period.'],
  },
  companies: companies.map(([id, name]) => ({ id, name })),
  capex,
};
await writeFile(resolve(root, 'public/data/capex-filings.json'), JSON.stringify(output, null, 2) + '\n');
console.log(`Wrote ${capex.length} SEC capex records for ${companies.length} companies`);
