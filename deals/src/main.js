import * as d3 from "d3";
import "@fontsource-variable/dm-sans";
import "./style.css";

const embedded = document.documentElement.classList.contains("embedded");
const dataBase = import.meta.env.BASE_URL === "./"
  ? new URL("../data/", document.baseURI).href
  : `${import.meta.env.BASE_URL}data/`;

const FILES = {
  ledger: `${dataBase}ai-compute-deal-ledger.csv`,
  revenue: `${dataBase}ai_companies_revenue_reports.csv`,
  entities: `${dataBase}entities.csv`,
  relations: `${dataBase}relations.csv`,
  sources: `${dataBase}sources.csv`,
};

const LANES = [
  { key: "cloud_services",     label: "Cloud services" },
  { key: "capacity_lease",     label: "Capacity lease" },
  { key: "chip_purchase",      label: "Chip purchase" },
  { key: "compute_equity",     label: "Compute equity" },
  { key: "backstop_guarantee", label: "Backstop guarantee" },
  { key: "build_contract",     label: "Build contract" },
  { key: "snapshot",           label: "Snapshots & backlogs" },
];
const LANE_LABEL = new Map(LANES.map(d => [d.key, d.label]));

// 6 maximally distinct, colourblind-friendly hues (Blue, Amber, Green, Crimson, Purple, Brown)
const PALETTE = ["#0072B2", "#E69F00", "#009E73", "#C81E4B", "#7C3AED", "#8C564B"];
const OTHER_COLOR = "#7c8594";
const CERT_COLORS = { high: "#0072B2", medium: "#E69F00", low: "#D55E00" };

const ENTITY_ALIASES = {
  "google": "alphabet",
  "google cloud": "alphabet",
  "aws": "amazon",
  "microsoft azure": "microsoft",
  "azure": "microsoft",
  "meta platforms": "meta",
  "oracle cloud": "oracle",
  "mistral ai": "mistral",
  "z ai zhipu": "zhipu",
};

const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const normalizeParty = name => {
  const s = String(name ?? "").trim();
  if (!s) return "";
  if (/^(undisclosed|various|unnamed|multiple|confidential)/i.test(s)) return "Undisclosed / Various";
  return s;
};

const parseDate = d3.utcParse("%Y-%m-%d");
const fmtDate = d3.utcFormat("%Y-%m-%d");
const fmtMonth = d3.utcFormat("%b %Y");
const fmtMoney = b =>
  b == null || isNaN(b)
    ? "Undisclosed"
    : b >= 1 ? `$${d3.format(",.1f")(b)}B` : `$${d3.format(",.0f")(b * 1000)}M`;

const esc = s =>
  String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const hostLabel = url => {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
};

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const dur = ms => (reducedMotion() ? 0 : ms);

// DOM refs
const headlineEl = document.getElementById("headline-summary");
const kpisEl = document.getElementById("kpis");
const legendEl = document.getElementById("legend");
const vizFrameEl = document.getElementById("viz-frame");
const tableFrameEl = document.getElementById("table-frame");
const contextFrameEl = document.getElementById("context-frame");
const revenueTableEl = document.getElementById("rev-table");
const containerEl = contextFrameEl.closest(".container");
const chartEl = document.getElementById("chart");
const overviewEl = document.getElementById("overview");
const detailsEl = document.getElementById("details");
const tooltipEl = document.getElementById("tooltip");
const partyPillEl = document.getElementById("party-pill");
const helpPopEl = document.getElementById("help-pop");
if (embedded && matchMedia("(max-width: 700px)").matches) {
  legendEl.closest("details").open = false;
}

const colorBySelect = document.getElementById("color-by");
const certaintySelect = document.getElementById("certainty-filter");
const bindingCheckbox = document.getElementById("binding-only");
const circularCheckbox = document.getElementById("circular-only");
const annualizedCheckbox = document.getElementById("annualized-toggle");
const hideSupersededCheckbox = document.getElementById("hide-superseded");
const ghostCheckbox = document.getElementById("ghost-mode");
const dateFromInput = document.getElementById("date-from");
const dateToInput = document.getElementById("date-to");
const copyLinkBtn = document.getElementById("copy-link-btn");
const exportCsvBtn = document.getElementById("export-csv-btn");
const exportPngBtn = document.getElementById("export-png-btn");
const resetBtn = document.getElementById("reset-btn");
const presetBtns = [...document.querySelectorAll("[data-preset]")];
const viewBtns = [...document.querySelectorAll("[data-view]")];

// Single reactive state object
const state = {
  view: "timeline",       // "timeline" | "table" | "context"
  colorBy: "buyer",       // "buyer" | "provider" | "deal_type" | "certainty"
  certainty: "all",
  bindingOnly: false,
  circularOnly: false,
  annualized: false,
  hideSuperseded: true,
  ghost: true,
  party: null,            // string | null
  colorFilter: null,      // legend item filter (works for "Other" too)
  selectedId: null,
  focusedId: null,
  brushDomain: null,      // [Date, Date] | null
  sortCol: "date",
  sortDir: "desc",
  width: 760,
};

let allDeals = [];
let dealById = new Map();
let fullDomain = [];
let revenueRows = [];
let entityByNorm = new Map();
let relationsByEntity = new Map();
let sourceMetaByUrl = new Map();

let currentColorMap = new Map();
let currentLegendKeys = [];
let renderedLegendMode = null;
let rScale = null;

// Persistent D3 selections
let mainSvg, mainG, xScale, yScale, xAxisG, yAxisG, gridG, lanesG, linksG, nodesG, annG;
let ovBrush, ovBrushG, ovX;
let isSyncingBrush = false;

// ---- Hash State ----
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (["timeline", "table", "context"].includes(p.get("view"))) state.view = p.get("view");
  if (["buyer", "provider", "deal_type", "certainty"].includes(p.get("color"))) state.colorBy = p.get("color");
  if (p.get("cert")) state.certainty = p.get("cert");
  if (p.get("binding") === "1") state.bindingOnly = true;
  if (p.get("circular") === "1") state.circularOnly = true;
  if (p.get("ann") === "1") state.annualized = true;
  if (p.get("sup") === "0") state.hideSuperseded = false;
  if (p.get("ghost") === "0") state.ghost = false;
  if (p.get("party")) state.party = p.get("party");
  if (p.get("cfilter")) state.colorFilter = p.get("cfilter");
  if (p.get("id")) state.selectedId = p.get("id");
  const from = parseDate(p.get("from"));
  const to = parseDate(p.get("to"));
  if (from && to && from < to) state.brushDomain = [from, to];
}

function writeHash() {
  const p = new URLSearchParams();
  if (state.view !== "timeline") p.set("view", state.view);
  if (state.colorBy !== "buyer") p.set("color", state.colorBy);
  if (state.certainty !== "all") p.set("cert", state.certainty);
  if (state.bindingOnly) p.set("binding", "1");
  if (state.circularOnly) p.set("circular", "1");
  if (state.annualized) p.set("ann", "1");
  if (!state.hideSuperseded) p.set("sup", "0");
  if (!state.ghost) p.set("ghost", "0");
  if (state.party) p.set("party", state.party);
  if (state.colorFilter) p.set("cfilter", state.colorFilter);
  if (state.selectedId) p.set("id", state.selectedId);
  if (state.brushDomain) {
    p.set("from", fmtDate(state.brushDomain[0]));
    p.set("to", fmtDate(state.brushDomain[1]));
  }
  const str = p.toString();
  history.replaceState(null, "", str ? `#${str}` : location.pathname + location.search);
}

