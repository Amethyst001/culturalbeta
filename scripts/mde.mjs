// Runner: what effect could this study have detected?
//
// Reads the committed panel (output/desk.json) and the committed series cache, and
// writes output/mde.json. Zero Qloo requests: every input is already on disk, and
// the design is re-derived only to check it reproduces the published fit to machine
// precision (it must, or the run aborts). Contract documented in src/mde.mjs.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { ROOT } from "../src/env.mjs";
import { ols } from "../src/ols.mjs";
import { blendBasket, alignTaste } from "../src/factor.mjs";
import {
  DEFAULT_POWER_TARGET,
  bhCriticalValue,
  bookSummary,
  flagPower,
  frozenSliceVerdict,
  informativePrefix,
  minimumDetectableEffect,
  regressorDiagnostics,
  residualizedSumSquares,
  simulatePower,
  tFromDeltaR2,
  weeksForEffect,
} from "../src/mde.mjs";

const OUT_DIR = process.env.CULTURALBETA_OUTPUT_DIR ? resolve(process.env.CULTURALBETA_OUTPUT_DIR) : resolve(ROOT, "output");
const QLOO_DIR = process.env.CULTURALBETA_QLOO_DIR ? resolve(process.env.CULTURALBETA_QLOO_DIR) : resolve(ROOT, "fixtures/qloo");
const SEED = 20261030;
const IID_DRAWS = 2000;
const BLOCK_DRAWS = 1000;
const BLOCK_WEEKS = 8;

const readJson = (p) => {
  if (!existsSync(p)) throw new Error(`missing committed input: ${p}`);
  return JSON.parse(readFileSync(p, "utf8"));
};

const deskPath = resolve(OUT_DIR, "desk.json");
const deskBytes = readFileSync(deskPath);
const desk = JSON.parse(deskBytes.toString("utf8"));
const seriesFile = readJson(resolve(OUT_DIR, "series.json"));
const prices = readJson(resolve(ROOT, "fixtures/prices.json"));
const trendSeries = readJson(resolve(QLOO_DIR, "series.json"));
const roster = readJson(resolve(QLOO_DIR, "entities.json"));
const book = readJson(resolve(ROOT, "config/book.json"));

const dates = desk.window.alignedDates;
const tests = desk.universe.priced;
const qMax = desk.flagRule.qMax;
const absT = desk.flagRule.absT;
const priced = desk.rows.filter((r) => r.status === "ok");
if (priced.length !== tests) throw new Error(`desk.json carries ${priced.length} fitted names but declares ${tests} priced`);

// Rebuild the exact committed design from the cache: the revision weeks come out of
// the price calendar the same way compute-betas does it, and each name's taste series
// is its sub-sector basket blended over the cached percentile levels.
const revisionSet = new Set(desk.dataQuality.revisionWeeks.map((r) => r.date));
const rawDates = prices.window.alignedDates;
const kept = rawDates.map((d, i) => (revisionSet.has(d) ? -1 : i)).filter((i) => i >= 0);
if (kept.map((i) => rawDates[i]).join() !== dates.join()) throw new Error("rebuilt calendar does not match the committed aligned dates");
const cutSeries = (arr) => kept.map((i) => arr[i]);
const market = cutSeries(prices.symbols[book.index.ticker].returns);

const cfg = book.tasteSignal;
const byId = trendSeries.byId ?? {};
const basketSeries = {};
for (const sector of new Set(priced.map((r) => r.sector))) {
  const b = readJson(resolve(QLOO_DIR, `basket-sector-${sector}.json`));
  basketSeries[sector] = alignTaste(blendBasket(b.members, byId, cfg), dates);
}
const basketFor = (row) => basketSeries[row.sector];

