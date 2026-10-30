// Step 5 (Regression): every name in the consumer universe, weekly return ~ index
// return + its sub-sector's taste basket, over 106 aligned weeks — then the same
// estimator unchanged on the disjoint 106 weeks immediately before that window.
//
// A hundred names means a hundred |t| tests, so the flag screens on |t| >= 2 and
// confirms on a Benjamini–Hochberg q. Null-route: without live-Qloo fixtures this
// exits with an error and writes nothing — it never prints 0.00.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../src/env.mjs";
import { ols } from "../src/ols.mjs";
import { loadCulturalInputs, alignTaste, revisionWeeks } from "../src/factor.mjs";
import { outOfSample, oosComponents, bookPlacebo, bookDatePermutation, bootstrapMean, refitBootstrap, fixedBootstrapPerItem, scoringDiagnostics } from "../src/robustness.mjs";
import { benjaminiHochberg } from "../src/multiplicity.mjs";
import { peerBasket, ablationOf, ablationOos, ablationComponents, ablationPlacebo } from "../src/ablation.mjs";
import { loadUniverse } from "../src/universe.mjs";
import { alignSentiment, sentimentOos, pearson } from "../src/sentiment.mjs";
import { pooledPanel, panelNameMarket } from "../src/panel.mjs";
import { betaDispersion } from "../src/dispersion.mjs";

const book = JSON.parse(readFileSync(resolve(ROOT, "config/book.json"), "utf8"));
const universe = loadUniverse();
const OUT = process.env.CULTURALBETA_OUTPUT_DIR ? resolve(process.env.CULTURALBETA_OUTPUT_DIR) : resolve(ROOT, "output");
const sentimentPath = resolve(ROOT, "fixtures/sentiment.json");
const sentiment = existsSync(sentimentPath) ? JSON.parse(readFileSync(sentimentPath, "utf8")) : null;
const pricesFile = process.env.CULTURALBETA_PRICES_FILE
  ? resolve(process.env.CULTURALBETA_PRICES_FILE)
  : resolve(ROOT, "fixtures/prices.json");
if (!existsSync(pricesFile)) { console.error("Run npm run fetch-prices first (fixtures/prices.json)."); process.exit(1); }
const prices = JSON.parse(readFileSync(pricesFile, "utf8"));

let cultural;
try {
  cultural = loadCulturalInputs(book, universe);
} catch (err) {
  console.error(`REFUSING TO PRINT: ${err.message}`);
  process.exit(2);
}

// A week in which Qloo revised its catalogue is not a week people changed their
// minds, and a log difference taken across it would be a three-unit outlier that
// no controls can explain. Detected from the book's own level series, then cut
// from both price windows so every series keeps the same calendar.
const revisions = revisionWeeks(cultural.series, book.tasteSignal);
const revisionSet = new Set(revisions.map((r) => r.date));
const revisionCuts = { primary: 0, prior: 0 };
// Kept so the same estimator can be re-run on the uncut calendar: the cut is a
// judgement, and a judgement is only defensible beside the result of dropping it.
const rawPrimary = { dates: [...prices.window.alignedDates], returns: {} };
for (const [t, s] of Object.entries(prices.symbols ?? {})) rawPrimary.returns[t] = s.returns ? [...s.returns] : null;
if (revisionSet.size) {
  const keep = (dates) => dates.filter((d) => !revisionSet.has(d));
  const aligned = (dates, arr) => {
    if (!arr) return arr;
    if (arr.length !== dates.length) throw new Error(`price series length ${arr.length} does not match ${dates.length} aligned dates`);
    return arr.filter((_, i) => !revisionSet.has(dates[i]));
  };
  const p0 = prices.window.alignedDates;
  for (const s of Object.values(prices.symbols ?? {})) {
    s.returns = aligned(p0, s.returns);
    if (prices.priorWindow) s.priorReturns = aligned(prices.priorWindow.alignedDates, s.priorReturns);
  }
  revisionCuts.primary = p0.length - keep(p0).length;
  revisionCuts.prior = prices.priorWindow ? prices.priorWindow.alignedDates.length - keep(prices.priorWindow.alignedDates).length : 0;
  prices.window.alignedDates = keep(p0);
  if (prices.priorWindow) prices.priorWindow.alignedDates = keep(prices.priorWindow.alignedDates);
  console.log(`Cut ${revisionCuts.primary} revised weeks from the primary window and ${revisionCuts.prior} from the prior window: ${revisions.map((r) => `${r.date} (median move ${r.medianMove})`).join(", ")}`);
}

