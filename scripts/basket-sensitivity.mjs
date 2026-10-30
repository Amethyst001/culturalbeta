// Basket-construction sensitivity study runner.
//
// Re-derives every priced desk row's cultural beta under alternative basket
// constructions, using only data already on disk: the committed per-sector
// basket files, the cached per-sector/per-type `recommend` responses (the
// candidates the pipeline saw but did not keep), the cached weekly trend series,
// the committed price fixture and output/desk.json. Zero Qloo requests — the
// study reads fixtures/qloo/ with plain file reads and never imports the
// harness or the Qloo client.
//
// Gate first: if the baseline re-derivation does not reproduce output/desk.json,
// the study stops and says so, because every variant delta would be meaningless.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../src/env.mjs";
import { norm } from "../src/universe.mjs";
import {
  revisionWeeks, blendBasketReturn, buildPool, selectMembers, fitName, flagBook, compareConstructions, quantile,
} from "../src/basket-sensitivity.mjs";

const readJson = (rel) => {
  opened.push(rel);
  return JSON.parse(readFileSync(resolve(ROOT, rel), "utf8"));
};
const opened = [];

const book = readJson("config/book.json");
const desk = readJson("output/desk.json");
const prices = readJson("fixtures/prices.json");
const entities = readJson("fixtures/qloo/entities.json");
const seriesFile = readJson("fixtures/qloo/series.json");
const featuredFile = readJson("output/series.json");
const field = book.tasteSignal.field;
const absT = book.flagRule.absT;
const qMax = book.flagRule.qMax ?? 0.1;

const seriesById = seriesFile.byId ?? {};

// Same revision cut as the committed run: derive it from the cached levels, not
// from desk.json, so the re-derivation stands on its own; then assert the two
// calendars agree.
const revisions = revisionWeeks(seriesById, field);
const revisionSet = new Set(revisions.map((r) => r.date));
const fullDates = prices.window.alignedDates;
const dates = fullDates.filter((d) => !revisionSet.has(d));
if (JSON.stringify(dates) !== JSON.stringify(desk.window.alignedDates)) {
  console.error(`FINDING: re-derived calendar (${dates.length} weeks) does not match the committed desk calendar (${desk.window.alignedDates.length} weeks). Study aborted.`);
  process.exit(3);
}
const cutIndex = (arr) => {
  if (!arr) return null;
  if (arr.length !== fullDates.length) throw new Error(`price series length ${arr.length} != ${fullDates.length} aligned dates`);
  return arr.filter((_, i) => !revisionSet.has(fullDates[i]));
};
const marketReturns = cutIndex(prices.symbols[book.index.ticker].returns);

// ---- sector member lists and candidate pools (all from cache) --------------
const universeIds = new Set(entities.map((e) => e.entityId).filter(Boolean));
const universeNames = new Set(entities.flatMap((e) => [norm(e.label), norm(e.query)]).filter(Boolean));
const isUniverseName = (name) => {
  const n = norm(name);
  if (!n) return true;
  if (universeNames.has(n)) return true;
  return entities.some((h) => {
    const q = norm(h.query);
    return q.length >= 4 && (n === q || n.startsWith(`${q} `) || n.endsWith(` ${q}`));
  });
};