// The published numbers must be reproducible from the design, or the MDE computed on
// that design means nothing.
for (const row of priced) {
  const y = cutSeries(prices.symbols[row.ticker].returns);
  const basket = basketFor(row);
  if (basket.some((v) => v === null)) throw new Error(`${row.ticker}: taste basket has gaps on the committed calendar`);
  const reg = ols(y, [market, basket]);
  if (Math.abs(reg.se[2] - row.culturalSE) > 1e-9 || Math.abs(reg.beta[2] - row.culturalBeta) > 1e-9) {
    throw new Error(`${row.ticker}: rebuilt design does not reproduce the committed fit (se ${reg.se[2]} vs ${row.culturalSE})`);
  }
}

// The seven featured names whose series the desk publishes in output/series.json are
// a second, independent copy of the same basket: check they agree.
let crossChecked = 0;
for (const [ticker, entry] of Object.entries(seriesFile)) {
  const row = priced.find((r) => r.ticker === ticker);
  if (!row) continue;
  const mine = basketFor(row);
  if (mine.length !== entry.basket.length || mine.some((v, i) => Math.abs(v - entry.basket[i]) > 1e-12)) {
    throw new Error(`${ticker}: rebuilt basket disagrees with output/series.json`);
  }
  crossChecked++;
}

// ---------------------------------------------------------------- designs
const designs = priced.map((row) => ({
  ticker: row.ticker,
  y: cutSeries(prices.symbols[row.ticker].returns),
  market,
  basket: basketFor(row),
}));

// ---------------------------------------------------------------- informative prefix
const cut = informativePrefix(Object.values(basketSeries), dates);
const freeze = desk.valueAdd.oos?.scoring ?? null;
const subPeriod = {
  postHoc: true,
  weeks: cut.informativeWeeks,
  cutIndex: cut.cutIndex,
  lastMovingDate: cut.lastMovingDate,
  firstFrozenDate: cut.firstFrozenDate,
  frozenWeeks: cut.frozenWeeks,
  agreesWithDeskScoringBlock: freeze ? freeze.lastMove === cut.lastMovingDate && freeze.frozenAfterWindow === cut.frozenWeeks : null,
};

const seStats = [];
const yBy = new Map(designs.map((d) => [d.ticker, d.y]));
const perName = priced.map((row) => {
  const full = minimumDetectableEffect({
    ticker: row.ticker,
    sector: row.sector,
    weeks: row.weeks,
    se: row.culturalSE,
    r2Market: row.r2Market,
    tests,
    qMax,
    targetPower: DEFAULT_POWER_TARGET,
    observed: { beta: row.culturalBeta, t: row.culturalT, q: row.culturalQ, deltaR2: row.deltaR2 },
  });

  // Same estimator, same rule, fewer weeks: everything from the last moving week
  // onwards is cut, because those weeks add no information about the slope. Post-hoc
  // by construction — the study did not choose this window before seeing the data.
  const y = yBy.get(row.ticker).slice(0, cut.cutIndex);
  const m = market.slice(0, cut.cutIndex);
  const b = basketFor(row).slice(0, cut.cutIndex);
  const reg = ols(y, [m, b]);
  const mkt = ols(y, [m]);
  const sub = minimumDetectableEffect({
    ticker: row.ticker,
    sector: row.sector,
    weeks: cut.cutIndex,
    se: reg.se[2],
    r2Market: mkt.r2,
    tests,
    qMax,
    targetPower: DEFAULT_POWER_TARGET,
  });
  seStats.push(reg.se[2] > 0 ? row.culturalSE / reg.se[2] : null);
  full.subPeriod = {
    weeks: cut.cutIndex,
    df: sub.df,
    t_crit: sub.t_crit,
    ncpMDE: sub.ncpMDE,
    se: reg.se[2],
    betaMDE: sub.betaMDE,
    deltaR2MDEpts: sub.deltaR2MDEpts,
    partialR2MDEpts: sub.partialR2MDEpts,
    marketR2: mkt.r2,
    observedDeltaR2Pts: (reg.r2 - mkt.r2) * 100,
    seVsFull: row.culturalSE / reg.se[2],
  };
  return full;
});