const absT = book.flagRule.absT;
const qMax = book.flagRule.qMax ?? 0.10;
const names = cultural.entities.filter((e) => e.entityId);
const unresolved = cultural.entities.filter((e) => !e.entityId);
// A stub run is a stub run whichever way it was launched: pointing the cache at
// .stub/ is enough to make the panel a layout exercise, so the tag cannot be
// lost by forgetting the harness variable.
const stubRun = Boolean(process.env.QLOO_BIN_JS) || /(^|[\\/])\.stub([\\/]|$)/.test(process.env.CULTURALBETA_QLOO_DIR ?? "");

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
function runPass(dates, returnsFor, { keepSeries = false, cohort = names } = {}) {
  const idxReturns = returnsFor(book.index.ticker);
  if (!idxReturns) throw new Error(`no ${book.index.ticker} returns in the supplied window`);
  // Sector peers for the ablation arm: the same window, the same cohort, every
  // name in the sub-sector except the one being priced.
  const sectorPeers = new Map();
  const windowReturns = {};
  for (const n of cohort) {
    const r = returnsFor(n.ticker);
    if (!r) continue;
    windowReturns[n.ticker] = r;
    if (!sectorPeers.has(n.sector)) sectorPeers.set(n.sector, []);
    sectorPeers.get(n.sector).push(n.ticker);
  }
  const rows = [];
  const fits = [];
  const seriesOut = {};
  for (const name of cohort) {
    const base = {
      ticker: name.ticker,
      label: name.label,
      sector: name.sector,
      sectorLabel: universe.sectors.find((s) => s.id === name.sector)?.label ?? name.sector,
      featured: Boolean(name.featured),
      qlooEntityId: name.entityId,
    };
    const y = returnsFor(name.ticker);
    if (!y) {
      rows.push({ ...base, status: "no prices", weeks: 0, marketBeta: null, culturalBeta: null, note: "no fully aligned weekly prices for this ticker in the window" });
      continue;
    }
    const basket = alignTaste(cultural.taste[name.ticker], dates);
    const coverage = basket.filter((v) => v !== null).length;
    if (coverage < book.minTrendingWeeks) {
      rows.push({ ...base, status: "insufficient signal", weeks: coverage, marketBeta: null, culturalBeta: null, provenance: { series: "fixtures/qloo/series.json", basket: `fixtures/qloo/basket-sector-${name.sector}.json` }, note: `${coverage} aligned taste weeks < floor ${book.minTrendingWeeks}` });
      continue;
    }
    if (coverage !== dates.length) {
      rows.push({ ...base, status: "insufficient signal", weeks: coverage, marketBeta: null, culturalBeta: null, note: `basket gap: taste return missing in ${dates.length - coverage} aligned weeks`, provenance: { series: "fixtures/qloo/series.json", basket: `fixtures/qloo/basket-sector-${name.sector}.json` } });
      continue;
    }
    const mkt = ols(y, [idxReturns]);
    const reg = ols(y, [idxReturns, basket]);
    const oos = outOfSample({ y, x: idxReturns, basket });
    const peer = peerBasket(windowReturns, sectorPeers.get(name.sector) ?? [], name.ticker, dates.length);
    const ablation = peer ? { ...ablationOf(y, idxReturns, peer, basket), oos: ablationOos({ y, market: idxReturns, peer, taste: basket }) } : null;
    fits.push({
      ticker: name.ticker, sector: name.sector, y, x: idxReturns, basket, peer,
      comp: oosComponents({ y, x: idxReturns, basket }),
      abComp: peer ? ablationComponents({ y, market: idxReturns, peer, taste: basket }) : null,
    });
    if (keepSeries && name.featured) {
      seriesOut[name.ticker] = {
        basket,
        weights: cultural.sectorBaskets[name.sector].members.map((m) => [m.name, m.weight]),
        taste: alignTaste(cultural.ownTaste[name.ticker] ?? new Map(), dates),
        returns: y,
        index: idxReturns,
        dates,
      };
    }
    rows.push({
      ...base,
      status: "ok",
      weeks: dates.length,
      marketBeta: reg.beta[1], marketSE: reg.se[1], marketT: reg.t[1], marketP: reg.p[1],
      culturalBeta: reg.beta[2], culturalSE: reg.se[2], culturalT: reg.t[2], culturalP: reg.p[2],
      activeWeeks: basket.filter((v) => Math.abs(v) > 1e-12).length,
      r2: reg.r2, r2Market: mkt.r2, deltaR2: reg.r2 - mkt.r2,
      oos,
      ablation,
      flagged: false,
      basket: cultural.sectorBaskets[name.sector].members.map((m) => ({ id: m.id, name: m.name, type: m.type, weight: m.weight, affinity: m.affinity })),
      basketScope: `sector:${name.sector}`,
      provenance: {
        prices: "fixtures/prices.json",
        series: "fixtures/qloo/series.json",
        basket: `fixtures/qloo/basket-sector-${name.sector}.json`,
        entity: `fixtures/qloo/search-${name.ticker}.json`,
        qlooRequest: {
          operation: "recommend",
          path: "/v2/insights",
          signals: cultural.sectorBaskets[name.sector].signalEntityIds ?? [],
          entity: name.entityId,
          types: book.basket.types,
          seriesWindow: [prices.window.start, prices.window.end],
        },
      },
    });
  }

  // One flag rule for the whole book: a negative beta needs both a screen and a
  // multiplicity-corrected q, or a hundred names would flag by chance alone.
  const priced = rows.filter((r) => r.status === "ok");
  if (priced.length) {
    const qs = benjaminiHochberg(priced.map((r) => r.culturalP));
    priced.forEach((r, i) => {
      r.culturalQ = qs[i];
      r.flagged = r.culturalBeta < 0 && Math.abs(r.culturalT) >= absT && r.culturalQ <= qMax;
    });
  }
  // A level-difference basket is zero in every week Qloo reports no movement, so
  // the slope is identified only on the weeks the basket actually moves. Say how
  // many those are: a large cultural beta off a handful of weeks must be read as
  // such, and the desk prints the range rather than letting a judge find it.
  const active = fits.map((f) => f.basket.filter((v) => Math.abs(v) > 1e-12).length).sort((a, b) => a - b);
  const factorSparsity = active.length ? {
    names: active.length,
    weeks: fits[0].basket.length,
    minActive: active[0],
    maxActive: active[active.length - 1],
    medianActive: active[Math.floor(active.length / 2)],
  } : null;
  return { rows, fits, seriesOut, factorSparsity };
}

