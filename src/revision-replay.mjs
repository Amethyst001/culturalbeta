// Vintage replay around a real Qloo catalogue revision.
//
// The desk's defence of the live gate has always been that a revision reprices
// the book. This module reconstructs that claim on data that actually exists:
// the same cached population_percentile levels, the same affinity-weighted
// sub-sector baskets, the same two-factor OLS, run twice — once on the weeks
// available before Qloo's last revision (through 2025-12-01) and once on the
// committed post-revision window. Nothing here is simulated or synthesised.
//
// The estimator is not reimplemented. Baskets come from src/factor.mjs
// (tasteSeries/blendBasket through loadCulturalInputs), the per-name fit is
// src/ols.mjs, and the book-wide correction is src/multiplicity.mjs. What this
// file adds is only the vintage split, the book-wide q for the earlier vintage,
// and the before/after comparison. A post-revision name must reproduce the
// committed desk beta exactly; callers can check that with verifyCommittedBetas.
import { ols } from "./ols.mjs";
import { alignTaste, revisionWeeks } from "./factor.mjs";
import { benjaminiHochberg } from "./multiplicity.mjs";

export const REVISION_WEEK = "2025-12-22";
export const PRE_THROUGH = "2025-12-01";

// A cultural return is only identified when the basket actually moves. A basket
// that is constant over the window would make the taste column collinear with
// the intercept, so fitName returns null rather than letting ols solve a
// singular system or, worse, reporting a slope off rounding noise. The 1e-12
// floor is the same "active week" threshold compute-betas.mjs uses.
const MIN_BASKET_SPAN = 1e-12;

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Linear-interpolated empirical quantile (the usual numpy default), so p90 is
// reproducible from the same movers array a reader can see in the artifact.
export function quantile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const w = idx - lo;
  return s[lo] * (1 - w) + s[hi] * w;
}

// ISO dates sort lexically, so no Date parsing is needed. Revision weeks are
// cut by the pipeline's own detected set; the `through` boundary is inclusive.
export function vintageDates(alignedDates, through, revisionDates = []) {
  const cut = new Set(revisionDates);
  return alignedDates.filter((d) => d <= through && !cut.has(d));
}

// Returns aligned to their own date, not to a position in the price file: the
// committed window drops revision weeks, so an index-based slice would silently
// read the wrong return after the first cut.
function returnsByDate(prices) {
  const aligned = prices?.window?.alignedDates ?? [];
  const out = new Map();
  for (const [ticker, symbol] of Object.entries(prices?.symbols ?? {})) {
    const returns = symbol?.returns;
    if (!Array.isArray(returns)) continue;
    if (returns.length !== aligned.length) {
      throw new Error(`prices: ${ticker} has ${returns.length} returns for ${aligned.length} aligned dates`);
    }
    out.set(ticker, new Map(aligned.map((d, i) => [d, returns[i]])));
  }
  return out;
}

// One name, one window. Reused unchanged for both vintages: the only difference
// between the two fits is which dates the caller hands in.
export function fitName(y, x, basket) {
  const n = y.length;
  if (!n || x.length !== n || basket.length !== n) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(y[i]) || !Number.isFinite(x[i]) || !Number.isFinite(basket[i])) return null;
    if (basket[i] < lo) lo = basket[i];
    if (basket[i] > hi) hi = basket[i];
  }
  if (!(hi - lo > MIN_BASKET_SPAN)) return null;
  let market;
  let full;
  try {
    market = ols(y, [x]);
    full = ols(y, [x, basket]);
  } catch {
    // A constant market column or an otherwise singular design is not a fit.
    return null;
  }
  return {
    beta: full.beta[2],
    se: full.se[2],
    t: full.t[2],
    p: full.p[2],
    r2: full.r2,
    r2Market: market.r2,
    deltaR2: full.r2 - market.r2,
    weeks: n,
  };
}