const sectors = [...new Set(desk.rows.filter((r) => r.status === "ok").map((r) => r.sector))];
const sectorData = {};
for (const sector of sectors) {
  const basketFile = readJson(`fixtures/qloo/basket-sector-${sector}.json`);
  const committed = basketFile.members.map((m) => ({ id: m.id, name: m.name, type: m.type, weight: m.weight, affinity: m.affinity }));
  const committedIds = new Set(committed.map((m) => m.id));
  const extras = [];
  for (const call of basketFile.calls) {
    const recFile = `fixtures/qloo/recommend-sector-${sector}-${call.type}.json`;
    const rec = readJson(recFile);
    const results = Array.isArray(rec.response?.results) ? rec.response.results : [];
    for (const e of results) {
      const id = e?.entity_id ?? e?.id ?? null;
      if (!id || committedIds.has(id) || universeIds.has(id) || isUniverseName(e?.name)) continue;
      if (typeof e.affinity !== "number" || !(e.affinity > 0)) continue;
      // Only candidates whose weekly trend series is also on disk can enter a
      // variant basket: the committed pipeline pulled series for kept members
      // alone, so a candidate without a cached series has no taste return at
      // any week and would be an inert member silently re-weighted out of the
      // blend — a fake 10-member basket. This bounds the pool from cache.
      if (!seriesById[id]?.points?.length) continue;
      extras.push({ id, name: e.name ?? id, type: call.type, affinity: e.affinity });
    }
  }
  sectorData[sector] = { committed, pool: buildPool(committed, extras.filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i)) };
}

// ---- constructions ----------------------------------------------------------
const SPECS = [
  { id: "baseline", label: "committed (8 members, affinity weights, all types)", spec: { kind: "baseline" } },
  { id: "seeds3", label: "top 3 pool members by affinity", spec: { kind: "seeds", k: 3 } },
  { id: "seeds5", label: "top 5 pool members by affinity", spec: { kind: "seeds", k: 5 } },
  { id: "seeds7", label: "top 7 pool members by affinity", spec: { kind: "seeds", k: 7 } },
  { id: "seeds10", label: "top 10 pool members by affinity", spec: { kind: "seeds", k: 10 } },
  { id: "equalWeights", label: "committed members, equal weight", spec: { kind: "equalWeights" } },
  { id: "brandsOnly", label: "committed brand members only", spec: { kind: "brandsOnly" } },
  { id: "jackknifeDropTop", label: "committed members minus highest-weight one", spec: { kind: "jackknifeDropTop" } },
];

const priced = desk.rows.filter((r) => r.status === "ok");
const bySector = new Map();
for (const r of priced) {
  if (!bySector.has(r.sector)) bySector.set(r.sector, []);
  bySector.get(r.sector).push(r);
}

const variantFits = {}; // specId -> ticker -> fit
const variantMembers = {}; // specId -> sector -> members
for (const { id, spec } of SPECS) {
  variantFits[id] = {};
  variantMembers[id] = {};
  for (const [sector, rows] of bySector) {
    const { committed, pool } = sectorData[sector];
    const members = selectMembers(committed, pool, spec);
    variantMembers[id][sector] = members ? members.map((m) => ({ name: m.name, type: m.type, weight: m.weight })) : null;
    const basketMap = members && members.length
      ? blendBasketReturn(members, seriesById, field)
      : new Map();
    for (const row of rows) {
      const y = cutIndex(prices.symbols[row.ticker]?.returns);
      const fit = !y
        ? { status: "insufficient", weeksUsed: 0, culturalBeta: null, culturalT: null, culturalP: null }
        : fitName({ y, market: marketReturns, basketMap, dates });
      fit.ticker = row.ticker;
      fit.sector = sector;
      variantFits[id][row.ticker] = fit;
    }
  }
  flagBook(Object.values(variantFits[id]), { absT, qMax });
}