function summarise(pass, dates) {
  const priced = pass.rows.filter((r) => r.status === "ok");
  if (!priced.length) return null;
  // The sentiment exclusion: does taste survive a published consumer-confidence
  // index as a second regressor? Monthly index, carried as its month-over-month
  // change on the weeks inside that month — coarse, and said to be coarse.
  const senti = sentiment ? alignSentiment(sentiment.observations, dates) : null;
  const sentiArm = senti && pass.fits.length
    ? pass.fits.map((f) => ({ ...sentimentOos({ y: f.y, market: f.x, sentiment: senti.series, basket: f.basket }), corr: pearson(f.basket, senti.series) }))
    : null;
  const placebo = bookPlacebo(pass.fits);
  const permutation = bookDatePermutation(pass.fits);
  for (let i = 0; i < priced.length; i++) priced[i].placeboP = placebo.perHolding.p[i];

  // A point estimate with no interval invites the question "how sure?". Resample
  // the test weeks in circular blocks, score the same fixed coefficients, and
  // report the spread of the book mean.
  const sse = (comp, yhat, idx) => idx.reduce((s, i) => s + (comp.yTe[i] - yhat[i]) ** 2, 0);
  const deltaR2At = (comp, base, full, idx) => {
    const ys = idx.map((i) => comp.yTe[i]);
    const m = mean(ys);
    const sst = ys.reduce((s, v) => s + (v - m) ** 2, 0);
    return sst === 0 ? 0 : (sse(comp, base, idx) - sse(comp, full, idx)) / sst;
  };
  const testN = pass.fits[0].comp.testWeeks;
  const oosSe = bootstrapMean(
    (idx) => mean(pass.fits.map((f) => deltaR2At(f.comp, f.comp.yhatMarket, f.comp.yhatFull, idx))),
    testN, { seed: book.seed ?? 20261029 },
  );
  const withAb = pass.fits.filter((f) => f.abComp);
  const abSe = withAb.length ? bootstrapMean(
    (idx) => mean(withAb.map((f) => deltaR2At(f.abComp, f.abComp.yhatPeer, f.abComp.yhatJoint, idx))),
    testN, { seed: book.seed ?? 20261029, prefix: 1 },
  ) : null;

  // The interval above holds the coefficients still. This one refits every draw
  // on its own resampled train weeks, which is the conservative reading: the
  // estimation error in the coefficients widens the interval instead of hiding.
  const weeksN = pass.fits[0].y.length;
  const seed = book.seed ?? 20261029;
  const oosRefit = refitBootstrap(pass.fits, (f) => [f.x, f.basket], { weeks: weeksN, baseCount: 1, seed });
  const oosFixed = fixedBootstrapPerItem(pass.fits.map((f) => f.comp), { weeks: weeksN, seed });
  const abRefit = withAb.length
    ? refitBootstrap(withAb, (f) => [f.x, f.peer, f.basket], { weeks: weeksN, baseCount: 2, seed: seed + 1 })
    : null;
  // The ablation's own rotation null: the same circular shifts scored against the
  // peer models. The market placebo above asks whether taste beats rotation over
  // SPY; this asks whether it beats rotation over SPY *and* the sector's peers.
  const sentiSe = sentiArm?.length
    ? bootstrapMean(
      (idx) => mean(sentiArm.map((a) => deltaR2At(a.comp, a.comp.yhatBase, a.comp.yhatJoint, idx))),
      testN, { seed: book.seed ?? 20261029, prefix: 3 },
    )
    : null;
  const abPlacebo = withAb.length
    ? ablationPlacebo(withAb.map((f) => ({ y: f.y, market: f.x, peer: f.peer, basket: f.basket })), { seed })
    : null;
  pass.fits.forEach((f, i) => { f.refit = oosRefit.perItem[i]; });
  if (abPlacebo) withAb.forEach((f, i) => { f.abPlaceboP = abPlacebo.perHolding.p[i]; });
  if (sentiArm) priced.forEach((r, i) => {
    const a = sentiArm[i];
    if (!a) return;
    r.sentimentExtraOosR2 = a.tasteExtraOosR2;
    r.sentimentCorr = a.corr;
  });
  priced.forEach((r, i) => {
    if (!pass.fits[i]) return;
    r.oosRefit = oosRefit.perItem[i];
    r.oosFixed = oosFixed[i];
    r.ablationPlaceboP = pass.fits[i].abPlaceboP ?? null;
  });
  // Where the scored weeks actually carry information. A basket return is zero in
  // every week Qloo did not revise, so some scored weeks cannot move the taste
  // slope at all. Count them rather than leaving a reader to infer it from the
  // active-week range on the table.
  const testStart = priced[0].oos.trainWeeks;
  // Where Qloo's own revision history ends, kept beside the split so the vintage
  // cannot be read without it. The pre-registered 67/35 split put the whole scored
  // slice in a carry-forward, so the held-out cell could not have detected a taste
  // effect of any size, and every surface says so at the number rather than selling
  // a perturbation of the training fit as a test.
  const scoring = scoringDiagnostics({ baskets: pass.fits.map((f) => f.basket), dates, trainWeeks: testStart });
  let lastMove = scoring.lastMove === null ? -1 : dates.indexOf(scoring.lastMove);
  // What the Qloo basket is that the no-Qloo peer basket is not. If the two were
  // near-copies the ablation would be uninformative by construction; the correlation
  // says how much of the taste basket the sector average already contains, and the
  // active count says how much of the calendar each one uses.
  const qv = pass.fits.filter((f) => f.peer)
    .map((f) => ({ sector: f.sector, corr: pearson(f.basket, f.peer), active: f.basket.filter((v) => Math.abs(v) > 1e-12).length }));
  const qlooVsPeer = qv.length ? {
    holdings: qv.length,
    weeks: dates.length,
    meanCorr: mean(qv.map((r) => r.corr)),
    minCorr: Math.min(...qv.map((r) => r.corr)),
    maxCorr: Math.max(...qv.map((r) => r.corr)),
    meanActive: mean(qv.map((r) => r.active)),
    bySector: [...new Set(qv.map((r) => r.sector))].map((id) => {
      const rs = qv.filter((r) => r.sector === id);
      return { id, names: rs.length, corr: mean(rs.map((r) => r.corr)), active: median(rs.map((r) => r.active)) };
    }),
    note: "correlation between each name's Qloo taste basket and its no-Qloo same-sector peer basket over the same weeks; the peer basket is a price series and moves every week, the taste basket moves only on the dates Qloo revises its catalogue",
  } : null;
  // Where Qloo's own revision history ends — kept above with the scoring block so
  // the cadence diagnostic cannot be read without it.
  const cadence = lastMove >= 0 ? (() => {
    const items = pass.fits.map((f) => ({ y: f.y, x: f.x, basket: f.basket }));
    const nInfo = lastMove + 1;
    const k = Math.min(Math.max(Math.round(nInfo * 0.66), 24), nInfo - 12);
    const testN = nInfo - k;
    const rows = items.map((it) => {
      const y = it.y.slice(0, nInfo), x = it.x.slice(0, nInfo), b = it.basket.slice(0, nInfo);
      const yTr = y.slice(0, k), yTe = y.slice(k);
      const full = ols(yTr, [x.slice(0, k), b.slice(0, k)]);
      const mkt = ols(yTr, [x.slice(0, k)]);
      const sst = yTe.reduce((s, v) => s + (v - mean(yTe)) ** 2, 0);
      const sse = (beta, cols) => yTe.reduce((s, v, i) => s + (v - beta[0] - cols.reduce((a, c, j) => a + beta[j + 1] * c[i], 0)) ** 2, 0);
      const bTe = b.slice(k), xTe = x.slice(k);
      return {
        delta: sst === 0 ? 0 : (sse(mkt.beta, [xTe]) - sse(full.beta, [xTe, bTe])) / sst,
        active: bTe.filter((v) => Math.abs(v) > 1e-12).length,
        insample: full.r2 - mkt.r2,
      };
    });
    const ds = rows.map((r) => r.delta).sort((a, b) => a - b);
    const act = rows.map((r) => r.active).sort((a, b) => a - b);
    return {
      weeks: nInfo,
      start: dates[0],
      end: dates[lastMove],
      trainWeeks: k,
      testWeeks: testN,
      mean: mean(ds),
      median: median(ds),
      min: ds[0],
      max: ds.at(-1),
      sharePositive: ds.filter((v) => v > 0).length / ds.length,
      activeMedian: act[act.length >> 1],
      inSampleMean: mean(rows.map((r) => r.insample)),
      note: "post-hoc diagnostic: the same estimator with the scored slice moved inside the part of the window where Qloo actually revised, because the pre-registered slice is all frozen. Not pre-registered, and the mean is outlier-dominated at this test length — read the median and the share positive, not the mean.",
    };
  })() : null;
  return {
    window: { start: dates[0], end: dates.at(-1), weeks: dates.length },
    meanDeltaR2: mean(priced.map((r) => r.deltaR2)),
    meanMarketR2: mean(priced.map((r) => r.r2Market)),
    meanFullR2: mean(priced.map((r) => r.r2)),
    medianAbsCulturalT: median(priced.map((r) => Math.abs(r.culturalT))),
    ablation: (() => {
      const withAbl = priced.filter((r) => r.ablation);
      if (!withAbl.length) return null;
      return {
        note: "ablation control: a same-sector peer basket — the equal-weight return of the other names in the sub-sector, from the same committed prices — fitted before the taste basket. In-sample tasteExtraR2 cannot fall when a regressor is added, so the headline is the out-of-sample arm: peer-only vs peer+taste, fitted on the first " + withAbl[0].ablation.oos.trainWeeks + " weeks and scored on the last " + withAbl[0].ablation.oos.testWeeks,
        holdings: withAbl.length,
        meanPeerDeltaR2: mean(withAbl.map((r) => r.ablation.peerDeltaR2)),
        meanTasteExtraR2: mean(withAbl.map((r) => r.ablation.tasteExtraR2)),
        medianTasteExtraT: median(withAbl.map((r) => Math.abs(r.ablation.tasteExtraT))),
        oos: {
          trainWeeks: withAbl[0].ablation.oos.trainWeeks,
          testWeeks: withAbl[0].ablation.oos.testWeeks,
          meanTasteExtraR2: mean(withAbl.map((r) => r.ablation.oos.tasteExtraOosR2)),
          sharePositive: withAbl.filter((r) => r.ablation.oos.tasteExtraOosR2 > 0).length / withAbl.length,
          se: abSe?.se ?? null,
          ci90: abSe ? [abSe.lo, abSe.hi] : null,
          draws: abSe?.draws ?? null,
          blockWeeks: abSe?.blockWeeks ?? null,
          refit: abRefit ? { se: abRefit.book.se, ci90: [abRefit.book.lo, abRefit.book.hi], draws: abRefit.draws, blockWeeks: abRefit.blockWeeks } : null,
          placebo: abPlacebo ? { draws: abPlacebo.draws, validDraws: abPlacebo.validDraws, skippedDraws: abPlacebo.skippedDraws, minTrainWeeks: abPlacebo.minTrainWeeks, minTrainSd: abPlacebo.minTrainSd, seed: abPlacebo.seed, minShift: abPlacebo.minShift, real: abPlacebo.real, p: abPlacebo.p, placeboMean: abPlacebo.placeboMean, placeboP95: abPlacebo.placeboP95 } : null,
        },
        qlooVsPeer,
        // The ablation uses the same 0.66 split, so its scored slice ends up in
        // the same carry-forward tail. This is passed through so no surface can
        // present the ablation's held-out number as a taste test.
        scoring,
      };
    })(),
    sentiment: sentiArm?.length ? {
      note: "consumer-sentiment exclusion: the taste basket must add over SPY *and* the University of Michigan Index of Consumer Sentiment (FRED UMCSENT). The index is monthly, carried as its month-over-month change on the weeks inside that month — coarse by construction, not interpolated to a weekly series it does not have; a weekly sentiment series would be the stronger control.",
      source: sentiment?.source ?? null,
      fetched: sentiment?.fetched ?? null,
      cadence: sentiment?.cadence ?? null,
      monthsCovered: senti.monthsCovered,
      movingWeeks: senti.moving,
      holdings: sentiArm.length,
      meanExtraR2: mean(sentiArm.map((a) => a.tasteExtraOosR2)),
      sharePositive: sentiArm.filter((a) => a.tasteExtraOosR2 > 0).length / sentiArm.length,
      meanCorr: mean(sentiArm.map((a) => a.corr).filter((r) => r != null)),
      oos: {
        trainWeeks: sentiArm[0].trainWeeks,
        testWeeks: sentiArm[0].testWeeks,
        meanTasteExtraR2: mean(sentiArm.map((a) => a.tasteExtraOosR2)),
        sharePositive: sentiArm.filter((a) => a.tasteExtraOosR2 > 0).length / sentiArm.length,
        se: sentiSe?.se ?? null,
        ci90: sentiSe ? [sentiSe.lo, sentiSe.hi] : null,
        draws: sentiSe?.draws ?? null,
        blockWeeks: sentiSe?.blockWeeks ?? null,
      },
      // Same 0.66 split, so the sentiment arm's held-out slice is the same
      // carry-forward tail; no surface may read it as a taste test either.
      scoring,
    } : null,
    flagged: priced.filter((r) => r.flagged).length,
    holdings: priced.length,
    oos: {
      trainWeeks: priced[0].oos.trainWeeks,
      testWeeks: priced[0].oos.testWeeks,
      meanDeltaR2: mean(priced.map((r) => r.oos.deltaR2)),
      holdings: priced.length,
      se: oosSe.se,
      ci90: [oosSe.lo, oosSe.hi],
      draws: oosSe.draws,
      blockWeeks: oosSe.blockWeeks,
      refit: { se: oosRefit.book.se, ci90: [oosRefit.book.lo, oosRefit.book.hi], draws: oosRefit.draws, blockWeeks: oosRefit.blockWeeks },
      scoring,
      cadence,
    },
    placebo: {
      draws: placebo.draws,
      seed: placebo.seed,
      minShift: placebo.minShift,
      real: placebo.real,
      p: placebo.p,
      placeboMean: placebo.placeboMean,
      placeboP95: placebo.placeboP95,
    },
    permutation: {
      draws: permutation.draws,
      seed: permutation.seed,
      real: permutation.real,
      p: permutation.p,
      placeboMean: permutation.placeboMean,
      placeboP95: permutation.placeboP95,
      blockWeeks: permutation.blockWeeks,
      pBlocked: permutation.pBlocked,
      blockedMean: permutation.blockedMean,
    },
  };
}

