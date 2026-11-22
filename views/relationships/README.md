> Site integration: run `python3 views/relationships/scripts/build.py` from the repository root after generating `public/data`. It embeds the shared entities, relations, deal ledger, sources, and snapshot metadata into `public/relationships/index.html`. The generated page is standalone and keeps the local import/export controls. Run `node views/relationships/scripts/check.cjs` to validate the bundle and graph behavior. The original standalone documentation follows.

# Graph A — Company relationship graph

An interactive D3 v7 graph for the company network in Deliverable 1. All bundled companies, relationships, and deals are downloaded public records. There are no synthetic nodes or links.

## Start in one step

Run the root project and open **/relationships/index.html**, or double-click **dist/relationships/index.html** after building the project. The page embeds D3 and the data for offline use.

The initial view is the **full network: 232 entities (211 companies, 21 divisions), 540 directed relationships, 13 types, and 11 CSV layer categories**. All relationship families are enabled. The graph fills the screen; controls float on the left, details open on selection on the right, and the legend and view tools sit in the lower corners. There is no navigation bar or footer.

Open **Filters** to narrow the network. The default labels identify major hubs; enable **All labels** to see every name. The minus button hides the controls; **Controls** brings them back. Close Details with its × button or Escape. Sources and snapshot information are available under **Data & sources**.

## Explore, step by step

1. Search for a company, such as Microsoft, or select a name under Most connected.
2. Click a node to inspect its incoming/outgoing ties. Choose **Center neighborhood here** to follow it outward.
3. Choose **Nearby**, then use **Reach: 2 hops** for a wider neighborhood. Neighborhoods include both directions; arrowheads still preserve recorded direction.
4. Click an arrow or a relationship row to see its type, evidence date, confidence, and clickable source citation. Opposite-direction and parallel ties remain separate.
5. Filter Capital, Compute, Supply chain, Technical, or Competition. The count beside each family describes the full loaded dataset. All 13 relationship types are available in the type selector.
6. Enable **Investment + compute** to find company pairs with `invests_in` and either `rents` or `commits_to`. There are 15 pairs in the unfiltered bundled snapshot. Overlapping roles alone do not prove circular cash flows.
7. Open **Trace a path**, choose From and To, then Trace. The default Microsoft → OpenAI → Speak is a two-hop directed path. Choose Either direction to explore connectivity without following every arrow. Paths use the current filters.
8. Open **Layer, region & dates** for additional filters. A layer and region selection must both match the same endpoint. Dates are evidence as-of dates, not contract periods. Blank dates can be included or excluded explicitly.
9. Scroll to zoom, drag empty space to pan, drag a node to pin it, and double-click a node to release it. Fit recenters the view. Pause freezes the force simulation.
10. Use **Export** to download the current graph as SVG or the visible relationship rows as CSV, including source URLs. Company inspection includes a separate expandable list of linked deal records.

## Use your exact original dataset

The PDF describes 224 entities and 434 relationships. The public source has changed since that snapshot. To reproduce the counts in the PDF:

1. Locate the original **entities.csv** and **relations.csv** used for the deliverable. Use the files from your project, not a fresh download if exact historical reproduction matters.
2. Open the graph and click **Data & sources**.
3. Click **Choose data files**. Hold Ctrl on Windows/Linux or Command on macOS and select **both CSV files together**.
4. Wait for the success message with the loaded counts. The graph validates IDs and relationships before replacing its existing data. A bad file leaves the current graph in place.
5. Optionally upload **sources.csv**, **ai-deals.json**, or **company-aliases.csv** in the same selection, or upload optional tables later.
6. Uploads are kept in this browser when browser storage is available. They are not uploaded to a server, shared with other visitors, or automatically baked into the downloadable HTML. Use **Download current JSON** to save a portable copy of your imported snapshot.
7. Use **Restore bundled snapshot** to remove the saved import and return to the included public records. Moving an offline HTML file or using another browser can create a different browser-storage context.

If you do not have the old snapshot, the included real current snapshot is already usable. Nothing else needs to be fetched for Graph A.

## Download real replacement files

| Dataset | Download / source location | Upload filename |
| --- | --- | --- |
| Company nodes | https://stateofai.world/data/entities.csv | entities.csv |
| Directed network ties | https://stateofai.world/data/relations.csv | relations.csv |
| Additional provenance | https://stateofai.world/data/sources.csv | sources.csv |
| Full node JSON | https://stateofai.world/data/entities.json | entities.json |
| Full relationship JSON | https://stateofai.world/data/relations.json | relations.json |
| Deal ledger | https://www.regardsofwallstreet.com/data/ai-deals.json | ai-deals.json |

On each source page, use Download CSV / JSON or save the direct download above. If the browser displays JSON as text, use Save As. Do not save an HTML page with a .csv extension. If you cannot reach a source, keep using the bundled snapshot and replace it later using the same upload control.

## File schemas

`entities.csv` requires `id,name`. Recommended additional fields:

```csv
id,name,kind,parent,layer,region,confidence,as_of,source_url,source_title
```

`relations.csv` requires `source,target,type`. Recommended additional fields:

```csv
source,target,type,confidence,source_url,as_of,source_title
```

