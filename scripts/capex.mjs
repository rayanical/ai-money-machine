import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = JSON.parse(await readFile(resolve(root, 'data/raw/capex-tracker.json'), 'utf8'));
const identities = JSON.parse(await readFile(resolve(root, 'data/raw/state-of-ai-entities.json'), 'utf8'));
const census = JSON.parse(await readFile(resolve(root, 'data/raw/data-center-census-capex.json'), 'utf8'));
const outputPath = resolve(root, 'public/data/capex.json');
const detail = {
  microsoft: { cash_capex: 'cash-property-equipment', capex_including_finance_leases: 'microsoft-accrual-including-finance-lease-commencements' },
  alphabet: { cash_capex: 'cash-property-equipment' },
  amazon: { cash_capex_net: 'amazon-net-cash-capex', capex_including_finance_leases: 'amazon-net-including-equipment-finance-leases' },
  meta: { capex_including_finance_leases: 'meta-including-finance-lease-principal-payments' },
  oracle: { cash_capex: 'oracle-cash-capex' },
  coreweave: { cash_capex: 'coreweave-cash-capex' },
};
const companies = input.companies.map(({ id, name }) => ({ id, name }));
const canonicalIds = new Set(identities.entities.map(({ id }) => id));
for (const { id } of companies) {
  if (!canonicalIds.has(id)) throw new Error(`Missing canonical capex company ID: ${id}`);
}

const capex = input.series.flatMap(({ company, quarters }) => quarters.flatMap((q) => {
  const values = [{ metric: q.headlineBasis, amount: q.headlineUsd, field: 'headlineUsd' }];
  if (q.cash_capex_usd != null && q.cash_capex_basis !== q.headlineBasis) {
    values.push({ metric: q.cash_capex_basis, amount: q.cash_capex_usd, field: 'cash_capex_usd' });
  }
  return values.map(({ metric, amount, field }) => {
    const basisDetail = detail[company]?.[metric];
    if (!basisDetail || !Number.isFinite(amount) || amount < 0 || !/^\d{4}-Q[1-4]$/.test(q.period)) {
      throw new Error(`Invalid or unsupported capex record: ${company} ${q.period} ${metric}`);
    }
    return {
      id: `${company}-${q.period}-${metric}`,
      companyId: company,
      quarter: q.period,
      valueUsd: amount,
      rawValue: amount,
      valueField: field,
      basis: metric === 'capex_including_finance_leases' ? 'including-finance-leases' : 'cash',
      basisDetail,
      date: q.end,
      period: { start: q.start, end: q.end, fiscal: q.fiscal.label },
      sourceUrl: input.url,
      sourceName: input.name + ', ' + input.publisher,
      sourceType: 'dataset',
      sourceDocuments: q.sources,
      confidence: q.confidence,
      method: q.method,
      notes: q.notes,
      ...(q.revisions?.length ? { revisions: q.revisions } : {}),
    };
  });
}));
// Census publishes Meta's cash capex plus finance-lease principal at filing precision.
// Keep tracker amounts as revisions where the two cover the same quarter.
const meta = census.companies.find(({ id }) => id === 'meta');
if (!meta || !Array.isArray(meta.quarters)) throw new Error('Missing Meta Census quarters');
for (const q of meta.quarters) {
  const value = q.usd_including_finance_lease_principal;
  if (value == null) continue;
  if (!Number.isFinite(value) || value < 0 || !/^\d{4}-Q[1-4]$/.test(q.calendar_quarter) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(q.start) || !/^\d{4}-\d{2}-\d{2}$/.test(q.end) ||
      !/^https:\/\//.test(q.filing_url)) throw new Error(`Invalid Census Meta capex: ${q.calendar_quarter}`);
  const previous = capex.findIndex((point) => point.companyId === 'meta' && point.quarter === q.calendar_quarter &&
    point.basisDetail === 'meta-including-finance-lease-principal-payments');
  const tracker = previous >= 0 ? capex.splice(previous, 1)[0] : null;
  capex.push({
    id: `meta-${q.calendar_quarter}-census-lease-principal`, companyId: 'meta', quarter: q.calendar_quarter,
    valueUsd: value, rawValue: value, valueField: 'usd_including_finance_lease_principal',
    basis: 'including-finance-leases', basisDetail: 'meta-including-finance-lease-principal-payments',
    date: q.end, period: { start: q.start, end: q.end, fiscal: `FY${q.end.slice(0, 4)} ${q.calendar_quarter.slice(-2)}` },
    sourceUrl: 'https://datacentercensus.com/ai-capex', sourceName: 'Data Center Census', sourceType: 'dataset',
    sourceDocuments: [{ url: q.filing_url, type: 'filing', date: q.filed }],
    confidence: 'filing', method: 'company_filing',
    notes: tracker ? `Tracker reports ${tracker.valueUsd} USD for this quarter, rounded to millions.` :
      'Includes principal payments on finance leases.',
  });
}
if (new Set(capex.map(({ id }) => id)).size !== capex.length) throw new Error('Duplicate capex IDs');
const output = {
  metadata: {
    sourceUrl: input.url,
    sourceDataUrl: 'https://www.regardsofwallstreet.com/data/capex.json',
    methodology: input.methodology,
    license: input.license,
    attribution: input.cite_as,
    lastUpdated: input.last_updated,
    generatedAtSource: input.generated_at,
    notes: input.notes,
    companyDefinitions: input.companies.map(({ id, notes }) => ({ id, notes })),
  },
  companies,
  capex,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n');
console.log(`Wrote ${capex.length} capex records for ${companies.length} companies`);