const primaryDates = prices.window.alignedDates;
const primary = runPass(primaryDates, (t) => prices.symbols[t]?.returns ?? null, { keepSeries: true });
const va = summarise(primary, primaryDates);

// Durability check on the revision cut: the same estimator, same code, on the
// same window with the four revision weeks kept in. If the headline moved a lot,
// the cut would be doing the work and the desk would be hiding it.
let revisionSensitivity = null;
if (revisionSet.size) {
  const pass = runPass(rawPrimary.dates, (t) => rawPrimary.returns[t] ?? null);
  const s = summarise(pass, rawPrimary.dates);
  revisionSensitivity = {
    weeks: rawPrimary.dates.length,
    keptWeeks: revisions.map((r) => r.date),
    meanDeltaR2: s.meanDeltaR2,
    oos: s.oos.meanDeltaR2,
    oosCi: s.oos.ci90,
    placeboP: s.placebo.p,
    placeboMean: s.placebo.placeboMean,
    real: s.placebo.real,
    flagged: s.flagged,
    factorSparsity: pass.factorSparsity,
    note: "same estimator on the same window with the revision weeks kept in; the desk's headline uses the cut calendar, this is what dropping the cut would have produced",
  };
  console.log(`Revision sensitivity (cut dropped, ${rawPrimary.dates.length} weeks): OOS ${s.oos.meanDeltaR2.toFixed(4)}, placebo p ${s.placebo.p.toFixed(3)}, ${s.flagged} flagged`);
}