// ---- CSV Fetching ----
async function fetchCsv(path, optional = false) {
  const res = await fetch(path);
  const isHtml = (res.headers.get("content-type") || "").includes("text/html");
  if (!res.ok || isHtml) {
    if (optional) return null;
    throw new Error(`Could not load ${path}`);
  }
  const text = (await res.text()).replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  while (lines.length && lines[0].trimStart().startsWith("#")) lines.shift();
  return d3.csvParse(lines.join("\n"));
}

async function loadAllData() {
  const [ledgerRaw, revRaw, entRaw, relRaw, srcRaw] = await Promise.all([
    fetchCsv(FILES.ledger, false),
    fetchCsv(FILES.revenue, true),
    fetchCsv(FILES.entities, true),
    fetchCsv(FILES.relations, true),
    fetchCsv(FILES.sources, true),
  ]);

  if (srcRaw) {
    srcRaw.forEach(r => {
      if (r.url) sourceMetaByUrl.set(r.url.trim(), { title: r.title || r.outlet || "", outlet: r.outlet || "" });
    });
  }

  if (entRaw) {
    entRaw.forEach(e => {
      entityByNorm.set(norm(e.id), e);
      entityByNorm.set(norm(e.name), e);
    });
  }

  if (relRaw) {
    relRaw.forEach(r => {
      const add = id => {
        if (!relationsByEntity.has(id)) relationsByEntity.set(id, []);
        relationsByEntity.get(id).push(r);
      };
      add(r.source);
      add(r.target);
    });
  }

  if (revRaw) {
    revenueRows = revRaw
      .map(r => ({
        company: r.Company,
        date: parseDate(String(r.Date || "").slice(0, 10)),
        annualizedB: r["Revenue amount (normalize to annual)"]
          ? +r["Revenue amount (normalize to annual)"] / 1e9
          : r["Annualized revenue (USD)"] ? +r["Annualized revenue (USD)"] / 1e9 : null,
        confidence: r.Confidence || "",
        scope: r.Scope || "",
      }))
      .filter(r => r.date && r.annualizedB != null)
      .sort((a, b) => a.date - b.date);
  }

  const rows = ledgerRaw
    .map(r => {
      const amountUsd = r.amount_usd === "" ? null : +r.amount_usd;
      const amountB = amountUsd != null ? amountUsd / 1e9 : null;
      const termYears = r.term_years === "" ? null : +r.term_years;
      const annualizedB = amountB != null && termYears > 0 ? amountB / termYears : null;
      const sourceUrls = String(r.sources ?? "").split(/\s+/).filter(u => u.startsWith("http"));
      const isBinding = r.status === "binding";
      const isSuperseded = r.status === "superseded";
      const isSnapshot = ["total_backlog", "program_envelope", "order_intake"].includes(r.value_basis);

      let certainty = "high";
      if (!isBinding || isSnapshot || !sourceUrls.length) certainty = "low";
      else if (r.value_kind === "media_reported") certainty = "medium";

      const splitClean = v =>
        [...new Set(String(v ?? "").split(";").map(normalizeParty).filter(Boolean))];

      const buyers = splitClean(r.buyers);
      const providers = splitClean(r.providers);
      const financiers = splitClean(r.financiers);
      const parties = [...new Set([...buyers, ...providers, ...financiers])];

      return {
        ...r,
        date: parseDate(r.announced),
        amountB,
        annualizedB,
        termYears,
        mwIt: r.mw_it === "" ? null : +r.mw_it,
        usdPerMwYear: r.usd_per_mw_year === "" ? null : +r.usd_per_mw_year,
        revenueStart: r.revenue_start || "",
        expansionOf: (r.expansion_of || "").trim(),
        circular: String(r.circular).toLowerCase() === "true",
        isBinding,
        isSuperseded,
        isSnapshot,
        lane: isSnapshot ? "snapshot" : (LANE_LABEL.has(r.deal_type) ? r.deal_type : "cloud_services"),
        certainty,
        buyers,
        providers,
        financiers,
        parties,
        primaryBuyer: buyers[0] || "Undisclosed / Various",
        primaryProvider: providers[0] || "Undisclosed / Various",
        sourceUrls,
      };
    })
    .filter(d => d.date)
    .sort((a, b) => a.date - b.date);

  dealById = new Map(rows.map(d => [d.id, d]));
  rows.forEach(d => { d.expansions = []; });
  rows.forEach(d => {
    if (d.expansionOf && dealById.has(d.expansionOf)) {
      dealById.get(d.expansionOf).expansions.push(d.id);
    }
  });

  return rows;
}

// ---- Dynamic Encodings (Color & Size) ----
function dealValueB(d) {
  return state.annualized ? d.annualizedB : d.amountB;
}

function updateScalesAndColors() {
  const countableVals = allDeals
    .filter(d => !d.isSnapshot && dealValueB(d) != null)
    .map(dealValueB);
  const maxVal = d3.max(countableVals) || (state.annualized ? 50 : 100);
  rScale = d3.scaleSymlog()
    .constant(state.annualized ? 2 : 8)
    .domain([0, maxVal])
    .range([5, 22])
    .clamp(true);

  allDeals.forEach(d => {
    const v = dealValueB(d);
    d.radius = v != null ? rScale(v) : 6.5;
  });

  currentColorMap = new Map();
  if (state.colorBy === "certainty") {
    currentLegendKeys = ["high", "medium", "low"];
    currentLegendKeys.forEach(k => currentColorMap.set(k, CERT_COLORS[k]));
    allDeals.forEach(d => {
      d.colorKey = d.certainty;
      d.color = CERT_COLORS[d.certainty];
    });
  } else if (state.colorBy === "deal_type") {
    currentLegendKeys = LANES.slice(0, 6).map(l => l.key);
    currentLegendKeys.forEach((k, i) => currentColorMap.set(k, PALETTE[i % PALETTE.length]));
    allDeals.forEach(d => {
      d.colorKey = currentColorMap.has(d.deal_type) ? d.deal_type : "Other";
      d.color = currentColorMap.get(d.colorKey) ?? OTHER_COLOR;
    });
  } else {
    const field = state.colorBy === "provider" ? "primaryProvider" : "primaryBuyer";
    const counts = d3.rollup(
      allDeals.filter(d => d[field] !== "Undisclosed / Various"),
      v => v.length,
      d => d[field]
    );
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, PALETTE.length)
      .map(d => d[0]);

    top.forEach((k, i) => currentColorMap.set(k, PALETTE[i]));
    currentColorMap.set("Other", OTHER_COLOR);
    currentLegendKeys = [...top, "Other"];

    allDeals.forEach(d => {
      d.colorKey = currentColorMap.has(d[field]) ? d[field] : "Other";
      d.color = currentColorMap.get(d.colorKey);
    });
  }
}