// One vintage over the committed priced cohort. The cohort is passed in rather
// than rebuilt from the window: the pre-revision vintage is shorter and cannot
// clear the desk's 100-week sample floor, so names are not re-selected on a
// window-length artefact. A name that cannot be fitted is left out and counted,
// never zero-filled.
export function fitVintage({ names, dates, returns, taste, indexTicker, flagRule, minWeeks = 0 }) {
  const index = returns.get(indexTicker);
  if (!index) throw new Error(`no ${indexTicker} returns in the supplied window`);
  const rule = {
    absT: flagRule?.absT ?? 2,
    qMax: flagRule?.qMax ?? 0.1,
    negativeOnly: flagRule?.negativeOnly ?? true,
  };
  const fits = [];
  const skipped = [];
  for (const name of names) {
    const ret = returns.get(name.ticker);
    if (!ret) { skipped.push({ ticker: name.ticker, reason: "no prices" }); continue; }
    const y = dates.map((d) => ret.get(d));
    const x = dates.map((d) => index.get(d));
    if (y.some((v) => v === undefined) || x.some((v) => v === undefined)) {
      skipped.push({ ticker: name.ticker, reason: "price gap" });
      continue;
    }
    if (dates.length < minWeeks) {
      skipped.push({ ticker: name.ticker, reason: `only ${dates.length} weeks < floor ${minWeeks}` });
      continue;
    }
    const basket = alignTaste(taste[name.ticker] ?? new Map(), dates);
    if (basket.some((v) => v === null)) {
      skipped.push({ ticker: name.ticker, reason: "basket gap" });
      continue;
    }
    const fit = fitName(y, x, basket);
    if (!fit) {
      skipped.push({ ticker: name.ticker, reason: "no basket variation" });
      continue;
    }
    fits.push({ ticker: name.ticker, sector: name.sector, ...fit, activeWeeks: basket.filter((v) => Math.abs(v) > MIN_BASKET_SPAN).length });
  }
  if (fits.length) {
    const qs = benjaminiHochberg(fits.map((f) => f.p));
    fits.forEach((f, i) => {
      f.q = qs[i];
      f.flag = (!rule.negativeOnly || f.beta < 0) && Math.abs(f.t) >= rule.absT && f.q <= rule.qMax;
    });
  }
  const flags = fits
    .filter((f) => f.flag)
    .map((f) => ({ ticker: f.ticker, sector: f.sector, beta: f.beta, t: f.t, q: f.q }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
  return { dates, weeks: dates.length, fits, skipped, flags, flagCount: flags.length, rule };
}

// Names present in both vintages. deltaBeta is after minus before; the sign is
// stated here because a mover table read without it can invert the story.
export function moversBetween(before, after) {
  const afterBy = new Map(after.fits.map((f) => [f.ticker, f]));
  const movers = [];
  for (const b of before.fits) {
    const a = afterBy.get(b.ticker);
    if (!a) continue;
    movers.push({
      ticker: b.ticker,
      sector: b.sector,
      betaBefore: b.beta,
      betaAfter: a.beta,
      deltaBeta: a.beta - b.beta,
      tBefore: b.t,
      tAfter: a.t,
      deltaR2Before: b.deltaR2,
      deltaR2After: a.deltaR2,
      flagBefore: b.flag,
      flagAfter: a.flag,
      flipped: b.flag !== a.flag,
    });
  }
  movers.sort((x, y) => Math.abs(y.deltaBeta) - Math.abs(x.deltaBeta) || x.ticker.localeCompare(y.ticker));
  return movers;
}

export function summariseMovers(movers) {
  const abs = movers.map((m) => Math.abs(m.deltaBeta));
  const flips = movers.filter((m) => m.flipped);
  return {
    namesCompared: movers.length,
    medianAbsDeltaBeta: median(abs),
    p90AbsDeltaBeta: quantile(abs, 0.9),
    maxAbsDeltaBeta: abs.length ? Math.max(...abs) : null,
    flips: flips.length,
    flipTickers: flips.map((m) => m.ticker).sort((a, b) => a.localeCompare(b)),
  };
}

// The post-revision reconstruction must reproduce the committed per-name betas
// from output/desk.json, otherwise the "before" side is not comparable with the
// desk and the replay proves nothing. Exact equality is expected because both
// sides run the same ols on the same returns and the same aligned basket.
export function verifyCommittedBetas(after, deskRows) {
  const committed = new Map((deskRows ?? []).filter((r) => r.status === "ok").map((r) => [r.ticker, r]));
  const rows = [];
  for (const fit of after.fits) {
    const row = committed.get(fit.ticker);
    if (!row || typeof row.culturalBeta !== "number") continue;
    rows.push({
      ticker: fit.ticker,
      betaDiff: Math.abs(fit.beta - row.culturalBeta),
      tDiff: Math.abs(fit.t - row.culturalT),
      deltaR2Diff: Math.abs(fit.deltaR2 - row.deltaR2),
    });
  }
  return {
    checked: rows.length,
    maxBetaDiff: rows.length ? Math.max(...rows.map((r) => r.betaDiff)) : null,
    maxTDiff: rows.length ? Math.max(...rows.map((r) => r.tDiff)) : null,
    maxDeltaR2Diff: rows.length ? Math.max(...rows.map((r) => r.deltaR2Diff)) : null,
    rows,
  };
}

// Basket-level cross-check against the committed output/series.json. The taste
// maps are rebuilt from the cached levels; output/series.json carries the
// aligned basket the committed run actually used for the featured names. Zero
// difference means the replay is the same factor, not a lookalike.
export function verifyCommittedBaskets(cultural, committedSeries, dates) {
  const rows = [];
  for (const [ticker, entry] of Object.entries(committedSeries ?? {})) {
    const committed = entry?.basket;
    if (!Array.isArray(committed) || committed.length !== dates.length) continue;
    const rebuilt = alignTaste(cultural?.taste?.[ticker] ?? new Map(), dates);
    let maxAbsDiff = 0;
    let mismatched = 0;
    for (let i = 0; i < dates.length; i++) {
      const a = rebuilt[i];
      const b = committed[i];
      if (a === null || a === undefined || b === null || b === undefined) {
        if (a !== b) mismatched++;
        continue;
      }
      maxAbsDiff = Math.max(maxAbsDiff, Math.abs(a - b));
    }
    rows.push({ ticker, weeks: dates.length, maxAbsDiff, mismatched, exact: maxAbsDiff === 0 && mismatched === 0 });
  }
  return {
    checked: rows.length,
    exact: rows.filter((r) => r.exact).length,
    rows,
  };
}

const METHOD = "This is a replay of the real 2025-12-22 Qloo catalogue revision, not a simulation and not synthetic Qloo data: the taste baskets are rebuilt with the committed estimator (weekly ln difference of population_percentile, affinity-weighted inside each sub-sector) from the same cached Qloo levels, and the post-revision side is the committed 102-week aligned panel. The pre-revision vintage re-fits the identical two-factor OLS (weekly return ~ SPY return + sector basket return) on the 55 aligned weeks through 2025-12-01, with the four catalogue revisions the pipeline's own rule detects (2025-04-07, 2025-04-14, 2025-10-13, 2025-10-20) cut from both sides the same way. Every name priced by the committed desk is re-estimated in both vintages, so the Benjamini-Hochberg q is recomputed across the whole book in each vintage and is honest rather than a subset correction; the flag rule is the desk's own (cultural beta < 0, |t| >= 2, q <= 0.10). The pre-revision vintage has fewer weeks (55 versus 102) and cannot clear the desk's 100-week sample floor, so the cohort is held fixed to the committed priced names and no name is added or dropped because of the shorter window. Movers are ranked by |Δβ|, with Δβ defined as the post-revision beta minus the pre-revision beta. Two integrity checks are run: the post-vintage betas must equal output/desk.json exactly, and the rebuilt featured baskets must equal output/series.json exactly.";

const CAVEAT = "This comparison cannot separate the revision effect from sample length and sample composition: 55 weeks ending 2025-12-01 versus 102 weeks ending 2026-10-26 differ in length, in which earlier revisions are cut, and in the price regime, so a beta movement is not attributable to the 2025-12-22 revision alone. It also cannot separate a revision effect from ordinary sampling noise: the taste factor is identified only on the weeks the basket actually moves, the shorter vintage has fewer active weeks and wider standard errors, and the largest absolute changes are concentrated in names whose basket variance is tiny (betas in the tens or hundreds), where a small denominator makes the slope unstable. The pipeline's own revisionWeeks() rule does not flag 2025-12-22 as a wholesale revision (the median move across all 115 cached entities that week is zero); the date is the last week any basket return is non-zero, recorded by the desk's scoring diagnostic, and it remains inside the committed post-revision window because that is the window the desk published. The replay therefore demonstrates repricing in the point estimates, and with no flags and no flips on either side it does not establish that the revision changed a desk conclusion.";

// The replay plus the two full vintage fits. Callers that only want the
// artifact use buildReplay; the CLI uses this form so it can verify the fits
// against the committed desk before writing anything.
export function computeReplay({ desk, prices, cultural, book, revisionDates, generatedAt = new Date().toISOString() }) {
  if (!desk?.window?.alignedDates?.length) throw new Error("revision-replay: desk.window.alignedDates is required");
  if (!prices?.window?.alignedDates?.length) throw new Error("revision-replay: prices.window.alignedDates is required");
  const revisions = revisionDates ?? revisionWeeks(cultural?.series ?? {}, book?.tasteSignal).map((r) => r.date);
  const beforeDates = vintageDates(prices.window.alignedDates, PRE_THROUGH, revisions);
  const afterDates = [...desk.window.alignedDates];
  if (beforeDates.length && beforeDates.at(-1) > PRE_THROUGH) {
    throw new Error("revision-replay: pre-revision window leaked past its cut-off");
  }
  const returns = returnsByDate(prices);
  const cohort = (desk.rows ?? [])
    .filter((r) => r.status === "ok")
    .map((r) => ({ ticker: r.ticker, sector: r.sector }));
  const rule = { absT: book?.flagRule?.absT ?? 2, qMax: book?.flagRule?.qMax ?? 0.1, negativeOnly: book?.flagRule?.negativeOnly ?? true };
  const common = { names: cohort, returns, taste: cultural?.taste ?? {}, indexTicker: book.index.ticker, flagRule: rule };
  // minWeeks is zero on the pre-revision vintage on purpose: applying the
  // committed 100-week floor to a 55-week sample would silently empty the book.
  const before = fitVintage({ ...common, dates: beforeDates, minWeeks: 0 });
  const after = fitVintage({ ...common, dates: afterDates, minWeeks: book?.minTrendingWeeks ?? 0 });
  const movers = moversBetween(before, after);
  const summary = summariseMovers(movers);
  const replay = {
    generatedAt,
    revisionWeek: REVISION_WEEK,
    vintageBefore: {
      through: PRE_THROUGH,
      weeks: before.weeks,
      priced: before.fits.length,
      flags: before.flags,
      flagCount: before.flagCount,
    },
    vintageAfter: {
      through: afterDates.at(-1) ?? desk.window.end ?? null,
      weeks: after.weeks,
      priced: after.fits.length,
      flags: after.flags,
      flagCount: after.flagCount,
    },
    movers,
    summary,
    method: METHOD,
    caveat: CAVEAT,
  };
  return { replay, before, after, revisions };
}

export function buildReplay(args) {
  return computeReplay(args).replay;
}