const rows = primary.rows;
const priced = rows.filter((r) => r.status === "ok");

// The roster never shrinks. A name that resolved to no Qloo entity still keeps a
// row, with its market half measured from prices and its cultural column withheld,
// because dropping it would hide which names the factor could not reach.
const marketReturns = prices.symbols[book.index.ticker].returns;

// Why a name failed to resolve is data, not narrative: the resolver already
// records every query it sent and how many candidates each returned. A name that
// came back empty on every query is a coverage gap in the index; a name that came
// back with candidates but no boundary match is a string the index does not carry
// under that name. Both are printed so "unresolved" cannot read as a broken
// pipeline, and the number of queries tried is printed with them because a single
// query is a limit on the search, not a proof the brand is absent.
function resolutionOf(u) {
  const attempts = Array.isArray(u.attempts) ? u.attempts : [];
  const queriesTried = attempts.map((a) => a.query);
  const candidatesSeen = attempts.reduce((n, a) => n + (a.results ?? 0), 0);
  const corporate = attempts.some((a) => /\b(corporation|corp|incorporated|inc|industries|holdings|group|company|co)\W*$/i.test(String(a.query)));
  const failure = candidatesSeen === 0
    ? "no listing"
    : corporate
      ? "company name, not a brand string"
      : "no name match";
  return { queriesTried, candidatesSeen, failure };
}

for (const u of unresolved) {
  const base = {
    ticker: u.ticker,
    label: u.label,
    sector: u.sector,
    sectorLabel: universe.sectors.find((s) => s.id === u.sector)?.label ?? u.sector,
    featured: false,
    qlooEntityId: null,
    query: u.query,
    resolution: resolutionOf(u),
  };
  const y = prices.symbols[u.ticker]?.returns ?? null;
  if (!y) {
    rows.push({ ...base, status: "no prices", weeks: 0, marketBeta: null, culturalBeta: null, note: "no fully aligned weekly prices for this ticker in the window" });
    continue;
  }
  const mkt = ols(y, [marketReturns]);
  rows.push({
    ...base,
    status: "unresolved",
    weeks: y.length,
    marketBeta: mkt.beta[1], marketSE: mkt.se[1], marketT: mkt.t[1], marketP: mkt.p[1],
    culturalBeta: null, culturalSE: null, culturalT: null, culturalP: null,
    activeWeeks: 0,
    flagged: false,
    note: `no Qloo brand entity resolved for query "${u.query}" (${base.resolution.failure}, ${base.resolution.queriesTried.length} ${base.resolution.queriesTried.length === 1 ? "query" : "queries"} tried, ${base.resolution.candidatesSeen} candidates seen) — the cultural beta is withheld rather than guessed`,
    provenance: { prices: "fixtures/prices.json" },
  });
}