Each endpoint must match an entity ID exactly. IDs are strings. A relationship is uniquely keyed by `(source,target,type)`. Repeated keys and missing endpoints are rejected instead of silently counted. Confidence can be verified, reported, or another value shown as Other / unknown. Dates may be YYYY, YYYY-MM, YYYY-MM-DD, or blank. Empty values remain unknown. UTF-8 CSV, quoted commas, and quoted multiline fields are supported through D3’s CSV parser.

JSON accepts an array, `{ "entities": [...] }`, or `{ "relations": [...] }`; nodes / links / edges keys are also accepted. Original relation JSON supports `url` and `title` as source fields. A downloaded current snapshot JSON contains the entire import state and can be uploaded alone.

Supported relationship types:

| Family | Types |
| --- | --- |
| Capital | invests_in, owns |
| Compute | rents, commits_to |
| Supply chain | fabricated_by, equipped_by, memory_from, designed_with, packaged_by |
| Technical | builds_on, routes, trains_on |
| Competition | rivals |

The preferred deal input is the original ai-deals.json. A simple deal CSV may use:

```csv
id,announced,deal_type,status,parties,amount_usd,source_url,basis,qualifier,conditions,circular,counterparty_unnamed
```

`parties` contains company IDs separated by semicolons. `amount_usd` is USD, not millions, or blank. `circular` and `counterparty_unnamed` use true/false. The original JSON preserves provider/buyer roles and source types in greater detail.

## Handle missing company matches without inventing data

The bundled ledger has 62 records. The graph matches all parties for 34 records. Other records can still appear in a matched company’s inspector, with unresolved parties explicitly labeled.

1. Under Data & sources, expand **Schema & exact file locations**.
2. Click **Download unresolved aliases**.
3. Open the CSV in a spreadsheet. For a party you can identify, fill `company_id` with its exact ID from entities.csv.
4. Leave `company_id` blank for unnamed parties or companies absent from your network. Do not guess.
5. Save as UTF-8 **company-aliases.csv** and upload it. Blank mappings are ignored. Conflicting or missing target IDs are rejected.

Aliases use exact normalized names/IDs and an explicit crosswalk; there is no fuzzy matching. Default aliases: Google → alphabet, Meta Platforms → meta, NVIDIA Corporation → nvidia, Google DeepMind → deepmind. Canonical IDs/names take precedence over external aliases. Divisions such as xAI are not silently merged into parents such as SpaceX. Ledger imports do not create graph edges.

## Data provenance and interpretation

Downloaded on **2026-11-21**. The network snapshot is from **2026-11-20**, verified **2026-11-21**. The ledger release is from **2026-11-20**. These dates are distinct from individual relationship or deal dates.

- Every one of the 540 bundled relationships has a source URL; 49 have no evidence date.
- Node colors encode the 11 published CSV layer categories. Full JSON enriches descriptions and citations. Original source files are retained unchanged.
- Node **area** is proportional to filtered distinct neighbors + 1. Ranking uses the same unique-neighbor count, calculated before neighborhood/path selection. Edge rows are counted separately.
- Edge color encodes family. Verified links are solid, reported links dashed, and links with missing URLs or unknown evidence are dotted. Arrowheads indicate recorded source → target, not necessarily money flow.
- Confidence is supplied by the publishers, not independently certified by this visualization. Network verified → High; reported → Medium; other → Low / unknown. Ledger binding status → High; other statuses → Low / unknown. An unnamed counterparty flag is preserved even when a separate report supplies a name.
- Link width is constant. Amount labels in the newer relationship JSON are shown verbatim only in the inspector. No commitment, equity, revenue, or capex amounts are summed into link weights.
- Linked deal records remain a separate table. Company selection joins them; graph date filters do not filter that list. Deal values represent stated commitments, equity, or other labeled bases, not cash already spent.
- Current records may be incomplete or superseded; inspect the primary source and status when interpreting a tie.

This implements **Graph A** only. Graphs B/C, Epoch financial comparisons, capex charts, and the deal timeline are not included.

## Project files and optional development

| Path | Purpose |
| --- | --- |
| ../../dist/relationships/index.html | Self-contained graph for offline use or static hosting |
| index.template.html | Page structure |
| styles.css | Responsive styling |
| core.js | Validation, degree, path, pair, and matching logic |
| app.js | D3 rendering, filters, inspector, imports, exports |
| ../../public/data/ | Published data projections and snapshot manifest |
| vendor/ | Pinned D3 7.9.0 and license |
| scripts/build.py | Rebuild the embedded HTML |
| scripts/check.cjs | Data-integrity and graph-logic checks |
| templates/ | Empty optional CSV templates; no example rows |

Run `npm run data:shared` from the project root to rebuild the graph with the pinned snapshot. Run `npm run data:verify` from the project root to check it.

To update the default snapshot, update the source files in the root project’s data/raw directory and regenerate the shared data. Browser uploads customize only that browser’s copy.

## Attribution

Source: **State of AI World**, https://stateofai.world/open-data, downloaded 2026-11-21; network file as-of 2026-11-20. **CC BY 4.0**, https://creativecommons.org/licenses/by/4.0/.

**AI Compute Deal Ledger**, **Regards of Wallstreet**, https://www.regardsofwallstreet.com/data/ai-deals. **CC BY 4.0**. Source records are transformed for display and exact ID matching; originals and SHA-256 checksums are included.

**D3 v7.9.0**, https://d3js.org/, Copyright 2010–2023 Mike Bostock. ISC license; full notice is included in vendor.