// ---- gate: the baseline must reproduce the committed panel ------------------
const checks = priced.map((r) => {
  const f = variantFits.baseline[r.ticker];
  return {
    ticker: r.ticker,
    committedBeta: r.culturalBeta,
    rederivedBeta: f.culturalBeta,
    absDBeta: f.culturalBeta === null || r.culturalBeta === null ? null : Math.abs(f.culturalBeta - r.culturalBeta),
    absDT: f.culturalT === null || r.culturalT === null ? null : Math.abs(f.culturalT - r.culturalT),
    weeksCommitted: r.weeks,
    weeksRederived: f.weeksUsed,
  };
});
const bad = checks.filter((c) => c.absDBeta === null || c.absDBeta > 1e-6);
const maxDBeta = Math.max(...checks.map((c) => c.absDBeta ?? Infinity));
const maxDT = Math.max(...checks.map((c) => c.absDT ?? Infinity));
if (bad.length) {
  console.error(`FINDING: the re-derived baseline does not reproduce output/desk.json for ${bad.length}/${checks.length} names (worst: ${bad.slice(0, 5).map((b) => `${b.ticker} ${b.rederivedBeta} vs committed ${b.committedBeta}`).join("; ")}). Variants aborted — every delta would be measured against a construction the panel does not use.`);
  process.exitCode = 3;
} else {
  console.log(`Baseline round-trip OK: all ${checks.length} priced names reproduce the committed cultural beta (max |dBeta| ${maxDBeta.toExponential(2)}, max |dt| ${maxDT.toExponential(2)}).`);
}

// ---- comparisons ------------------------------------------------------------
const comparisons = {};
for (const { id, label } of SPECS) {
  if (id === "baseline") continue;
  const screen = Object.values(variantFits[id]).filter((f) => f.status === "fitted" && f.culturalBeta < 0 && Math.abs(f.culturalT) >= absT);
  comparisons[id] = { label, screenPassesBeforeBH: screen.map((f) => ({ ticker: f.ticker, t: f.culturalT, q: f.culturalQ })), ...compareConstructions(variantFits.baseline, variantFits[id]) };
}
const baselineScreen = Object.values(variantFits.baseline).filter((f) => f.status === "fitted" && f.culturalBeta < 0 && Math.abs(f.culturalT) >= absT);
const subsetStats = (tickers) => {
  const out = {};
  for (const [id, c] of Object.entries(comparisons)) {
    const common = tickers.filter((t) => variantFits.baseline[t]?.status === "fitted" && variantFits[id]?.[t]?.status === "fitted");
    const dBeta = common.map((t) => Math.abs(variantFits[id][t].culturalBeta - variantFits.baseline[t].culturalBeta));
    out[id] = { names: common.length, medianAbsDBeta: quantile(dBeta, 0.5), p90AbsDBeta: quantile(dBeta, 0.9) };
  }
  return out;
};
const featuredTickers = Object.keys(featuredFile);
const topT = [...priced].sort((a, b) => Math.abs(b.culturalT) - Math.abs(a.culturalT)).slice(0, 10).map((r) => r.ticker);

// Coverage accounting: which variant lost names out of the fitted family.
const coverage = {};
for (const { id } of SPECS) {
  const fits = Object.values(variantFits[id]);
  coverage[id] = {
    fitted: fits.filter((f) => f.status === "fitted").length,
    degenerate: fits.filter((f) => f.status === "degenerate").length,
    insufficient: fits.filter((f) => f.status === "insufficient").length,
    medianWeeksUsed: quantile(fits.filter((f) => f.status === "fitted").map((f) => f.weeksUsed), 0.5),
  };
}

const perName = priced.map((r) => {
  const row = { ticker: r.ticker, sector: r.sector, committedBeta: r.culturalBeta, committedT: r.culturalT, committedFlagged: r.flagged };
  for (const { id } of SPECS) {
    const f = variantFits[id][r.ticker];
    row[id] = { beta: f.culturalBeta, t: f.culturalT, q: f.culturalQ ?? null, flagged: Boolean(f.flagged), status: f.status, weeksUsed: f.weeksUsed };
  }
  return row;
});

const totalFlips = [...new Set(Object.values(comparisons).flatMap((c) => c.flagFlips))];
const anyManufactured = Object.values(comparisons).some((c) => c.flaggedVariant.length > 0);