// ---------------------------------------------------------------- book
const bookFull = bookSummary(perName);
const subRows = perName.map((r) => ({
  ...r,
  deltaR2MDEpts: r.subPeriod.deltaR2MDEpts,
  betaMDE: r.subPeriod.betaMDE,
  partialR2MDEpts: r.subPeriod.partialR2MDEpts,
  t_crit: r.subPeriod.t_crit,
  ncpMDE: r.subPeriod.ncpMDE,
  computable: true,
}));
const bookSub = bookSummary(subRows);
const seRatios = seStats.filter(Number.isFinite).sort((a, b) => a - b);
const med = (xs) => (xs.length ? xs[Math.floor(xs.length / 2)] : null);

const largest = [...priced].sort((a, b) => Math.abs(b.culturalT) - Math.abs(a.culturalT))[0];
const largestNegative = [...priced].filter((r) => r.culturalBeta < 0).sort((a, b) => Math.abs(b.culturalT) - Math.abs(a.culturalT))[0];
const dfFull = dates.length - 3;
const critFull = bhCriticalValue({ tests, qMax, df: dfFull });
const ncpMde = bookFull.ncpMDE;
// Round-trip guard on the published conversion: recover t from each name's own MDE
// delta-R2 and require it to come back to the noncentrality that produced it.
const roundTripMaxError = Math.max(
  ...perName.map((r) => Math.abs(tFromDeltaR2({ deltaR2: r.deltaR2MDEpts / 100, df: r.df, r2Market: r.marketR2 }) - r.ncpMDE)),
);

// ---------------------------------------------------------------- held-out arm
const scoredWeeks = desk.valueAdd.oos?.testWeeks ?? priced[0].oos?.testWeeks ?? 35;
const frozenVerdict = frozenSliceVerdict({ slice: basketFor(priced[0]).slice(-scoredWeeks), dates, trainWeeks: desk.valueAdd.oos?.trainWeeks ?? null });
const frozenDiagnostics = priced.map((row) => regressorDiagnostics(basketFor(row).slice(-scoredWeeks)));
frozenVerdict.nonzeroRegressorWeeksMax = Math.max(...frozenDiagnostics.map((d) => d.nonzeroRegressorWeeks));
frozenVerdict.namesWithAnyMovement = frozenDiagnostics.filter((d) => !d.frozen).length;
frozenVerdict.namesWithDesignInformation = priced.map((row) => {
  const slice = basketFor(row).slice(-scoredWeeks);
  return { ticker: row.ticker, ...residualizedSumSquares(slice, market.slice(-scoredWeeks)) };
}).filter((r) => r.ssr > 1e-14).length;
frozenVerdict.sliceStart = dates[dates.length - scoredWeeks];
frozenVerdict.powerAtAnyEffect = "not defined: the estimator has no sampling distribution for a regressor with zero residual variance";

// A single worked example of the frozen tail, so the claim is checkable rather than
// rhetorical: name, weeks scored, active weeks, and the design sum of squares.
const exampleRow = priced[0];
frozenVerdict.workedExample = {
  ticker: exampleRow.ticker,
  scoredWeeks,
  nonzeroWeeks: regressorDiagnostics(basketFor(exampleRow).slice(-scoredWeeks)).nonzeroRegressorWeeks,
  basketResidualSsq: residualizedSumSquares(basketFor(exampleRow).slice(-scoredWeeks), market.slice(-scoredWeeks)).ssr,
  observedInSampleDeltaR2Pts: exampleRow.deltaR2 * 100,
};

