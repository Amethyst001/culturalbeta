// Step 4 (Regression): per holding, weekly return ~ index return + cultural
// basket return over 106 aligned weeks. Null-route: without live-Qloo fixtures
// this exits with an error and writes nothing — it never prints 0.00.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../src/env.mjs";
import { ols } from "../src/ols.mjs";
import { loadCulturalInputs, alignTaste, basketWeights } from "../src/factor.mjs";
import { outOfSample, bookPlacebo } from "../src/robustness.mjs";

const book = JSON.parse(readFileSync(resolve(ROOT, "config/book.json"), "utf8"));
const OUT = process.env.CULTURALBETA_OUTPUT_DIR ? resolve(process.env.CULTURALBETA_OUTPUT_DIR) : resolve(ROOT, "output");
const pricesFile = resolve(ROOT, "fixtures/prices.json");
if (!existsSync(pricesFile)) { console.error("Run npm run fetch-prices first (fixtures/prices.json)."); process.exit(1); }
const prices = JSON.parse(readFileSync(pricesFile, "utf8"));
const dates = prices.window.alignedDates;

let cultural;
try {
  cultural = loadCulturalInputs(book);
} catch (err) {
  console.error(`REFUSING TO PRINT: ${err.message}`);
  process.exit(2);
}

const idxReturns = prices.symbols[book.index.ticker].returns;
const tickers = book.holdings.map((h) => h.ticker);
const rows = [];
const seriesOut = {};
const fits = [];

for (const h of book.holdings) {
  const base = { ticker: h.ticker, label: h.label, qlooEntityId: cultural.idByTicker[h.ticker] ?? null };
  if (cultural.coverage[h.ticker] < book.minTrendingWeeks) {
    rows.push({ ...base, status: "insufficient signal", weeks: cultural.coverage[h.ticker], marketBeta: null, culturalBeta: null, provenance: `fixtures/qloo/trending-${h.ticker}.json (insufficient weekly points)` });
    console.log(`${h.ticker}: INSUFFICIENT SIGNAL (${cultural.coverage[h.ticker]} weekly points < ${book.minTrendingWeeks})`);
    continue;
  }
  let weights;
  try { weights = basketWeights(cultural.affinityMatrix, tickers, h.ticker); }
  catch (err) {
    rows.push({ ...base, status: "insufficient signal", note: err.message, marketBeta: null, culturalBeta: null });
    console.log(`${h.ticker}: INSUFFICIENT SIGNAL (${err.message})`);
    continue;
  }
  const basket = new Array(dates.length).fill(0);
  const hit = new Array(dates.length).fill(0);
  for (const [t, w] of weights) {
    const s = alignTaste(cultural.taste[t], dates);
    for (let i = 0; i < dates.length; i++) if (s[i] !== null) { basket[i] += w * s[i]; hit[i]++; }
  }
  if (hit.some((v) => v === 0)) {
    rows.push({ ...base, status: "insufficient signal", note: "basket gap: taste return missing for aligned weeks", marketBeta: null, culturalBeta: null });
    continue;
  }
  const mkt = ols(prices.symbols[h.ticker].returns, [idxReturns]);
  const reg = ols(prices.symbols[h.ticker].returns, [idxReturns, basket]);
  const oos = outOfSample({ y: prices.symbols[h.ticker].returns, x: idxReturns, basket });
  fits.push({ ticker: h.ticker, y: prices.symbols[h.ticker].returns, x: idxReturns, basket });
  seriesOut[h.ticker] = {
    basket,
    weights,
    taste: alignTaste(cultural.taste[h.ticker], dates),
    returns: prices.symbols[h.ticker].returns,
    index: idxReturns,
    dates,
  };
  rows.push({
    ...base,
    status: "ok",
    weeks: dates.length,
    marketBeta: reg.beta[1], marketSE: reg.se[1], marketT: reg.t[1], marketP: reg.p[1],
    culturalBeta: reg.beta[2], culturalSE: reg.se[2], culturalT: reg.t[2], culturalP: reg.p[2],
    r2: reg.r2, r2Market: mkt.r2, deltaR2: reg.r2 - mkt.r2,
    oos,
    flagged: Math.abs(reg.t[2]) >= book.flagRule.absT && reg.beta[2] < 0,
    basketWeights: weights.map(([t, w]) => ({ ticker: t, weight: w })),
    provenance: {
      prices: "fixtures/prices.json",
      trending: `fixtures/qloo/trending-${h.ticker}.json`,
      affinity: `fixtures/qloo/affinity-${h.ticker}.json`,
      entity: `fixtures/qloo/search-${h.ticker}.json`,
      qlooRequest: { path: "/v2/trending", entity: base.qlooEntityId, window: [prices.window.start, prices.window.end] },
    },
  });
  console.log(`${h.ticker}: market ${reg.beta[1].toFixed(2)}±${reg.se[1].toFixed(2)}  cultural ${reg.beta[2].toFixed(2)}±${reg.se[2].toFixed(2)}${rows.at(-1).flagged ? "  [FLAG]" : ""}`);
}

const ok = rows.filter((r) => r.status === "ok").length;
if (ok < 4) {
  console.error(`SAMPLE FLOOR: only ${ok}/7 usable signals (<4). Report honestly; not widening the floor.`);
}
const priced = rows.filter((r) => r.status === "ok");
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const placebo = priced.length ? bookPlacebo(fits) : null;
if (placebo) for (let i = 0; i < priced.length; i++) priced[i].placeboP = placebo.perHolding.p[i];

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, "desk.json"), JSON.stringify({
  window: prices.window,
  factorConstruction: "weekly taste momentum from Qloo /v2/trending (velocity_fold_change), leave-one-out affinity-weighted basket (Qloo /v2/insights affinity, normalized); regression per holding: weekly return ~ SPY return + basket return over " + dates.length + " aligned weeks.",
  index: book.index,
  rows,
  valueAdd: {
    note: "mean in-sample gain in r² from adding the taste basket to the market regression, in percentage points",
    meanDeltaR2: mean(priced.map((r) => r.deltaR2)),
    meanMarketR2: mean(priced.map((r) => r.r2Market)),
    meanFullR2: mean(priced.map((r) => r.r2)),
    medianAbsCulturalT: median(priced.map((r) => Math.abs(r.culturalT))),
    holdings: priced.length,
    oos: priced.length ? {
      note: "same nested comparison, fitted on the first " + priced[0].oos.trainWeeks + " weeks and scored on the last " + priced[0].oos.testWeeks + "; not clamped",
      trainWeeks: priced[0].oos.trainWeeks,
      testWeeks: priced[0].oos.testWeeks,
      meanDeltaR2: mean(priced.map((r) => r.oos.deltaR2)),
      holdings: priced.length,
    } : null,
    placebo: placebo ? {
      note: "book mean ΔR² against " + placebo.draws + " circular rotations of the taste baskets, all holdings shifted together; p is the share of rotations that match or beat the real alignment",
      draws: placebo.draws,
      seed: placebo.seed,
      minShift: placebo.minShift,
      real: placebo.real,
      p: placebo.p,
      placeboMean: placebo.placeboMean,
      placeboP95: placebo.placeboP95,
    } : null,
  },
  sampleFloor: { usable: ok, total: rows.length, floor: 4 },
  pricesSource: prices.source,
}, null, 1));
writeFileSync(resolve(OUT, "series.json"), JSON.stringify(seriesOut));
console.log(`Saved desk.json (${ok}/7 rows ok) → ${OUT}`);
