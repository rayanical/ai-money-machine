import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvParse } from 'd3';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { annual } = JSON.parse(await readFile(resolve(root, 'public/data/operating-revenue.json'), 'utf8'));
const identities = JSON.parse(await readFile(resolve(root, 'data/raw/state-of-ai-entities.json'), 'utf8'));
const history = JSON.parse(await readFile(resolve(root, 'data/raw/state-of-ai-history.json'), 'utf8'));
const layers = csvParse(await readFile(resolve(root, 'public/data/entities.csv'), 'utf8'));
const layerById = new Map(layers.map(({ id, layer }) => [id, layer]));
const latestIndex = history.dates.length - 1;
const marketDate = history.dates[latestIndex];
if (!/^\d{4}-\d{2}-\d{2}$/.test(marketDate)) throw new Error('Invalid market snapshot date');
const publicCompanies = identities.entities.filter((company) =>
  company.kind === 'company' && company.ticker && company.valuation_live === true);
const marketCompanies = publicCompanies.flatMap((company) => {
  const value = history.series[company.id]?.[latestIndex];
  // A missing snapshot stays unavailable. A later value can be private or use a different date.
  if (value == null) return [];
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid market cap: ${company.id}`);
  const sector = layerById.get(company.id);
  if (!sector) throw new Error(`Missing published company layer: ${company.id}`);
  return [{ ...company, sector, value }];
});
const covered = new Set(annual.map(({ companyId }) => companyId));
const companiesById = new Map(publicCompanies.filter(({ id }) => covered.has(id)).map(({ id, name, ticker }) =>
  [id, { id, name, ticker, sector: layerById.get(id) }]));
for (const { id, name, ticker, sector } of marketCompanies) {
  companiesById.set(id, { id, name, ticker, sector });
}
const companies = [...companiesById.values()];
const financial = [...annual];
for (const { id, ticker, value } of marketCompanies) {
  financial.push({
    id: `${id}-market-cap-${marketDate}`,
    companyId: id,
    metric: 'valuation',
    valueUsd: value * 1_000_000,
    rawValue: value,
    basis: 'Public market capitalization',
    date: marketDate,
    dateBasis: 'Snapshot date',
    sourceUrl: 'https://stateofai.world/data/history.json',
    sourceName: 'State of AI World',
    sourceType: 'Archived market data',
    sourceUrls: ['https://stateofai.world/data/history.json', `https://stateofai.world/c/${id}`, 'https://stateofai.world/open-data'],
    origin: 'State of AI World, CC BY 4.0',
    comparisonEligible: true,
    scope: 'Consolidated company',
    notes: `Publisher's historical daily market-cap mark for ${ticker}, sourced to market data. Values can change after the observation date.`,
    rawRecord: { units: 'USD millions', asOf: marketDate, ticker },
  });
}
if (new Set(companies.map(({ id }) => id)).size !== companies.length || new Set(financial.map(({ id }) => id)).size !== financial.length) throw new Error('Duplicate company or observation ID');
await writeFile(resolve(root, 'public/data/ecosystem-financials.json'), JSON.stringify({ companies, financial }, null, 2) + '\n');
console.log(`Wrote ${financial.length} annual revenue and market cap observations for ${companies.length} public companies`);