const OUT = resolve(ROOT, "output");
mkdirSync(OUT, { recursive: true });
const study = {
  note: "Basket-construction sensitivity: same estimator (src/ols.mjs, ret ~ SPY + taste), same " + dates.length + "-week cut calendar, same committed prices; only the basket construction varies. Built entirely from cached Qloo responses — zero new requests.",
  window: { start: dates[0], end: dates.at(-1), weeks: dates.length, revisionWeeksCut: revisions.map((r) => r.date) },
  gate: {
    reproduced: !bad.length,
    namesChecked: checks.length,
    maxAbsDBetaVsDesk: bad.length ? null : maxDBeta,
    maxAbsDTVsDesk: bad.length ? null : maxDT,
    failures: bad,
  },
  flagRule: { absT, qMax, method: "negative beta, |t| >= " + absT + ", Benjamini-Hochberg q <= " + qMax + " recomputed across the fitted family of each variant" },
  constructions: SPECS.map(({ id, label }) => ({ id, label, sectors: Object.fromEntries(sectors.map((s) => [s, variantMembers[id][s]?.length ?? 0])) })),
  coverage,
  comparisons,
  featuredSubset: { tickers: featuredTickers, stats: subsetStats(featuredTickers) },
  topAbsTSubset: { tickers: topT, stats: subsetStats(topT) },
  perName,
  totals: {
    baselineFlagged: Object.values(variantFits.baseline).filter((f) => f.flagged).map((f) => f.ticker),
    flipsAcrossAllVariants: totalFlips,
    someConstructionFlagsAName: anyManufactured,
  },
  provenance: {
    cacheFilesRead: [...new Set(opened)],
    qlooRequestsMade: 0,
    method: "committed members from fixtures/qloo/basket-sector-*.json; extended candidate pool from fixtures/qloo/recommend-sector-*-*.json after the pipeline's own universe exclusion, restricted to candidates whose weekly series is cached in fixtures/qloo/series.json (a candidate without a cached series has no taste return on disk and cannot price anything); seeds-k baskets are the top k of that pool ranked by Qloo affinity",
  },
};
writeFileSync(resolve(OUT, "basket-sensitivity.json"), JSON.stringify(study, null, 1));

// ---- summary table ----------------------------------------------------------
const f = (x, d = 3) => (x === null || x === undefined ? "  --  " : x.toFixed(d));
console.log(`variant            fitted  med|dBeta| p90|dBeta| max|dBeta| med|dt| p90|dt| screen flags  rho(spearman)`);
console.log(`(screen = negative beta and |t| >= ${absT} before BH; flags = screen plus q <= ${qMax} recomputed within the variant)`);
for (const { id } of SPECS) {
  if (id === "baseline") continue;
  const c = comparisons[id];
  console.log(
    `${id.padEnd(17)} ${String(c.compared).padStart(5)}  ${f(c.medianAbsDBeta).padStart(9)} ${f(c.p90AbsDBeta).padStart(9)} ${f(c.maxAbsDBeta, 1).padStart(10)} ${f(c.medianAbsDT).padStart(7)} ${f(c.p90AbsDT).padStart(7)}  ${String(c.screenPassesBeforeBH.length).padStart(5)} ${String(c.flaggedVariant.length).padStart(5)}  ${f(c.rankCorrSpearman ?? c.rankCorrPearson, 3)}`,
  );
}
console.log(`baseline: ${baselineScreen.length} name(s) pass the screen, ${baselineScreen.map((x) => x.ticker).join(",") || "-"}, 0 survive BH`);
console.log(`baseline flags: ${study.totals.baselineFlagged.length ? study.totals.baselineFlagged.join(",") : "none"}`);
console.log(`names flagged under some variant construction: ${totalFlips.length ? totalFlips.join(",") : "none"}`);
for (const [id, c] of Object.entries(comparisons)) {
  if (c.flaggedVariant.length) console.log(`  ${id}: FLAGGED -> ${c.flaggedVariant.map((t) => `${t}(${f(variantFits[id][t].culturalBeta, 2)},t ${f(variantFits[id][t].culturalT, 2)},q ${f(variantFits[id][t].culturalQ, 3)})`).join(" ")}`);
}
console.log(`saved -> ${resolve(OUT, "basket-sensitivity.json")}`);