// ---------------------------------------------------------------- simulation
const t0 = Date.now();
const rows = [
  { alternative: "no cultural effect anywhere in the book (size check)", metric: "two-sided per-test rejection rate at the lone-discovery level", ncp: 0, analytic: qMax / tests },
  { alternative: `the largest in-sample reading (${largest.ticker}, |t| = ${Math.abs(largest.culturalT).toFixed(3)})`, metric: "flag-rule power", ncp: Math.abs(largest.culturalT) },
  { alternative: `the published MDE (beta = ${ncpMde.toFixed(3)} x SE)`, metric: "flag-rule power", ncp: ncpMde },
];
const analyticFor = (ncp) => (ncp === 0 ? qMax / tests : flagPower({ df: dfFull, tCrit: critFull.tCrit, ncp }));

const analyticVsSimulated = [];
for (const spec of rows) {
  const arms = [];
  for (const [name, draws, blockWeeks] of [["iid", IID_DRAWS, 0], ["block", BLOCK_DRAWS, BLOCK_WEEKS]]) {
    const sim = simulatePower({
      designs,
      seed: SEED + (blockWeeks ? 7919 : 0) + Math.round(spec.ncp * 1000),
      draws,
      ncp: spec.ncp,
      tests,
      qMax,
      absT,
      blockWeeks,
    });
    arms.push({ arm: name, ...sim });
  }
  const [iid, block] = arms;
  const observed = spec.ncp === 0;
  analyticVsSimulated.push({
    seeds: { iid: iid.seed, block: block.seed },
    alternative: spec.alternative,
    metric: spec.metric,
    ncp: Number(spec.ncp.toFixed(6)),
    draws: { iid: IID_DRAWS, block: BLOCK_DRAWS },
    analytic: Number(analyticFor(spec.ncp).toFixed(6)),
    iid: Number((observed ? iid.empiricalSizePerNullTest : iid.power).toFixed(6)),
    iidCi: observed ? null : iid.ci.map((v) => Number(v.toFixed(6))),
    block: Number((observed ? block.empiricalSizePerNullTest : block.power).toFixed(6)),
    blockCi: observed ? null : block.ci.map((v) => Number(v.toFixed(6))),
    analyticMinusIid: Number(((observed ? iid.empiricalSizePerNullTest : iid.power) - analyticFor(spec.ncp)).toFixed(6)),
    meanSignalAbsT: Number(iid.meanSignalAbsT.toFixed(4)),
    blockMeanSignalAbsT: Number(block.meanSignalAbsT.toFixed(4)),
    falseFlagRatePerNullName: Number(iid.falseFlagRatePerNullName.toExponential(4)),
    blockDegenerateFits: block.degenerateFits,
  });
}

// ---------------------------------------------------------------- design requirement
// The converse question: how long would the panel have to be for an effect of a given
// size to be detectable at 80% under the same rule? Every candidate effect below is read
// off the data (the observed increments) or is a round-number grid, so the whole block is
// post-hoc as a choice and pre-registered as a rule: the flag rule, the name count and
// the market share of variance are all fixed. The last row is a self-check — asking for
// the published MDE back must return roughly the weeks actually in hand.
const sortedR2 = priced.map((r) => r.r2Market).sort((a, b) => a - b);
const medianR2Market = sortedR2[Math.floor(sortedR2.length / 2)];
const requirementSpecs = [
  { label: "the book's mean in-sample increment", deltaR2Pts: desk.valueAdd.meanDeltaR2 * 100, r2Market: medianR2Market, source: "observed (post-hoc)" },
  { label: `the largest in-sample increment (${largest.ticker})`, deltaR2Pts: largest.deltaR2 * 100, r2Market: largest.r2Market, source: "observed (post-hoc)" },
  { label: `the largest negative-beta reading (${largestNegative.ticker})`, deltaR2Pts: largestNegative.deltaR2 * 100, r2Market: largestNegative.r2Market, source: "observed (post-hoc)" },
  ...[1, 2, 5, 10].map((v) => ({ label: `${v} delta-R-squared point${v === 1 ? "" : "s"} at the median market R-squared`, deltaR2Pts: v, r2Market: medianR2Market, source: "round-number grid" })),
  { label: "the published book median MDE (self-check: must return ~the weeks in hand)", deltaR2Pts: bookFull.medianDeltaR2Pts, r2Market: perName.find((r) => Math.abs(r.deltaR2MDEpts - bookFull.medianDeltaR2Pts) === Math.min(...perName.map((x) => Math.abs(x.deltaR2MDEpts - bookFull.medianDeltaR2Pts)))).marketR2, source: "this table's own output" },
];
const requirementRows = requirementSpecs.map((spec) => {
  const r = weeksForEffect({ deltaR2: spec.deltaR2Pts / 100, r2Market: spec.r2Market, tests, qMax, targetPower: DEFAULT_POWER_TARGET });
  return {
    ...spec,
    weeks: r.reachable ? r.weeks : null,
    years: r.reachable ? Number((r.weeks / 52).toFixed(1)) : null,
    multipleOfCurrentPanel: r.reachable ? Number((r.weeks / dates.length).toFixed(1)) : null,
    reason: r.reachable ? null : r.reason,
  };
});