// Audience-level reading for the featured names: their own basket, never the
// sector one, reported beside the comparable number rather than replacing it.
for (const r of priced.filter((x) => x.featured && cultural.ownTaste[x.ticker])) {
  const y = prices.symbols[r.ticker].returns;
  const idx = prices.symbols[book.index.ticker].returns;
  const own = alignTaste(cultural.ownTaste[r.ticker], primaryDates);
  if (own.some((v) => v === null)) continue;
  const reg = ols(y, [idx, own]);
  const mkt = ols(y, [idx]);
  r.audience = {
    culturalBeta: reg.beta[2], culturalSE: reg.se[2], culturalT: reg.t[2], culturalP: reg.p[2],
    deltaR2: reg.r2 - mkt.r2,
    oos: outOfSample({ y, x: idx, basket: own }),
    members: cultural.ownBaskets[r.ticker].map((m) => ({ name: m.name, type: m.type, weight: m.weight })),
    provenance: `fixtures/qloo/basket-${r.ticker}.json`,
  };
}

// Pooled reading, added after the first external review: the per-name fit is
// identified on a handful of moving weeks each, so the same variation is also
// read through one slope per sub-sector with name fixed effects and week-clustered
// errors. It is labelled post-hoc everywhere it appears, because it is.
const sectorOf = new Map(rows.map((r) => [r.ticker, r.sector]));
const panelItems = primary.fits.map((f) => ({ ticker: f.ticker, sector: sectorOf.get(f.ticker), y: f.y, x: f.x, basket: f.basket }));
const pooled = priced.length > 5 ? pooledPanel(panelItems) : null;
if (pooled) {
  const strongest = [...pooled.sectors].sort((a, b) => Math.abs(b.t) - Math.abs(a.t))[0];
  console.log(`Pooled panel: within ΔR² ${pooled.deltaR2.toFixed(4)} over market-only, permutation p ${pooled.null.p.toFixed(3)}; strongest sub-sector ${strongest.id} ${strongest.beta.toFixed(2)} (t ${strongest.t.toFixed(2)})`);
}
// The same panel with each name's own market loading, so the common-slope
// restriction is removed rather than assumed.
const pooledNameMarket = priced.length > 5 ? panelNameMarket(panelItems) : null;
if (pooledNameMarket) {
  const strongest = [...pooledNameMarket.sectors].sort((a, b) => Math.abs(b.t) - Math.abs(a.t))[0];
  console.log(`Per-name market loadings: within ΔR² ${pooledNameMarket.deltaR2.toFixed(4)}, permutation p ${pooledNameMarket.null.p.toFixed(3)}, loadings ${pooledNameMarket.market.min.toFixed(2)}-${pooledNameMarket.market.max.toFixed(2)} (sd ${pooledNameMarket.market.sd.toFixed(2)}); strongest ${strongest.id} ${strongest.beta.toFixed(2)} (t ${strongest.t.toFixed(2)})`);
}

// A zero mean beta and a zero spread are different findings, and the book-number
// tests cannot tell them apart. This reads the per-name slopes directly.
const dispersion = priced.length > 2
  ? betaDispersion(primary.fits.map((f) => ({ ticker: f.ticker, y: f.y, x: f.x, basket: f.basket })))
  : null;
if (dispersion) {
  console.log(`Dispersion: cross-sectional var ${dispersion.variance.toFixed(3)}, sampling var ${dispersion.samplingVariance.toFixed(3)}, excess ${dispersion.excess.toFixed(3)}, rotation null mean ${dispersion.nullMean.toFixed(3)}, p ${dispersion.p.toFixed(3)} / pLow ${dispersion.pLow.toFixed(3)} -> ${dispersion.readsAs}`);
  console.log(`Dispersion power: ${dispersion.power.map((r) => `sd ${r.sd} -> ${(r.power * 100).toFixed(0)}%`).join(", ")}${dispersion.detectable ? `; 80% power at sd ${dispersion.detectable.sd}` : "; no planted spread in the grid reaches 80% power"}`);
  console.log(`Dispersion at the observed spread: sd ${dispersion.observedSd.toFixed(1)} -> ${(dispersion.powerObserved * 100).toFixed(0)}% detection (${dispersion.informative ? "informative" : "uninformative — the test could not have seen a spread this size"})`);
  console.log(`Dispersion benchmark gap: analytic mean se² ${dispersion.samplingVariance.toFixed(0)} vs null mean ${dispersion.nullMean.toFixed(0)} (${(dispersion.benchmarkGap * 100).toFixed(0)}%); inside the null mean se² ${dispersion.nullSamplingVariance.toFixed(0)} vs cross-sectional variance ${dispersion.nullMean.toFixed(0)} (${(dispersion.gapInNull * 100).toFixed(0)}%)`);
}
if (va?.oos?.scoring) {
  const s = va.oos.scoring;
  console.log(`Scored weeks: ${s.medianActive} of ${s.testWeeks} move for the median name (${s.minActive}-${s.maxActive}); ${s.frozenWeeks} frozen for every name${s.frozenFrom ? ` from ${s.frozenFrom}` : ""}; last revision ${s.lastMove ?? "none"}, ${s.frozenAfterWindow} frozen weeks after it; testable=${s.testable}`);
}
if (va?.oos?.cadence) {
  const c = va.oos.cadence;
  console.log(`Cadence-aligned diagnostic (${c.start} → ${c.end}, ${c.trainWeeks}/${c.testWeeks}): mean ${(c.mean * 100).toFixed(2)} pts, median ${(c.median * 100).toFixed(2)}, ${Math.round(c.sharePositive * 100)}% positive, range ${(c.min * 100).toFixed(1)} to ${(c.max * 100).toFixed(1)}; ${c.activeMedian} active test weeks`);
}
if (va?.ablation?.qlooVsPeer) {
  const q = va.ablation.qlooVsPeer;
  console.log(`Qloo vs peer baskets: mean correlation ${q.meanCorr.toFixed(2)} (${q.minCorr.toFixed(2)} to ${q.maxCorr.toFixed(2)}); the taste basket moves in a mean ${q.meanActive.toFixed(0)} of ${q.weeks} weeks`);
}

