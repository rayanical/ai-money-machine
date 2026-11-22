# AI Money Machine

A CS571 dashboard with three D3 views for AI company relationships, financial comparisons, and compute deals.

[Open the dashboard](https://rayanical.github.io/ai-money-machine/)

## Run locally

Use Node.js 20.19+ or 22.12+ and Python 3.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. Use `npm run build` for a production build and `npm run data:verify` to check the data against its inputs. Both commands and the dev server rebuild the data offline.

## Layout

- `src/` contains the dashboard and Financials. `FinancialAnalysisView` accepts `dataset`, `selectedCompanyId`, and `onCompanySelect`.
- `views/relationships/` contains the [relationship graph and its standalone guide](views/relationships/README.md). `deals/` contains the timeline and deal inspector.
- `data/raw/` holds pinned publisher exports. `scripts/` generates the runtime files in `public/data/`.

## Data sources

Financial comparisons retain each record's source, date, and accounting basis. Coverage depends on the available exports.

- [State of AI World](https://stateofai.world/open-data) supplies company identities, relationships, and valuation marks.
- Josh You, John Croxton, Venkat Somala, and Yafah Edelman, [Epoch AI's *Data on AI companies*](https://epoch.ai/data/ai-companies-documentation/downloads), supply lab financials and compute estimates.
- Regards of Wall Street publishes the [Hyperscaler Capex Tracker](https://www.regardsofwallstreet.com/data/capex), [AI Compute Deal Ledger](https://www.regardsofwallstreet.com/data/ai-deals), and [RPO and Backlog Tracker](https://www.regardsofwallstreet.com/data/rpo).
- [Data Center Census](https://datacentercensus.com/ai-capex) supplies lease disclosures and spending outlooks. [SEC Company Facts](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) supplies tagged filings data.

The State of AI World, Epoch AI, Regards of Wall Street, and Data Center Census exports are licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

The [MIT license](LICENSE) covers the project code. Third-party data and the [vendored D3 library](views/relationships/vendor/D3-LICENSE.txt) retain their own terms.