function matchesFilters(d) {
  if (state.hideSuperseded && d.isSuperseded) return false;
  if (state.certainty !== "all" && d.certainty !== state.certainty) return false;
  if (state.bindingOnly && (!d.isBinding || d.isSnapshot)) return false;
  if (state.circularOnly && !d.circular) return false;
  if (state.party && !d.parties.includes(state.party)) return false;
  if (state.colorFilter && d.colorKey !== state.colorFilter) return false;
  if (state.brushDomain && (d.date < state.brushDomain[0] || d.date > state.brushDomain[1])) return false;
  return true;
}

// ---- Tooltip ----
function showTooltip(x, y, d) {
  const val = dealValueB(d);
  const valLabel = state.annualized ? `${fmtMoney(val)}/yr` : fmtMoney(val);
  tooltipEl.innerHTML = `
    <strong>${esc(d.id)}</strong><br/>
    ${fmtDate(d.date)} · ${esc(LANE_LABEL.get(d.lane) ?? d.deal_type)}<br/>
    ${esc(d.parties.slice(0, 4).join(" · "))}<br/>
    <b>${valLabel}</b> · ${esc(d.status)} · Certainty: <b>${d.certainty}</b>
  `;
  tooltipEl.hidden = false;
  const left = Math.min(x + 14, window.innerWidth - 280);
  const top = Math.max(y - 12, 8);
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

function hideTooltip() {
  tooltipEl.hidden = true;
}

// ---- Legend (preserves focus across updates) ----
function renderLegend() {
  const modeKey = `${state.colorBy}|${state.annualized}`;
  if (renderedLegendMode === modeKey) {
    legendEl.querySelectorAll("[data-color-val]").forEach(btn => {
      const on = state.colorFilter === btn.dataset.colorVal;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
    return;
  }

  renderedLegendMode = modeKey;
  const labelMap = {
    buyer: "Buyer",
    provider: "Provider",
    deal_type: "Deal type",
    certainty: "Certainty",
  };

  const colorBtns = currentLegendKeys.map(k => {
    const col = currentColorMap.get(k) ?? OTHER_COLOR;
    const text = state.colorBy === "deal_type" ? (LANE_LABEL.get(k) ?? k) : k;
    const on = state.colorFilter === k;
    return `<button type="button" class="leg-btn ${on ? "is-active" : ""}" aria-pressed="${on}" data-color-val="${esc(k)}"><i style="background:${col}"></i>${esc(text)}</button>`;
  }).join("");

  const sizeTicks = state.annualized ? [1, 5, 25] : [1, 10, 100];
  const sizeKey = sizeTicks.map(v => {
    const rad = Math.round(rScale(v));
    const dim = rad * 2 + 2;
    return `<span class="size-item"><svg width="${dim}" height="${dim}" aria-hidden="true"><circle cx="${rad + 1}" cy="${rad + 1}" r="${rad}" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>$${v}B${state.annualized ? "/yr" : ""}</span>`;
  }).join("");

  legendEl.innerHTML = `
    <div class="leg-row">
      <span class="leg-label">Color (${labelMap[state.colorBy]}):</span>
      ${colorBtns}
    </div>
    <div class="leg-row">
      <span class="leg-label">Data certainty:</span>
      <span class="leg-item">
        <svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5.5" fill="var(--mute)"/></svg>
        High (stated)
      </span>
      <span class="leg-item">
        <svg width="14" height="14" aria-hidden="true">
          <circle cx="7" cy="7" r="5.5" fill="var(--mute)"/>
          <circle cx="7" cy="7" r="5.5" fill="url(#pat-medium)"/>
        </svg>
        Medium (media)
      </span>
      <span class="leg-item">
        <svg width="14" height="14" aria-hidden="true">
          <circle cx="7" cy="7" r="5.5" fill="var(--mute)" stroke="var(--ink)" stroke-width="1.3" stroke-dasharray="2.5,2"/>
          <circle cx="7" cy="7" r="5.5" fill="url(#pat-low)"/>
        </svg>
        Low (non-binding)
      </span>
      <span class="leg-sep">|</span>
      <span class="leg-label">Flags:</span>
      <span class="leg-item">
        <svg width="18" height="18" aria-hidden="true">
          <circle cx="9" cy="9" r="7.5" fill="none" stroke="var(--ink)" stroke-width="1.4"/>
          <circle cx="9" cy="9" r="4.5" fill="var(--mute)"/>
        </svg>
        Circular (outer ring)
      </span>
      <span class="leg-item">
        <svg width="16" height="16" aria-hidden="true">
          <circle cx="8" cy="8" r="5.5" fill="var(--surface)" stroke="var(--mute)" stroke-width="2.2"/>
        </svg>
        Snapshot / backlog (hollow)
      </span>
      <span class="leg-item">
        <svg width="14" height="14" aria-hidden="true">
          <polygon points="7,1 13,7 7,13 1,7" fill="var(--mute)"/>
        </svg>
        No $ amount
      </span>
      <span class="leg-sep">|</span>
      <span class="leg-label">${state.annualized ? "Annual value:" : "Deal value:"}</span>
      ${sizeKey}
    </div>
  `;

  legendEl.querySelectorAll("[data-color-val]").forEach(btn => {
    btn.addEventListener("click", () => {
      const val = btn.dataset.colorVal;
      state.colorFilter = state.colorFilter === val ? null : val;
      syncUIAndPaint();
    });
  });
}

// ---- Headline & KPIs ----
function renderSummaryAndKPIs(activeDeals) {
  const binding = activeDeals.filter(d => d.isBinding && !d.isSnapshot);
  const totalB = d3.sum(binding, d => dealValueB(d) || 0);
  const circB = d3.sum(binding.filter(d => d.circular), d => dealValueB(d) || 0);
  const nonCircB = Math.max(0, totalB - circB);
  const circPct = totalB > 0 ? Math.round((circB / totalB) * 100) : 0;
  const unit = state.annualized ? "/yr" : "";

  const domain = state.brushDomain ?? fullDomain;
  const rangeTxt = state.brushDomain ? ` (${fmtMonth(domain[0])} – ${fmtMonth(domain[1])})` : "";
  headlineEl.textContent =
    `${binding.length} countable binding deals with a mixed-value subtotal of ${fmtMoney(totalB)}${unit} in view (${circPct}% circular) · ${activeDeals.length} total rows${rangeTxt}.`;

  kpisEl.innerHTML = `
    <div class="kpi">
      <small>In view</small>
      <strong>${activeDeals.length} <span>/ ${allDeals.length} rows</span></strong>
      <div class="kpi-sub">${binding.length} countable binding</div>
    </div>
    <div class="kpi kpi-wide">
      <small>Mixed-value subtotal${unit} · Circular vs. non-circular</small>
      <strong>${fmtMoney(totalB)}${unit} <span>(${fmtMoney(nonCircB)} excl. circular)</span></strong>
      <div class="comp-bar" title="Non-circular: ${fmtMoney(nonCircB)} · Circular: ${fmtMoney(circB)}">
        <span class="comp-noncirc" style="width:${100 - circPct}%"></span>
        <span class="comp-circ" style="width:${circPct}%"></span>
      </div>
      <div class="kpi-sub">Non-circular ${100 - circPct}% · Circular ${circPct}%</div>
    </div>
  `;
}

// ---- Entity lookup helper ----
function resolveEntity(name) {
  const n = norm(name);
  const alias = ENTITY_ALIASES[n] ?? n;
  return entityByNorm.get(alias) ?? null;
}

// ---- Details Inspector ----
function renderDetails(activeDeals) {
  const prevFocusParty = document.activeElement?.closest("#details")?.getAttribute("data-filter-party");
  const deal = dealById.get(state.selectedId);

  detailsEl.classList.toggle("is-open", Boolean(deal));

  if (!deal) {
    const largest = d3.greatest(activeDeals.filter(d => !d.isSnapshot), d => dealValueB(d) ?? -1);
    detailsEl.innerHTML = `
      <div class="empty-state">
        <h2>Deal Inspector</h2>
        <p class="muted">Select any mark on the timeline or row in the table to inspect parties, terms, expansions, and sources.</p>
        ${largest ? `<button type="button" class="btn" id="jump-largest">Inspect largest (${esc(largest.id)} · ${fmtMoney(dealValueB(largest))})</button>` : ""}
      </div>
    `;
    detailsEl.querySelector("#jump-largest")?.addEventListener("click", () => {
      state.selectedId = largest.id;
      syncUIAndPaint();
    });
    return;
  }

  const partyButtons = deal.parties.map(p => {
    const on = state.party === p;
    return `<button type="button" class="party-chip ${on ? "is-active" : ""}" aria-pressed="${on}" data-filter-party="${esc(p)}">${esc(p)}</button>`;
  }).join("");

  const focusParty = state.party || deal.primaryBuyer;
  const ent = resolveEntity(focusParty);
  let entityCard = "";
  if (ent) {
    const rels = (relationsByEntity.get(ent.id) || []).slice(0, 4);
    const valStr = ent.valuation_usd_m ? fmtMoney(+ent.valuation_usd_m / 1000) : "—";
    entityCard = `
      <div class="entity-box">
        <small>Entity profile · ${esc(ent.name)}</small>
        <div>${esc(ent.layer || ent.kind)} · Valuation: <strong>${valStr}</strong></div>
        ${rels.length ? `<div class="muted">${rels.map(r => `${esc(r.source)} ${esc(r.type.replace(/_/g, " "))} ${esc(r.target)}`).join(" · ")}</div>` : ""}
      </div>
    `;
  }

  const relatedIds = [
    ...(deal.expansionOf && dealById.has(deal.expansionOf) ? [{ id: deal.expansionOf, rel: "Expands" }] : []),
    ...deal.expansions.map(id => ({ id, rel: "Expanded by" })),
  ];
  const relatedHtml = relatedIds.length
    ? `<div><dt>Related deals</dt><dd class="party-chips">${relatedIds.map(r => `<button type="button" class="party-chip" data-jump-deal="${esc(r.id)}">${r.rel}: ${esc(r.id)}</button>`).join("")}</dd></div>`
    : "";

  const links = deal.sourceUrls.map(u => {
    const meta = sourceMetaByUrl.get(u);
    const label = meta?.title ? `${meta.outlet ? `${meta.outlet}: ` : ""}${meta.title}` : hostLabel(u);
    return `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
  }).join("<br/>");

  detailsEl.innerHTML = `
    <div class="details-head">
      <div>
        <h2>${esc(deal.id)}</h2>
        <span class="muted">${fmtDate(deal.date)} · ${esc(LANE_LABEL.get(deal.lane) ?? deal.deal_type)}</span>
      </div>
      <button type="button" class="btn-icon" id="close-details" aria-label="Close inspector">×</button>
    </div>
    <div class="badges">
      <span class="badge badge-${deal.certainty}">Certainty: ${deal.certainty}</span>
      <span class="badge">${esc(deal.status)}</span>
      ${deal.circular ? `<span class="badge badge-warn">Circular</span>` : ""}
      ${deal.isSnapshot ? `<span class="badge badge-warn">Snapshot</span>` : ""}
    </div>
    <dl class="details-list">
      <div><dt>Parties (click to filter)</dt><dd class="party-chips">${partyButtons || "—"}</dd></div>
      <div>
        <dt>Reported value</dt>
        <dd>
          <strong>${fmtMoney(deal.amountB)}</strong>
          ${deal.annualizedB != null ? ` (${fmtMoney(deal.annualizedB)}/yr)` : ""}
          ${deal.value_basis ? `<span class="muted">· ${esc(deal.value_basis.replace(/_/g, " "))}</span>` : ""}
        </dd>
      </div>
      <div>
        <dt>Capacity, Term &amp; Start</dt>
        <dd>
          ${deal.mwIt != null ? `${d3.format(",")(deal.mwIt)} MW IT` : "—"}
          ${deal.usdPerMwYear != null ? ` · $${d3.format(",.2f")(deal.usdPerMwYear / 1e6)}M/MW-yr` : ""}
          · ${deal.termYears != null ? `${deal.termYears} yrs` : "—"}
          ${deal.revenueStart ? ` · Online ${esc(deal.revenueStart)}` : ""}
        </dd>
      </div>
      ${relatedHtml}
      <div><dt>Sources</dt><dd>${links || "None"}</dd></div>
    </dl>
    ${entityCard}
    ${deal.conditions ? `<p class="details-note"><strong>Conditions:</strong> ${esc(deal.conditions)}</p>` : ""}
    ${deal.notes ? `<p class="details-note muted"><strong>Notes:</strong> ${esc(deal.notes)}</p>` : ""}
  `;

  detailsEl.querySelector("#close-details").addEventListener("click", () => {
    state.selectedId = null;
    syncUIAndPaint();
  });

  detailsEl.querySelectorAll("[data-filter-party]").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = btn.dataset.filterParty;
      state.party = state.party === p ? null : p;
      syncUIAndPaint();
    });
  });

  detailsEl.querySelectorAll("[data-jump-deal]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.selectedId = btn.dataset.jumpDeal;
      syncUIAndPaint();
    });
  });

  if (prevFocusParty) {
    detailsEl.querySelector(`[data-filter-party="${CSS.escape(prevFocusParty)}"]`)?.focus();
  }
}

// ---- Main Chart: Init, Layout, Rescale, Paint ----
function getDims() {
  const w = Math.max(240, state.width);
  const narrow = w < 640;
  const margin = { top: 26, right: 20, bottom: 34, left: narrow ? 14 : 154 };
  const targetH = embedded ? 650 : Math.round(window.innerHeight - 310);
  const height = narrow ? 620 : Math.max(580, Math.min(740, targetH));
  return {
    width: w,
    height,
    margin,
    narrow,
    innerW: w - margin.left - margin.right,
    innerH: height - margin.top - margin.bottom,
  };
}

function initMainChart() {
  chartEl.innerHTML = "";
  mainSvg = d3.select(chartEl)
    .append("svg")
    .attr("class", "timeline-svg")
    .attr("role", "group")
    .attr("aria-label", "AI compute deal timeline grouped by deal type");

  const defs = mainSvg.append("defs");
  defs.append("pattern")
    .attr("id", "pat-medium")
    .attr("width", 7).attr("height", 7)
    .attr("patternUnits", "userSpaceOnUse")
    .attr("patternTransform", "rotate(45)")
    .append("line")
    .attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 7)
    .attr("stroke", "var(--surface)").attr("stroke-width", 1.5).attr("stroke-opacity", 0.6);

  const lowPat = defs.append("pattern")
    .attr("id", "pat-low")
    .attr("width", 7).attr("height", 7)
    .attr("patternUnits", "userSpaceOnUse");
  lowPat.append("path")
    .attr("d", "M0,0 L7,7 M7,0 L0,7")
    .attr("stroke", "var(--surface)").attr("stroke-width", 1.2).attr("stroke-opacity", 0.65);

  mainG = mainSvg.append("g");
  lanesG = mainG.append("g").attr("class", "lanes");
  gridG = mainG.append("g").attr("class", "grid");
  xAxisG = mainG.append("g").attr("class", "axis axis-x");
  yAxisG = mainG.append("g").attr("class", "axis axis-y");
  linksG = mainG.append("g").attr("class", "expansion-links");
  nodesG = mainG.append("g").attr("class", "nodes");
  annG = mainG.append("g").attr("class", "annotations");
}

function layout(animate = true) {
  const { width, height, margin, narrow, innerW, innerH } = getDims();
  const domain = state.brushDomain ?? fullDomain;

  mainSvg.attr("width", width).attr("height", height);
  mainG.attr("transform", `translate(${margin.left},${margin.top})`);

  xScale = d3.scaleUtc().domain(domain).range([0, innerW]);
  yScale = d3.scaleBand().domain(LANES.map(l => l.key)).range([0, innerH]).padding(narrow ? 0.24 : 0.16);

  lanesG.selectAll("rect.lane")
    .data(LANES, d => d.key)
    .join("rect")
    .attr("class", d => `lane ${d.key === "snapshot" ? "lane-snapshot" : ""}`)
    .attr("x", 0)
    .attr("y", d => yScale(d.key))
    .attr("width", innerW)
    .attr("height", yScale.bandwidth())
    .attr("rx", 4);

  lanesG.selectAll("text.inline-lane-label")
    .data(narrow ? LANES : [], d => d.key)
    .join("text")
    .attr("class", "inline-lane-label")
    .attr("x", 6)
    .attr("y", d => yScale(d.key) - 4)
    .text(d => d.label);

  const tickCount = Math.max(4, Math.floor(innerW / 115));
  gridG.attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).ticks(tickCount).tickSize(-innerH).tickFormat(""));
  xAxisG.attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).ticks(tickCount).tickFormat(fmtMonth));
  yAxisG.style("display", narrow ? "none" : null)
    .call(d3.axisLeft(yScale).tickSize(0).tickFormat(k => LANE_LABEL.get(k) ?? k));

  const inWindow = allDeals.filter(d => d.date >= domain[0] && d.date <= domain[1]);

  inWindow.forEach(d => {
    d.x = xScale(d.date);
    d.y = yScale(d.lane) + yScale.bandwidth() / 2;
  });

  const sim = d3.forceSimulation(inWindow)
    .force("x", d3.forceX(d => xScale(d.date)).strength(0.95))
    .force("y", d3.forceY(d => yScale(d.lane) + yScale.bandwidth() / 2).strength(0.22))
    .force("collide", d3.forceCollide(d => d.radius + (d.circular ? 3 : 0) + 2.5))
    .stop();

  for (let i = 0; i < 120; i++) {
    sim.tick();
    for (const d of inWindow) {
      const pad = d.radius + (d.circular ? 3 : 0) + 1;
      const top = yScale(d.lane) + Math.min(pad, yScale.bandwidth() / 2);
      const bot = yScale(d.lane) + yScale.bandwidth() - Math.min(pad, yScale.bandwidth() / 2);
      d.y = Math.max(top, Math.min(bot, d.y));
    }
  }

  const sel = nodesG.selectAll("g.node").data(inWindow, d => d.id);
  sel.exit().transition().duration(animate ? dur(180) : 0).attr("opacity", 0).remove();

  const enter = sel.enter()
    .append("g")
    .attr("class", d => `node certainty-${d.certainty} ${d.isSnapshot ? "is-snapshot" : ""} ${d.isSuperseded ? "is-superseded" : ""}`)
    .attr("transform", d => `translate(${d.x},${d.y})`)
    .attr("role", "button")
    .on("pointerenter pointermove", (event, d) => {
      if (matchesFilters(d)) showTooltip(event.pageX, event.pageY, d);
    })
    .on("pointerleave", hideTooltip)
    .on("focus", (event, d) => {
      const rect = event.currentTarget.getBoundingClientRect();
      showTooltip(rect.left + window.scrollX, rect.top + window.scrollY, d);
    })
    .on("blur", hideTooltip)
    .on("click", (_, d) => {
      if (!matchesFilters(d)) return;
      state.selectedId = state.selectedId === d.id ? null : d.id;
      state.focusedId = d.id;
      syncUIAndPaint();
    })
    .on("keydown", handleNodeKeydown);

  enter.filter(d => d.circular).append("circle").attr("class", "circ-ring");
  enter.append("path").attr("class", "mark-base");
  enter.filter(d => d.certainty !== "high" && !d.isSnapshot).append("path").attr("class", "mark-pat").attr("pointer-events", "none");
  enter.filter(d => d.isSuperseded).append("line").attr("class", "superseded-strike").attr("pointer-events", "none");

  const merged = enter.merge(sel);
  (animate ? merged.transition().duration(dur(250)) : merged)
    .attr("transform", d => `translate(${d.x},${d.y})`);

  merged.each(function (d) {
    const g = d3.select(this);
    const val = dealValueB(d);
    const hasVal = val != null;
    const shapePath = hasVal
      ? d3.symbol().type(d3.symbolCircle).size(Math.PI * d.radius * d.radius)()
      : d3.symbol().type(d3.symbolDiamond).size(105)();

    g.attr("aria-label", `${d.id}, ${fmtDate(d.date)}, ${fmtMoney(val)}${state.annualized ? " per year" : ""}, ${d.status}, certainty ${d.certainty}`);
    g.select(".circ-ring").attr("r", d.radius + 3);
    g.select(".mark-base")
      .attr("d", shapePath)
      .attr("fill", d.isSnapshot ? "var(--surface)" : d.color)
      .attr("stroke", d.color);

    g.select(".mark-pat")
      .attr("d", hasVal ? shapePath : null)
      .attr("fill", d.certainty === "medium" ? "url(#pat-medium)" : "url(#pat-low)");

    g.select(".superseded-strike")
      .attr("x1", -d.radius - 2).attr("y1", -d.radius - 2)
      .attr("x2", d.radius + 2).attr("y2", d.radius + 2);
  });

  paint();
}

function rescaleXOnly(domain) {
  const { innerW, innerH } = getDims();
  xScale.domain(domain);
  const tickCount = Math.max(4, Math.floor(innerW / 115));
  gridG.call(d3.axisBottom(xScale).ticks(tickCount).tickSize(-innerH).tickFormat(""));
  xAxisG.call(d3.axisBottom(xScale).ticks(tickCount).tickFormat(fmtMonth));

  nodesG.selectAll("g.node").attr("transform", d => `translate(${xScale(d.date)},${d.y})`);
  drawExpansionLinks(true);
  renderAnnotations(true);
}

function drawExpansionLinks(useScaleX = false) {
  const pairs = [];
  if (state.selectedId && dealById.has(state.selectedId)) {
    const sel = dealById.get(state.selectedId);
    const domain = state.brushDomain ?? fullDomain;
    const inView = d => d && d.date >= domain[0] && d.date <= domain[1];
    if (sel.expansionOf && inView(dealById.get(sel.expansionOf)) && inView(sel)) {
      pairs.push([dealById.get(sel.expansionOf), sel]);
    }
    sel.expansions.forEach(cid => {
      const c = dealById.get(cid);
      if (inView(c) && inView(sel)) pairs.push([sel, c]);
    });
  }

  linksG.selectAll("path.exp-link")
    .data(pairs, ([a, b]) => `${a.id}-${b.id}`)
    .join("path")
    .attr("class", "exp-link")
    .attr("d", ([a, b]) => {
      const x1 = useScaleX ? xScale(a.date) : a.x;
      const x2 = useScaleX ? xScale(b.date) : b.x;
      const mx = (x1 + x2) / 2;
      const my = Math.min(a.y, b.y) - 24;
      return `M${x1},${a.y} Q${mx},${my} ${x2},${b.y}`;
    });
}

function renderAnnotations(useScaleX = false) {
  const { innerW } = getDims();
  const domain = state.brushDomain ?? fullDomain;
  const inWindow = allDeals.filter(d => d.date >= domain[0] && d.date <= domain[1]);

  let labelDeals = [];
  if (state.selectedId && dealById.has(state.selectedId)) {
    const sel = dealById.get(state.selectedId);
    if (sel.date >= domain[0] && sel.date <= domain[1]) {
      labelDeals = [sel];
    }
  } else {
    labelDeals = inWindow
      .filter(d => !d.isSnapshot && !d.isSuperseded && dealValueB(d) != null && matchesFilters(d))
      .sort((a, b) => dealValueB(b) - dealValueB(a))
      .slice(0, 4);
  }

  annG.selectAll("text.deal-ann")
    .data(labelDeals, d => d.id)
    .join("text")
    .attr("class", "deal-ann")
    .attr("text-anchor", "middle")
    .text(d => {
      const val = dealValueB(d);
      const valTxt = val != null ? `${fmtMoney(val)}${state.annualized ? "/yr" : ""}` : "Undisclosed";
      return `${d.primaryBuyer} ${valTxt}`;
    })
    .attr("x", d => {
      const px = useScaleX ? xScale(d.date) : d.x;
      return Math.max(54, Math.min(innerW - 54, px));
    })
    .attr("y", d => d.y - d.radius - (d.circular ? 6 : 4));
}

function paint() {
  const activeDeals = allDeals.filter(matchesFilters);
  const activeIds = new Set(activeDeals.map(d => d.id));
  const hasSelection = state.selectedId != null;

  if (!state.focusedId || !activeIds.has(state.focusedId)) {
    state.focusedId = activeDeals[0]?.id ?? null;
  }

  nodesG.selectAll("g.node")
    .each(function (d) {
      const active = activeIds.has(d.id);
      const g = d3.select(this);
      g.classed("is-ghost", state.ghost && !active)
       .classed("is-hidden", !state.ghost && !active)
       .classed("is-selected", d.id === state.selectedId)
       .classed("is-dimmed", hasSelection && d.id !== state.selectedId && active)
       .attr("aria-hidden", active ? null : "true")
       .attr("tabindex", active && d.id === state.focusedId ? 0 : -1);

      g.select(".mark-base")
        .attr("fill", d.isSnapshot ? "var(--surface)" : d.color)
        .attr("stroke", d.color);
    });

  drawExpansionLinks(false);
  renderAnnotations(false);

  if (state.party) {
    partyPillEl.innerHTML = `<button type="button" class="pill" id="clear-party">Party: ${esc(state.party)} ×</button>`;
    partyPillEl.querySelector("#clear-party").addEventListener("click", () => {
      state.party = null;
      syncUIAndPaint();
    });
  } else {
    partyPillEl.innerHTML = "";
  }

  const domain = state.brushDomain ?? fullDomain;
  dateFromInput.value = fmtDate(domain[0]);
  dateToInput.value = fmtDate(domain[1]);

  renderSummaryAndKPIs(activeDeals);
  renderDetails(activeDeals);
  if (state.view === "table") renderTable(activeDeals);
  if (state.view === "context") renderContextPanel();
}

function syncUIAndPaint() {
  colorBySelect.value = state.colorBy;
  certaintySelect.value = state.certainty;
  bindingCheckbox.checked = state.bindingOnly;
  circularCheckbox.checked = state.circularOnly;
  annualizedCheckbox.checked = state.annualized;
  hideSupersededCheckbox.checked = state.hideSuperseded;
  ghostCheckbox.checked = state.ghost;

  viewBtns.forEach(b => {
    const active = b.dataset.view === state.view;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  });
  containerEl.dataset.dealsView = state.view;
  vizFrameEl.hidden = state.view !== "timeline";
  tableFrameEl.hidden = state.view !== "table";
  contextFrameEl.hidden = state.view !== "context";

  updateScalesAndColors();
  renderLegend();
  paint();
  writeHash();
}

// ---- Keyboard Navigation ----
function handleNodeKeydown(event, d) {
  const activeNodes = nodesG.selectAll("g.node").filter(n => matchesFilters(n)).nodes();
  const idx = activeNodes.indexOf(event.currentTarget);

  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    event.preventDefault();
    const next = activeNodes[(idx + 1) % activeNodes.length];
    if (next) {
      state.focusedId = d3.select(next).datum().id;
      paint();
      next.focus();
    }
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    event.preventDefault();
    const prev = activeNodes[(idx - 1 + activeNodes.length) % activeNodes.length];
    if (prev) {
      state.focusedId = d3.select(prev).datum().id;
      paint();
      prev.focus();
    }
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    state.selectedId = state.selectedId === d.id ? null : d.id;
    syncUIAndPaint();
  } else if (event.key === "Escape") {
    state.selectedId = null;
    syncUIAndPaint();
  }
}

// ---- Overview Strip ----
function renderOverview() {
  overviewEl.innerHTML = "";
  const { width, margin, innerW } = getDims();
  const height = 72;
  const ovMargin = { top: 14, right: margin.right, bottom: 22, left: margin.left };
  const innerH = height - ovMargin.top - ovMargin.bottom;

  const svg = d3.select(overviewEl)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("class", "overview-svg")
    .attr("aria-label", "Monthly deal volume overview and date brush");

  const g = svg.append("g").attr("transform", `translate(${ovMargin.left},${ovMargin.top})`);
  ovX = d3.scaleUtc().domain(fullDomain).range([0, innerW]);

  const months = d3.utcMonths(fullDomain[0], fullDomain[1]);
  const byMonth = months.map(m => {
    const next = d3.utcMonth.offset(m, 1);
    const slice = allDeals.filter(d => d.date >= m && d.date < next && !d.isSnapshot && !d.isSuperseded);
    return {
      month: m,
      binding: d3.sum(slice.filter(d => d.isBinding), d => d.amountB || 0),
      nonBinding: d3.sum(slice.filter(d => !d.isBinding), d => d.amountB || 0),
    };
  });

  const maxVol = d3.max(byMonth, d => d.binding + d.nonBinding) || 1;
  const ovY = d3.scaleLinear().domain([0, maxVol]).range([innerH, 0]);
  const barW = Math.max(2, innerW / Math.max(1, months.length) - 2);

  g.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(ovX).ticks(Math.max(4, Math.floor(innerW / 115))).tickFormat(fmtMonth));

  const stack = d3.stack().keys(["binding", "nonBinding"])(byMonth);
  const colors = { binding: "#0072B2", nonBinding: "#9ca3af" };

  g.selectAll("g.ov-layer")
    .data(stack)
    .join("g")
    .attr("fill", d => colors[d.key])
    .attr("fill-opacity", 0.65)
    .selectAll("rect")
    .data(layer => layer)
    .join("rect")
    .attr("x", d => ovX(d.data.month))
    .attr("y", d => ovY(d[1]))
    .attr("height", d => Math.max(0, ovY(d[0]) - ovY(d[1])))
    .attr("width", barW);

  const q1Start = new Date(Date.UTC(2026, 0, 1));
  const q1End = new Date(Date.UTC(2026, 3, 1));
  const q1Binding = allDeals.filter(d => d.isBinding && !d.isSnapshot && d.date >= q1Start && d.date < q1End).length;
  if (q1Start >= fullDomain[0] && q1End <= fullDomain[1] && q1Binding === 0) {
    const midX = (ovX(q1Start) + ovX(q1End)) / 2;
    g.append("text")
      .attr("class", "gap-ann")
      .attr("x", midX)
      .attr("y", -3)
      .attr("text-anchor", "middle")
      .text("No Q1 '26 binding deals");
  }

  ovBrush = d3.brushX()
    .extent([[0, 0], [innerW, innerH]])
    .on("brush", ({ selection }) => {
      if (isSyncingBrush) return;
      const dom = selection ? selection.map(ovX.invert) : fullDomain;
      rescaleXOnly(dom);
    })
    .on("end", ({ selection }) => {
      if (isSyncingBrush) return;
      state.brushDomain = selection ? selection.map(ovX.invert) : null;
      presetBtns.forEach(b => b.classList.toggle("active", !state.brushDomain && b.dataset.preset === "all"));
      layout(true);
      writeHash();
    });

  ovBrushG = g.append("g").attr("class", "brush").call(ovBrush);
  if (state.brushDomain) {
    isSyncingBrush = true;
    ovBrushG.call(ovBrush.move, state.brushDomain.map(ovX));
    isSyncingBrush = false;
  }
}

// ---- Sortable Table View ----
function renderTable(activeDeals) {
  const cols = [
    { key: "date", label: "Date", get: d => d.date },
    { key: "id", label: "Deal ID", get: d => d.id },
    { key: "lane", label: "Type", get: d => LANE_LABEL.get(d.lane) ?? d.deal_type },
    { key: "parties", label: "Parties", get: d => d.parties.join(", ") },
    { key: "amount", label: state.annualized ? "$/yr" : "Amount", get: d => dealValueB(d) ?? -1, num: true },
    { key: "term", label: "Term", get: d => d.termYears ?? -1, num: true },
    { key: "certainty", label: "Certainty", get: d => d.certainty },
    { key: "status", label: "Status", get: d => d.status },
  ];

  const col = cols.find(c => c.key === state.sortCol) ?? cols[0];
  const dir = state.sortDir === "asc" ? 1 : -1;
  const sorted = [...activeDeals].sort((a, b) => {
    const va = col.get(a), vb = col.get(b);
    return va < vb ? -dir : va > vb ? dir : 0;
  });

  tableFrameEl.innerHTML = `
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            ${cols.map(c => {
              const active = c.key === state.sortCol;
              const arrow = active ? (state.sortDir === "asc" ? " ▲" : " ▼") : "";
              return `<th class="${c.num ? "num" : ""}"><button type="button" class="sort-btn" data-sort="${c.key}">${c.label}${arrow}</button></th>`;
            }).join("")}
          </tr>
        </thead>
        <tbody>
          ${sorted.map(d => `
            <tr class="${d.id === state.selectedId ? "is-selected" : ""}" data-row-id="${esc(d.id)}" tabindex="0">
              <td class="mono">${fmtDate(d.date)}</td>
              <td class="mono">${esc(d.id)}</td>
              <td>${esc(LANE_LABEL.get(d.lane) ?? d.deal_type)}</td>
              <td>${esc(d.parties.slice(0, 3).join(", "))}</td>
              <td class="num">${fmtMoney(dealValueB(d))}${state.annualized && dealValueB(d) != null ? "/yr" : ""}</td>
              <td class="num">${d.termYears != null ? `${d.termYears}y` : "—"}</td>
              <td><span class="badge badge-${d.certainty}">${d.certainty}</span></td>
              <td>${esc(d.status)}${d.circular ? " · circular" : ""}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  tableFrameEl.querySelectorAll("[data-sort]").forEach(btn => {
    btn.addEventListener("click", () => {
      const k = btn.dataset.sort;
      if (state.sortCol === k) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortCol = k; state.sortDir = k === "amount" || k === "date" ? "desc" : "asc"; }
      renderTable(activeDeals);
    });
  });

  tableFrameEl.querySelectorAll("tr[data-row-id]").forEach(tr => {
    const select = () => {
      state.selectedId = tr.dataset.rowId;
      syncUIAndPaint();
    };
    tr.addEventListener("click", select);
    tr.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); }
    });
  });
}

// ---- Compute commitments and revenue ----
function renderContextPanel() {
  const latestByLab = new Map();
  revenueRows.forEach(r => latestByLab.set(r.company, r));

  const rows = [...latestByLab.values()].map(r => {
    const deals = allDeals.filter(d => !d.isSuperseded && d.buyers.some(b => norm(b) === norm(r.company)));
    const bindingSum = d3.sum(deals.filter(d => d.isBinding && !d.isSnapshot), d => d.amountB || 0);
    const snapshotMax = d3.max(deals.filter(d => d.isSnapshot), d => d.amountB || 0) || 0;
    const refCommit = Math.max(bindingSum, snapshotMax);
    return { ...r, bindingSum, snapshotMax, ratio: r.annualizedB > 0 && refCommit > 0 ? refCommit / r.annualizedB : null };
  }).filter(r => r.bindingSum > 0 || r.snapshotMax > 0)
    .sort((a, b) => (b.bindingSum + b.snapshotMax) - (a.bindingSum + a.snapshotMax));

  if (!rows.length) {
    revenueTableEl.innerHTML = `<p class="muted">No matched commitments and revenue reports are available.</p>`;
    return;
  }

  revenueTableEl.innerHTML = `
    <table class="data-table commitments-table">
      <thead><tr><th scope="col">Lab</th><th class="num" scope="col">Annualized revenue</th><th scope="col">Revenue date (confidence)</th><th class="num" scope="col">Binding total</th><th class="num" scope="col">Largest snapshot</th><th class="num" scope="col">Scale ratio</th></tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <th scope="row">${esc(r.company)}</th>
            <td class="num">${fmtMoney(r.annualizedB)}</td>
            <td class="muted">${fmtDate(r.date)} (${esc(r.confidence)})</td>
            <td class="num">${r.bindingSum ? fmtMoney(r.bindingSum) : "—"}</td>
            <td class="num">${r.snapshotMax ? fmtMoney(r.snapshotMax) : "—"}</td>
            <td class="num">${r.ratio != null ? `${r.ratio.toFixed(1)}×` : "—"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

// ---- Exports ----
copyLinkBtn.addEventListener("click", async () => {
  writeHash();
  try {
    await navigator.clipboard.writeText(location.href);
    copyLinkBtn.textContent = "Copied!";
    setTimeout(() => { copyLinkBtn.textContent = "Copy link"; }, 1400);
  } catch {
    copyLinkBtn.textContent = "Hash updated";
    setTimeout(() => { copyLinkBtn.textContent = "Copy link"; }, 1400);
  }
});

exportCsvBtn.addEventListener("click", () => {
  const filtered = allDeals.filter(matchesFilters);
  const cols = ["id", "announced", "deal_type", "status", "certainty", "amount_usd", "term_years", "value_basis", "circular", "buyers", "providers", "financiers", "sources"];
  const csv = d3.csvFormat(filtered, cols);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ai-compute-deals-filtered.csv";
  a.click();
  URL.revokeObjectURL(a.href);
});

exportPngBtn.addEventListener("click", () => {
  if (!mainSvg) return;
  const svgNode = mainSvg.node();
  const clone = svgNode.cloneNode(true);
  const cs = getComputedStyle(document.documentElement);
  const bg = cs.getPropertyValue("--surface").trim() || "#ffffff";
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const w = +svgNode.getAttribute("width");
  const h = +svgNode.getAttribute("height");
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = w * 2;
    canvas.height = h * 2;
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0);
    const a = document.createElement("a");
    a.download = "ai-compute-timeline.png";
    a.href = canvas.toDataURL("image/png");
    a.click();
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
});

// ---- Wire Controls ----
viewBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    state.view = btn.dataset.view;
    syncUIAndPaint();
    if (state.view === "timeline") layout(false);
  });
});

colorBySelect.addEventListener("change", () => {
  state.colorBy = colorBySelect.value;
  state.colorFilter = null;
  syncUIAndPaint();
});
certaintySelect.addEventListener("change", () => { state.certainty = certaintySelect.value; syncUIAndPaint(); });
bindingCheckbox.addEventListener("change", () => { state.bindingOnly = bindingCheckbox.checked; syncUIAndPaint(); });
circularCheckbox.addEventListener("change", () => { state.circularOnly = circularCheckbox.checked; syncUIAndPaint(); });
hideSupersededCheckbox.addEventListener("change", () => { state.hideSuperseded = hideSupersededCheckbox.checked; syncUIAndPaint(); });
ghostCheckbox.addEventListener("change", () => { state.ghost = ghostCheckbox.checked; syncUIAndPaint(); });
annualizedCheckbox.addEventListener("change", () => {
  state.annualized = annualizedCheckbox.checked;
  syncUIAndPaint();
  layout(true);
});

function applyDateInputs() {
  const from = parseDate(dateFromInput.value);
  const to = parseDate(dateToInput.value);
  if (!from || !to || from >= to) return;
  const clamped = [
    d3.max([fullDomain[0], from]),
    d3.min([fullDomain[1], to]),
  ];
  state.brushDomain = clamped;
  isSyncingBrush = true;
  ovBrushG?.call(ovBrush.move, clamped.map(ovX));
  isSyncingBrush = false;
  layout(true);
  writeHash();
}
dateFromInput.addEventListener("change", applyDateInputs);
dateToInput.addEventListener("change", applyDateInputs);

presetBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const p = btn.dataset.preset;
    presetBtns.forEach(b => b.classList.toggle("active", b === btn));
    if (p === "all") {
      state.brushDomain = null;
      isSyncingBrush = true;
      ovBrushG.call(ovBrush.move, null);
      isSyncingBrush = false;
    } else {
      const end = fullDomain[1];
      const monthsBack = p === "3m" ? -3 : p === "6m" ? -6 : -12;
      const start = d3.max([fullDomain[0], d3.utcMonth.offset(end, monthsBack)]);
      state.brushDomain = [start, end];
      isSyncingBrush = true;
      ovBrushG.call(ovBrush.move, state.brushDomain.map(ovX));
      isSyncingBrush = false;
    }
    layout(true);
    writeHash();
  });
});

