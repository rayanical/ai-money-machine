// Rebuild the financial dataset from the checked-in Epoch AI CSV snapshots.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

// RFC 4180-style CSV, including quoted commas, quotes, and embedded newlines.
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (quoted) throw new Error('Unterminated quoted field');
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  const headers = rows.shift();
  return rows.filter(r => r.some(Boolean)).map((r, i) => {
    if (r.length !== headers.length) throw new Error(`CSV row ${i + 2} has ${r.length} columns; expected ${headers.length}`);
    return Object.fromEntries(headers.map((h, j) => [h, r[j]]));
  });
}
const slug = name => name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const companyRows = parseCsv(await read('data/raw/epoch-companies.csv'));
const fundingRows = parseCsv(await read('data/raw/epoch-funding-rounds.csv'));
const revenueRows = parseCsv(await read('data/raw/epoch-revenue-reports.csv'));
const canonicalIds = new Map([['Mistral AI', 'mistral'], ['Z.ai (Zhipu)', 'zhipu'], ['Moonshot AI', 'moonshot'], ['Google', 'deepmind']]);
const companies = companyRows.map(row => ({ id: canonicalIds.get(row.Name) || slug(row.Name), name: row.Name === 'Google' ? 'Google DeepMind' : row.Name }));
const identityData = JSON.parse(await read('data/raw/state-of-ai-entities.json'));
const canonicalIdsAvailable = new Set(identityData.entities.map(entity => entity.id));
for (const company of companies) {
  if (!canonicalIdsAvailable.has(company.id)) throw new Error(`No canonical identity for ${company.name}: ${company.id}`);
}
const companyIds = new Map(companyRows.map((row, i) => [row.Name, companies[i].id]));
if (new Set(companyIds.values()).size !== companies.length) throw new Error('Duplicate company slug');
const financial = [];
const openAiRoundComponents = new Set(['840B Feb 2026', '852B March 2026']);
function add(row, metric, column, basis, extra = {}) {
  const rawValue = row[column];
  if (!rawValue) return;
  const valueUsd = Number(rawValue);
  if (!Number.isFinite(valueUsd) || valueUsd < 0) throw new Error(`Invalid amount in ${row.Id}: ${rawValue}`);
  const companyId = companyIds.get(row.Company);
  if (!companyId) throw new Error(`Unknown company ${row.Company}`);
  const id = `${metric}-${createHash('sha256').update(`${row.Company}\0${row.Id}\0${column}`).digest('hex').slice(0, 16)}`;
  const sourceUrls = [row['Source 1'], row['Source 2'], row['Source 3']].map(url => url.trim()).filter(Boolean);
  financial.push({ id, companyId, metric, valueUsd, rawValue, basis,
    date: row['Close date'] || row.Date || row['Report date'] || null,
    sourceUrl: sourceUrls[0] || 'https://epoch.ai/data/ai-companies',
    sourceName: 'Epoch AI', sourceType: row['Source type'] || 'Epoch AI compilation',
    sourceUrls, sourceRecordId: row.Id, valueColumn: column, reportDate: row['Report date'] || null, origin: 'Epoch AI',
    notes: [row['Graph note'], row.Notes].filter(Boolean).join('\n\n'),
    ...extra, rawRecord: row });
}
for (const row of fundingRows) {
  const extra = { status: row.Status, confidence: row.Confidence, dateBasis: row['Close date'] ? 'Close date' : 'Report date', comparisonEligible: row.Status === 'Closed' };
  const ipo = ['Z.ai IPO', 'MiniMax IPO'].includes(row.Id);
  const secondary = row.Type === 'Secondary';
  const roundComponent = row.Company === 'OpenAI' && openAiRoundComponents.has(row.Id);
  const amazonTotal = row.Company === 'Anthropic' && row.Id === 'Amazon March 2024';
  const fundingBasis = ipo ? 'IPO proceeds' : secondary ? 'Issuer proceeds from secondary share sale' :
    roundComponent ? 'Primary equity funding component' : amazonTotal ? 'Cumulative Amazon equity investment' :
    `${row.Type || 'Unspecified'} equity funding`;
  add(row, 'funding', 'Funding (equity)', fundingBasis, {
    ...extra,
    comparisonEligible: extra.comparisonEligible && !ipo && !roundComponent && !amazonTotal && !secondary,
  });
  const revolvingFacility = row.Company === 'OpenAI' && row.Id === 'Oct 2024 157B';
  add(row, 'funding', 'Funding (debt)', revolvingFacility ? 'Revolving credit facility capacity' : `${row.Type || 'Unspecified'} debt funding`, {
    ...extra,
    comparisonEligible: extra.comparisonEligible && !revolvingFacility,
  });
  const publicMarket = ['Z.ai IPO', 'MiniMax IPO', 'Z.ai Q1', 'MiniMax Q1'].includes(row.Id);
  const merger = row.Id === 'Mar 2025 80B X merger';
  const valuationBasis = row.Id.endsWith(' Q1') ? 'Public market capitalization' : row.Id.endsWith(' IPO') ? 'IPO valuation' :
    merger ? 'Merger valuation' : secondary ? 'Secondary sale implied valuation' : 'Post-money valuation';
  add(row, 'valuation', 'Valuation (post-money)', valuationBasis, {
    ...extra, comparisonEligible: extra.comparisonEligible && !publicMarket && !merger && !secondary,
  });
}
for (const row of revenueRows) {
  const column = row['Annualized revenue (USD)'] ? 'Annualized revenue (USD)' : row['Period revenue'] && row['Period type'] ? 'Period revenue' : 'Revenue amount (normalize to annual)';
  const basis = column === 'Period revenue' ? `${row['Period type']} revenue` : row['Annualized revenue type'] || 'Annualized revenue (basis unspecified)';
  const reportDate = row['Report date'];
  add(row, 'revenue', column, basis, {
    period: row['Period type'] || null, scope: row.Scope, confidence: row.Confidence,
    reportDate: reportDate && (!row.Date || reportDate >= row.Date) ? reportDate : null,
    approximate: basis === 'Annualized run rate' || basis === 'Period interpolation' || ['Likely', 'Uncertain'].includes(row.Confidence),
    dateBasis: row.Date ? 'Observation date' : 'Report date',
    comparisonEligible: row.Scope === 'Full company' && basis !== 'Period interpolation',
  });
}
if (new Set(financial.map(row => row.id)).size !== financial.length) throw new Error('Duplicate financial record ID');
const output = { companies, financial, metadata: { source: 'Epoch AI, Data on AI companies', sourceUrl: 'https://epoch.ai/data/ai-companies', license: 'CC BY 4.0', snapshot: '2026-11-18', note: 'Amounts are nominal USD as provided by Epoch AI. Revenue bases and transaction statuses differ; consult each record before comparing or summing.' } };
await mkdir(new URL('public/data/', root), { recursive: true });
await writeFile(new URL('public/data/financial.json', root), JSON.stringify(output, null, 2) + '\n');
console.log(`Wrote ${companies.length} companies and ${financial.length} financial records`);