// ---------------------------------------------------------------- output
const out = {
  generatedAt: new Date().toISOString(),
  source: {
    deskRevision: `sha256:${createHash("sha256").update(deskBytes).digest("hex").slice(0, 16)}`,
    deskBytes: deskBytes.length,
    deskWindow: desk.window && { start: desk.window.start, end: desk.window.end, weeks: dates.length },
    inputs: ["output/desk.json", "output/series.json", "fixtures/prices.json", "fixtures/qloo/series.json", "fixtures/qloo/entities.json", "fixtures/qloo/basket-sector-*.json", "config/book.json"],
    qlooRequests: 0,
    integrity: {
      rebuiltDesignsMatchPublishedFit: priced.length,
      outputSeriesCrossChecked: crossChecked,
      entityRosterRows: roster.length,
    },
  },
  method: {
    design: "weekly stock return ~ SPY return + sub-sector taste basket, ordinary least squares, one fit per name",
    flagRule: desk.flagRule,
    singleDiscoveryLevel: critFull.singleDiscoveryLevel,
    singleDiscoveryLevelRule: critFull.rule,
    tCrit: critFull.tCrit,
    df: dates.length - 3,
    weeks: dates.length,
    powerTarget: DEFAULT_POWER_TARGET,
    ncpMDE: ncpMde,
    mdeDefinition:
      "the smallest |beta| the pre-registered rule flags with 80% probability, computed on that name's own design: MDE = ncp * SE(beta), where ncp solves the noncentral-t flag power P(beta_hat < 0, p <= q/tests) = 0.80 at the Benjamini-Hochberg single-discovery level q/tests",
    deltaR2Definition:
      "increment over the market-only fit, the same currency as the desk headline: deltaR2 = (1 - r2_market) * t^2 / (t^2 + df); the partial R-squared alone is t^2/(t^2+df)",
    roundTripCheck: `tFromDeltaR2(deltaR2FromT(t)) === t, worst error across the book ${roundTripMaxError.toExponential(3)}`,
    subPeriodCut: subPeriod,
    simulation: {
      seed: SEED,
      iidDraws: IID_DRAWS,
      blockDraws: BLOCK_DRAWS,
      blockWeeks: BLOCK_WEEKS,
      signalRotation: "one name per draw carries the planted beta, rotating through all 80 so every design is exercised equally",
      arms: {
        iid: "committed design as the regression fit, iid Gaussian errors at each name's own residual scale — the arm the analytic formula describes",
        block: "(market, basket, residual) resampled jointly in 8-week circular blocks from each name's own committed series — keeps within-block dependence, breaks alignment beyond it",
      },
    },
    postHocFields: ["method.subPeriodCut", "book.informativeSubPeriod"],
  },
  preRegistered: {
    split: `first ${desk.valueAdd.oos?.trainWeeks ?? 67} weeks train, last ${scoredWeeks} weeks scored, fixed before the data was pulled`,
    flagRule: `negative cultural beta, |t| >= ${absT}, Benjamini-Hochberg q <= ${qMax} across ${tests} priced names`,
    note: "the MDE is not pre-registered: it is a property of the pre-registered design and rule. Only the split and the flag rule were fixed before the data was pulled, and nothing here was chosen by looking at an outcome.",
  },
  book: {
    ...bookFull,
    informativeSubPeriod: {
      ...bookSub,
      postHoc: true,
      weeks: subPeriod.weeks,
      lastMovingDate: subPeriod.lastMovingDate,
      firstFrozenDate: subPeriod.firstFrozenDate,
      frozenWeeks: subPeriod.frozenWeeks,
      seRatioVsFull: { median: med(seRatios), min: seRatios[0], max: seRatios.at(-1) },
      note: "same estimator and same rule on the weeks where the basket actually moves; the ratio of full-window SE to sub-window SE is what the 44 frozen weeks bought",
    },
    observed: {
      meanDeltaR2Pts: desk.valueAdd.meanDeltaR2 * 100,
      largestAbsT: {
        ticker: largest.ticker,
        beta: largest.culturalBeta,
        t: largest.culturalT,
        q: largest.culturalQ,
        deltaR2Pts: largest.deltaR2 * 100,
        powerAtObserved: flagPower({ df: dates.length - 3, tCrit: critFull.tCrit, ncp: Math.abs(largest.culturalT) }),
        shareOfMde: Math.abs(largest.culturalT) / ncpMde,
      },
      largestNegativeAbsT: {
        ticker: largestNegative.ticker,
        beta: largestNegative.culturalBeta,
        t: largestNegative.culturalT,
        q: largestNegative.culturalQ,
        deltaR2Pts: largestNegative.deltaR2 * 100,
        powerAtObserved: flagPower({ df: dates.length - 3, tCrit: critFull.tCrit, ncp: Math.abs(largestNegative.culturalT) }),
        shareOfMde: Math.abs(largestNegative.culturalT) / ncpMde,
      },
      flaggedNames: priced.filter((r) => r.flagged).length,
    },
  },
  perName,
  simulation: { seed: SEED, draws: { iid: IID_DRAWS, block: BLOCK_DRAWS }, blockWeeks: BLOCK_WEEKS, runtimeMs: Date.now() - t0, analyticVsSimulated },
  designRequirement: {
    postHoc: true,
    targetPower: DEFAULT_POWER_TARGET,
    horizonWeeks: 200000,
    currentWeeks: dates.length,
    medianR2Market: medianR2Market,
    note: "weeks needed for an effect of the stated size to be flagged with 80% probability under the pre-registered rule; the effect is held fixed in delta-R-squared at the name's own market share of variance, so the implied claim is about sample size only, not about the taste signal persisting",
    rows: requirementRows,
  },
  frozenSlice: frozenVerdict,
  caveats: [
    "The MDE is a design property: weeks, each name's own residual scale, each basket's own variance, and the pre-registered multiplicity rule. It does not depend on any observed t-statistic.",
    "The lone-discovery level q/m = 0.1/80 = 0.00125 is the Benjamini-Hochberg threshold a single signal must clear. If several names carried a true effect at once, the step-up thresholds are looser and the MDE would be smaller; the published figure is the conservative one.",
    "The flag rule requires a negative beta. Power is therefore computed one-sided in that direction; the sign screen itself costs nothing, because the rejection region already implies a negative estimate.",
    "deltaR2 figures are increments over the market-only fit in the desk's own currency, converted with the exact identity (1 - r2_market) * t^2/(t^2 + df). Names with a high market R-squared have less residual variance for taste to explain, so their MDE in points is lower; the partial R-squared column removes that difference.",
    "The informative-sub-period cut (weeks up to the last moving week) is post-hoc: it was chosen after measuring Qloo's carry-forward tail. It is a sensitivity statement about the design, not a pre-registered second test.",
    "The held-out slice is not a low-power test, it is not a test: the taste regressor is identically zero on every scored week, so its residual sum of squares is 0 and the slope has no sampling distribution. No power number is published for it.",
    "The block arm resamples market, basket and residual jointly in 8-week circular blocks. It preserves within-block dependence and the contemporaneous market-basket relation; it destroys alignment longer than one block, so a divergence from the iid arm measures the cost of assuming independence, not a property of the real calendar.",
    "The block arm also over-rejects under the null relative to the nominal lone-discovery level, which is the same finding read the other way: with dependence inside the resampled block, the ordinary-least-squares standard error understates the sampling variation of the slope, so the Benjamini-Hochberg level is looser in practice than the nominal q. The iid arm, which is the arm the analytic formula describes, matches the analytic power closely; the gap between the two arms is reported in simulation.analyticVsSimulated rather than reconciled away.",
    "designRequirement rows are post-hoc as a choice of effect size (the observed increments and a round-number grid) and pre-registered as a rule. They hold the effect fixed in delta-R-squared and assume weeks are exchangeable: they say what sample size an effect of that size needs, not that such an effect would persist over the decades such a panel would span.",
    "Nothing here is investment advice or a forecast; the numbers describe what this study could see, not what any security is worth.",
  ],
};