console.log(`Priced ${priced.length}/${rows.length} resolved names (${unresolved.length} unresolved at entity resolution)`);
for (const r of rows.filter((x) => x.status !== "ok")) console.log(`${r.ticker}: ${r.status.toUpperCase()} — ${r.note ?? ""}`);
for (const r of priced.filter((x) => x.flagged)) console.log(`${r.ticker}: FLAG ${r.culturalBeta.toFixed(2)} (t ${r.culturalT.toFixed(2)}, q ${r.culturalQ.toFixed(3)})`);

// The replication slice, pre-registered in config/book.json. The cohort is every
// name with prices in both windows: a delisted ticker drops out of the second pass
// rather than cancelling it for the whole book.
let second = null;
let secondarySkip = null;
if (prices.priorWindow && priced.length) {
  const priorDates = prices.priorWindow.alignedDates;
  const withPrior = names.filter((n) => prices.symbols[n.ticker]?.priorReturns);
  const absent = names.filter((n) => !prices.symbols[n.ticker]?.priorReturns).map((n) => n.ticker);
  if (withPrior.length < Math.ceil(names.length * 0.7)) {
    secondarySkip = `only ${withPrior.length}/${names.length} names have prior-window prices`;
    console.log(`Second window NOT run: ${secondarySkip}.`);
  } else {
    if (absent.length) console.log(`Second window cohort: ${withPrior.length}/${names.length} names (no prior prices: ${absent.join(", ")}).`);
    const pass = runPass(priorDates, (t) => prices.symbols[t]?.priorReturns ?? null, { cohort: withPrior });
    second = summarise(pass, priorDates);
    for (const r of rows) {
      const s = pass.rows.find((x) => x.ticker === r.ticker);
      if (s?.status === "ok") {
        r.secondary = {
          culturalBeta: s.culturalBeta, culturalSE: s.culturalSE, culturalT: s.culturalT, culturalP: s.culturalP,
          culturalQ: s.culturalQ, deltaR2: s.deltaR2, oos: s.oos, flagged: s.flagged, placeboP: s.placeboP, weeks: s.weeks,
        };
      }
    }
    if (second) {
      second.replicates = second.oos.meanDeltaR2 > 0 && second.placebo.p <= book.secondWindow.rule.placeboP;
      console.log(`Second window ${second.window.start} -> ${second.window.end}: OOS ${second.oos.meanDeltaR2.toFixed(4)}, placebo p ${second.placebo.p.toFixed(3)} — ${second.replicates ? "replicates" : "does not replicate"}`);
    } else {
      // Prices cover the whole slice, but Qloo's level history only reaches part of
      // it, so no name clears the sample floor. Said out loud: a silent null in this
      // slot reads as "no replication" when the truth is "not testable".
      const worst = pass.rows.filter((r) => r.status !== "ok").slice(0, 3).map((r) => `${r.ticker} ${r.weeks}/${priorDates.length} weeks`);
      secondarySkip = `every name is below the ${book.minTrendingWeeks}-week floor on this slice — Qloo's levels cover ${Math.max(0, ...pass.rows.map((r) => r.weeks ?? 0))} of its ${priorDates.length} weeks (${worst.join(", ")})`;
      console.log(`Second window NOT priced: ${secondarySkip}. The pre-registration stays in config/book.json; the desk reports it as untestable rather than as a failure to replicate.`);
    }
  }
}