resetBtn.addEventListener("click", () => {
  Object.assign(state, {
    colorBy: "buyer",
    certainty: "all",
    bindingOnly: false,
    circularOnly: false,
    annualized: false,
    hideSuperseded: true,
    ghost: true,
    party: null,
    colorFilter: null,
    selectedId: null,
    brushDomain: null,
  });
  presetBtns.forEach(b => b.classList.toggle("active", b.dataset.preset === "all"));
  isSyncingBrush = true;
  ovBrushG?.call(ovBrush.move, null);
  isSyncingBrush = false;
  syncUIAndPaint();
  layout(true);
});

document.addEventListener("click", e => {
  if (helpPopEl.open && !helpPopEl.contains(e.target)) helpPopEl.open = false;
});
window.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (helpPopEl.open) helpPopEl.open = false;
    else if (state.selectedId) { state.selectedId = null; syncUIAndPaint(); }
  }
});

// Responsive ResizeObserver + window height resize
const ro = new ResizeObserver(entries => {
  const newW = Math.floor(entries[0].contentRect.width);
  if (newW > 0 && Math.abs(newW - state.width) > 10 && allDeals.length) {
    state.width = newW;
    renderOverview();
    layout(false);
  }
});

window.addEventListener("resize", () => {
  if (!embedded && allDeals.length && state.view === "timeline") layout(false);
});

// ---- Boot ----
readHash();
loadAllData()
  .then(deals => {
    allDeals = deals;
    const [minD, maxD] = d3.extent(allDeals, d => d.date);
    fullDomain = [d3.utcMonth.offset(minD, -1), d3.utcMonth.offset(maxD, 1)];
    state.width = Math.max(240, Math.floor(vizFrameEl.clientWidth) - 20);

    initMainChart();
    syncUIAndPaint();
    renderOverview();
    layout(false);
    ro.observe(vizFrameEl);
  })
  .catch(err => {
    console.error(err);
    headlineEl.textContent = err.message;
  });