writeFileSync(resolve(OUT_DIR, "mde.json"), `${JSON.stringify(out, null, 1)}\n`);

const fmt = (v) => (v == null || Number.isNaN(v) ? "n/a" : Number(v).toFixed(3));
console.log(`mde: ${perName.length} priced names, ${dates.length} weeks, lone-discovery level ${fmt(critFull.singleDiscoveryLevel)}, t_crit ${fmt(critFull.tCrit)}, ncp ${fmt(ncpMde)}`);
console.log(`book MDE (full window)      : median ${fmt(bookFull.medianDeltaR2Pts)} pts delta-R2, IQR ${fmt(bookFull.iqr[0])}-${fmt(bookFull.iqr[1])}, partial R2 ${fmt(bookFull.partialR2MDEpts)} pts`);
console.log(`book MDE (informative weeks): median ${fmt(bookSub.medianDeltaR2Pts)} pts over ${subPeriod.weeks} weeks (post-hoc cut at ${subPeriod.lastMovingDate}), SE ratio full/sub median ${fmt(med(seRatios))}`);
console.log(`largest observed            : ${largest.ticker} |t| ${fmt(Math.abs(largest.culturalT))} = ${fmt((Math.abs(largest.culturalT) / ncpMde) * 100)}% of the MDE, delta-R2 ${fmt(largest.deltaR2 * 100)} pts vs ${fmt(perName.find((r) => r.ticker === largest.ticker).deltaR2MDEpts)} pts detectable`);
for (const r of analyticVsSimulated) console.log(`power ${r.metric} @ ncp ${r.ncp}: analytic ${r.analytic} iid ${r.iid} block ${r.block}`);
for (const r of requirementRows) console.log(`detect 80% of ${r.deltaR2Pts.toFixed(2)} pts (${r.label}): ${r.weeks ?? "not reachable"} weeks${r.weeks ? ` = ${r.years} years, ${r.multipleOfCurrentPanel}x the panel` : ` - ${r.reason}`}`);
console.log(`frozen slice: computable=${frozenVerdict.computable}; ${frozenVerdict.nonzeroRegressorWeeks} moving weeks in ${frozenVerdict.weeks} scored, ${frozenVerdict.namesWithAnyMovement}/${priced.length} names move at all`);
console.log(`wrote ${resolve(OUT_DIR, "mde.json")} in ${out.simulation.runtimeMs} ms`);