const sectors = universe.sectors.map((s) => {
  const inSector = rows.filter((r) => r.sector === s.id);
  const ok = inSector.filter((r) => r.status === "ok");
  return {
    id: s.id, label: s.label,
    names: inSector.length,
    priced: ok.length,
    flagged: ok.filter((r) => r.flagged).length,
    meanDeltaR2: ok.length ? mean(ok.map((r) => r.deltaR2)) : null,
    meanOos: ok.length ? mean(ok.map((r) => r.oos.deltaR2)) : null,
  };
});

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, "desk.json"), JSON.stringify({
  window: { ...prices.window, weeks: prices.window.alignedDates.length },
  priorWindow: prices.priorWindow ? { ...prices.priorWindow, weeks: prices.priorWindow.alignedDates.length } : null,
  dataQuality: {
    revisionWeeks: revisions,
    revisionSensitivity,
    cutFromPrimary: revisionCuts.primary,
    cutFromPrior: revisionCuts.prior,
    rule: "Qloo revises its catalogue wholesale on a few dates, and every entity's percentile steps at once — measured median move 0.188-0.262 in log units on those weeks against 0.0007 on a normal week. A weekly taste return taken across such a step is an index rescaling, not cultural movement, so those weeks are cut from both windows rather than dummied out. Both price windows are cut on the same dates, so every series keeps one calendar.",
  },
  factorConstruction: "basket = affinity-weighted blend of the non-holding entities Qloo recommends from the resolved entities of each sub-sector's audience (brand, movie, artist, tv_show; every name in the universe excluded by construction); each member's weekly taste return = ln(population_percentile_t / population_percentile_{t-1}) from Qloo /v2/trending, averaged within a week, with a missing adjacent week producing no observation; regression per name: weekly return ~ SPY return + sector basket return over " + primaryDates.length + " aligned weeks. One factor, " + names.length + " names, so the call count grows with sectors rather than with the book. Featured names additionally carry an audience-level basket built from their own entity. The same estimator is re-run unchanged on the " + (prices.priorWindow?.alignedDates.length ?? 0) + " weekly returns immediately before that window.",
  index: book.index,
  universe: {
    total: universe.names.length,
    resolved: names.length,
    priced: priced.length,
    unresolved: unresolved.map((u) => ({ ticker: u.ticker, label: u.label, query: u.query, sector: u.sector, resolution: resolutionOf(u) })),
    sectors,
  },
  flagRule: { absT, qMax, method: "negative beta, |t| >= " + absT + ", Benjamini-Hochberg q <= " + qMax + " across priced names" },
  factorSparsity: primary.factorSparsity,
  rows,
  valueAdd: {
    note: "mean in-sample gain in r² from adding the taste basket to the market regression, in percentage points",
    meanDeltaR2: va?.meanDeltaR2 ?? null,
    meanMarketR2: va?.meanMarketR2 ?? null,
    meanFullR2: va?.meanFullR2 ?? null,
    medianAbsCulturalT: va?.medianAbsCulturalT ?? null,
    holdings: priced.length,
    ablation: va?.ablation ?? null,
    sentiment: va?.sentiment ?? null,
    oos: va ? {
      note: "same nested comparison, fitted on the first " + va.oos.trainWeeks + " weeks and scored on the last " + va.oos.testWeeks + "; not clamped",
      trainWeeks: va.oos.trainWeeks,
      testWeeks: va.oos.testWeeks,
      meanDeltaR2: va.oos.meanDeltaR2,
      holdings: priced.length,
      se: va.oos.se ?? null,
      ci90: va.oos.ci90 ?? null,
      draws: va.oos.draws ?? null,
      blockWeeks: va.oos.blockWeeks ?? null,
      refit: va.oos.refit ?? null,
      scoring: va.oos.scoring ?? null,
      cadence: va.oos.cadence ?? null,
    } : null,
    placebo: va ? {
      note: "book mean ΔR² against " + va.placebo.draws + " circular rotations of the taste baskets, all names shifted together; p is the share of rotations that match or beat the real alignment",
      draws: va.placebo.draws,
      seed: va.placebo.seed,
      minShift: va.placebo.minShift,
      real: va.placebo.real,
      p: va.placebo.p,
      placeboMean: va.placebo.placeboMean,
      placeboP95: va.placebo.placeboP95,
    } : null,
    permutation: va ? {
      note: "book mean ΔR² against " + va.permutation.draws + " permutations of the date order of the taste baskets, one shared shuffle per draw; unlike the rotation null it keeps each basket's own distribution and destroys only its timing",
      draws: va.permutation.draws,
      seed: va.permutation.seed,
      real: va.permutation.real,
      p: va.permutation.p,
      placeboMean: va.permutation.placeboMean,
      placeboP95: va.permutation.placeboP95,
      blockWeeks: va.permutation.blockWeeks,
      pBlocked: va.permutation.pBlocked,
      blockedMean: va.permutation.blockedMean,
    } : null,
    secondary: second ? {
      note: "pre-registered replication: the same estimator and threshold on the " + second.window.weeks + " weekly returns immediately before the primary window, fixed in config/book.json before the keyed run",
      window: second.window,
      meanDeltaR2: second.meanDeltaR2,
      medianAbsCulturalT: second.medianAbsCulturalT,
      flagged: second.flagged,
      oos: second.oos,
      placebo: second.placebo,
      ablation: second.ablation,
      sentiment: second.sentiment,
      rule: book.secondWindow.rule,
      replicates: second.replicates,
    } : null,
    pooled,
    pooledNameMarket: pooledNameMarket ? {
      note: pooledNameMarket.note,
      names: pooledNameMarket.names,
      obs: pooledNameMarket.obs,
      weeks: pooledNameMarket.weeks,
      sectors: pooledNameMarket.sectors,
      market: pooledNameMarket.market,
      withinR2: pooledNameMarket.withinR2,
      deltaR2: pooledNameMarket.deltaR2,
      null: pooledNameMarket.null,
      ridge: pooledNameMarket.ridge,
    } : null,
    dispersion: dispersion ? {
      note: dispersion.note,
      names: dispersion.names,
      weeks: dispersion.weeks,
      variance: dispersion.variance,
      samplingVariance: dispersion.samplingVariance,
      excess: dispersion.excess,
      ratio: dispersion.ratio,
      draws: dispersion.draws,
      seed: dispersion.seed,
      minShift: dispersion.minShift,
      nullMean: dispersion.nullMean,
      nullP95: dispersion.nullP95,
      nullP05: dispersion.nullP05,
      p: dispersion.p,
      pLow: dispersion.pLow,
      readsAs: dispersion.readsAs,
      threshold: dispersion.threshold,
      power: dispersion.power,
      powerWorlds: dispersion.powerWorlds,
      detectable: dispersion.detectable,
      observedSd: dispersion.observedSd,
      powerObserved: dispersion.powerObserved,
      informative: dispersion.informative,
      benchmarkGap: dispersion.benchmarkGap,
      nullSamplingVariance: dispersion.nullSamplingVariance,
      gapInNull: dispersion.gapInNull,
    } : null,
    secondarySkip,
  },
  sampleFloor: { usable: priced.length, total: rows.length, floor: book.minTrendingWeeks },
  source: {
    kind: stubRun ? "stub harness" : "qloo harness",
    note: stubRun
      ? "layout exercise through the real pipeline — magnitudes are not a Qloo result"
      : "computed from cached Qloo responses under fixtures/qloo/",
  },
  pricesSource: prices.source,
}, null, 1));
writeFileSync(resolve(OUT, "series.json"), JSON.stringify(primary.seriesOut));
console.log(`Saved desk.json (${priced.length}/${rows.length} priced) -> ${OUT}`);
