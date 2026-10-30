// Minimum detectable effect (MDE) for the cultural-beta design. Pure functions:
// no file I/O, no network, no model. Every number is arithmetic on a design that is
// handed in, so the runner can be re-read against the committed panel.
//
// Why this module exists: "we found nothing" and "we could not have found it" are
// different sentences, and the panel printed only the first. The MDE is a property
// of the design (weeks, residual variance, basket variance, the pre-registered
// multiplicity rule), not of the outcome, so publishing it is legitimate. The
// informative-sub-period cut IS post-hoc and is labelled as such everywhere.
//
// Contract written by scripts/mde.mjs to output/mde.json:
// {
//   generatedAt: ISO string,
//   source: { deskRevision: "sha256:<16 hex of output/desk.json>", deskBytes,
//             deskWindow: { start, end, weeks }, inputs: [paths read],
//             qlooRequests: 0,
//             integrity: { rebuiltDesignsMatchPublishedFit, outputSeriesCrossChecked,
//                          entityRosterRows } },
//   method: { design, flagRule, singleDiscoveryLevel, singleDiscoveryLevelRule, tCrit, df, weeks,
//             powerTarget, ncpMDE, mdeDefinition, deltaR2Definition, roundTripCheck,
//             subPeriodCut: { postHoc: true, weeks, cutIndex, lastMovingDate,
//                             firstFrozenDate, frozenWeeks, agreesWithDeskScoringBlock },
//             simulation: { seed, iidDraws, blockDraws, blockWeeks, signalRotation,
//                           arms: { iid, block } },
//             postHocFields: [paths] },
//   preRegistered: { split, flagRule, note },
//   perName: [{ ticker, sector, weeks, df, t_crit, singleDiscoveryLevel, ncpMDE, se,
//               betaMDE, deltaR2MDEpts, partialR2MDEpts, minPartialCorrelation,
//               marketR2, computable, reason?,
//               observed: { beta, t, q, deltaR2Pts, absTvsNcpMDE, powerAtObserved } | null,
//               subPeriod: { weeks, df, t_crit, ncpMDE, se, betaMDE, deltaR2MDEpts,
//                            partialR2MDEpts, marketR2, observedDeltaR2Pts, seVsFull } }, ...],
//   book: { names, medianDeltaR2Pts, iqr: [lo, hi], minDeltaR2Pts, maxDeltaR2Pts,
//           medianBetaMDE, partialR2MDEpts, minPartialCorrelation, tCrit, singleDiscoveryLevel,
//           ncpMDE, df, powerAtMedianObserved,
//           informativeSubPeriod: { ...book fields, postHoc: true, weeks, lastMovingDate,
//                                   firstFrozenDate, frozenWeeks,
//                                   seRatioVsFull: { median, min, max }, note },
//           observed: { meanDeltaR2Pts, flaggedNames,
//                       largestAbsT: { ticker, beta, t, q, deltaR2Pts, powerAtObserved,
//                                      shareOfMde },
//                       largestNegativeAbsT: { same } } },
//   simulation: { seed, draws: { iid, block }, blockWeeks, runtimeMs,
//                 analyticVsSimulated: [{ seeds: { iid, block }, alternative, metric, ncp,
//                                        draws: { iid, block }, analytic, iid, iidCi,
//                                        block, blockCi, analyticMinusIid, meanSignalAbsT,
//                                        blockMeanSignalAbsT, falseFlagRatePerNullName,
//                                        blockDegenerateFits }] },
//   designRequirement: { postHoc: true, targetPower, horizonWeeks, currentWeeks,
//                        medianR2Market, note,
//                        rows: [{ label, deltaR2Pts, r2Market, source, weeks, years,
//                                 multipleOfCurrentPanel, reason }] },
//   frozenSlice: { computable: false, weeks, trainWeeks, nonzeroRegressorWeeks,
//                  sliceStart, sliceEnd, reason, detectionProbability,
//                  nonzeroRegressorWeeksMax, namesWithAnyMovement,
//                  namesWithDesignInformation, powerAtAnyEffect,
//                  workedExample: { ticker, scoredWeeks, nonzeroWeeks,
//                                   basketResidualSsq, observedInSampleDeltaR2Pts } },
//   caveats: [ ... ]
// }
// betaMDE / se are in the desk's raw slope units (a one-unit move of the level-difference
// taste basket), which are only comparable within a sector: the basket scale differs by
// two orders of magnitude across the book. deltaR2MDEpts and partialR2MDEpts are the
// cross-book currencies.

import { tDistP } from "./ols.mjs";
import { benjaminiHochberg } from "./multiplicity.mjs";

export const DEFAULT_POWER_TARGET = 0.8;
const QUADRATURE_NODES = 220;

// ---------------------------------------------------------------- primitives

// Lanczos log-gamma: the only special function needed beyond the t CDF that
// src/ols.mjs already ships.
export function logGamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973462228e-2, -0.5395239384953e-5];
  let xx = x;
  const y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++xx;
  return -tmp + Math.log((2.5066282746310005 * ser) / y);
}

// Regularised lower incomplete gamma P(a, x) by series.
function gammaLower(a, x) {
  if (x <= 0) return 0;
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 0; n < 800; n++) {
    ap++;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

// Upper complement Q(a, x) by continued fraction — computed directly, never as
// 1 - P, so the far tail keeps full precision (the power integral lives there).
function gammaUpper(a, x) {
  if (x <= 0) return 1;
  if (x < a + 1) return 1 - gammaLower(a, x);
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

// P(Z > z) for any sign of z.
export function normalUpperTail(z) {
  const q = 0.5 * gammaUpper(0.5, 0.5 * z * z);
  return z >= 0 ? q : 1 - q;
}

export function normalCdf(z) {
  return 1 - normalUpperTail(z);
}

// Central Student-t critical value whose two-sided p-value is exactly `twoSidedP`.
// Bisection on the t CDF already in src/ols.mjs: no second implementation of the
// same function, so the simulated arm and the analytic arm cannot drift apart by
// disagreeing on the CDF.
export function tQuantile(df, twoSidedP) {
  if (!(df > 0) || !(twoSidedP > 0 && twoSidedP < 1)) throw new Error("tQuantile: df and p must be positive");
  let lo = 0;
  let hi = 60;
  for (let i = 0; i < 160; i++) {
    const mid = (lo + hi) / 2;
    if (tDistP(mid, df) > twoSidedP) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Gauss-Legendre nodes/weights mapped onto [0, 1]; deterministic, no dependencies.
export function gaussLegendre(n) {
  const half = Math.ceil(n / 2);
  const nodes = [];
  const weights = [];
  for (let i = 0; i < half; i++) {
    const t = (Math.PI * (i + 0.75)) / (n + 0.5);
    let z = Math.cos(t);
    let p1;
    let pp;
    for (let it = 0; it < 100; it++) {
      p1 = 1;
      let p2 = 0;
      for (let j = 1; j <= n; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j;
      }
      pp = (n * (z * p1 - p2)) / (z * z - 1);
      const zt = z;
      z = zt - p1 / pp;
      if (Math.abs(z - zt) < 1e-15) break;
    }
    const w = 1 / ((1 - z * z) * pp * pp);
    nodes.push(0.5 * (1 + z), 0.5 * (1 - z));
    weights.push(w, w);
  }
  return { nodes, weights };
}

// Noncentral-t tail for a fixed df, integrated over the chi-square mixing
// variable. T = (Z + ncp) / sqrt(V/df) with V ~ chi2(df) independent of Z, so
//   P(T > c | ncp) = E_V[ Phi(ncp - c*sqrt(V/df)) ].
// Quadrature in v-space rather than in probability space: the chi-square density
// times Phi is smooth, while the quantile transform has a boundary layer at u -> 0
// that Gauss-Legendre cannot resolve. Verified against the degenerate case
// ncp = 0, where the integral must return the test size exactly.
const powerTableCache = new Map();

export function powerTable(df, nodes = QUADRATURE_NODES) {
  const key = `${df}|${nodes}`;
  if (powerTableCache.has(key)) return powerTableCache.get(key);
  const gl = gaussLegendre(nodes);
  const a = df / 2;
  const hi = df + 14 * Math.sqrt(2 * df) + 20;
  const weight = new Float64Array(nodes);
  const scale = new Float64Array(nodes);
  let mass = 0;
  for (let i = 0; i < nodes; i++) {
    const v = gl.nodes[i] * hi;
    const pdf = Math.exp((a - 1) * Math.log(v) - v / 2 - a * Math.LN2 - logGamma(a));
    weight[i] = gl.weights[i] * hi * pdf;
    scale[i] = Math.sqrt(v / df);
    mass += weight[i];
  }
  const table = {
    df,
    nodes,
    mass,
    power(ncp, tCrit) {
      let upper = 0;
      let lower = 0;
      for (let i = 0; i < nodes; i++) {
        upper += weight[i] * normalCdf(ncp - tCrit * scale[i]);
        lower += weight[i] * normalCdf(-ncp - tCrit * scale[i]);
      }
      return { upper, lower, twoSided: upper + lower };
    },
  };
  powerTableCache.set(key, table);
  return table;
}

// The flag rule is one-sided in the effect direction (a negative cultural beta),
// so the power that matters is P(T < -c | ncp = -delta), which by symmetry equals
// the upper tail at +delta. The sign screen costs nothing extra: T < -c already
// implies the fitted beta is negative.
export function flagPower({ df, tCrit, ncp }) {
  return powerTable(df).power(Math.abs(ncp), tCrit).upper;
}

export function solveNcpForPower({ df, tCrit, targetPower = DEFAULT_POWER_TARGET }) {
  if (!(targetPower > 0 && targetPower < 1)) throw new Error("solveNcpForPower: targetPower must be in (0,1)");
  let lo = 0;
  let hi = 40;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (flagPower({ df, tCrit, ncp: mid }) < targetPower) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------- the rule

// Benjamini-Hochberg at q over `tests` hypotheses: a lone discovery sits at rank 1
// and only clears the step-up if p <= q/tests. That is the level a design must be
// powered against when the rest of the book is null, so it is the honest one to
// publish; every other rank has a looser threshold.
export function bhCriticalValue({ tests, qMax, df }) {
  // The Benjamini-Hochberg level a lone discovery must clear, named for what it is.
  const singleDiscoveryLevel = qMax / tests;
  return {
    tests,
    qMax,
    singleDiscoveryLevel,
    tCrit: tQuantile(df, singleDiscoveryLevel),
    rule: `Benjamini-Hochberg q <= ${qMax} across ${tests} priced names; a lone signal must clear p <= ${singleDiscoveryLevel}`,
  };
}

// ---------------------------------------------------------------- conversions

// Partial R-squared of the taste regressor after SPY: the exact identity
// (SSE_market - SSE_full) / SSE_market = t^2 / (t^2 + df), no approximation.
export function partialR2FromT(t, df) {
  const v = (t * t) / (t * t + df);
  return v;
}

export function tFromPartialR2(partialR2, df) {
  if (partialR2 < 0 || partialR2 >= 1) throw new Error("tFromPartialR2: partial R-squared must be in [0,1)");
  return Math.sqrt(partialR2 / (1 - partialR2) * df);
}

// The desk's headline currency is the raw increment r2_full - r2_market, so the
// MDE is published in the same currency: increment = (1 - r2_market) * partial R2.
export function deltaR2FromT({ t, df, r2Market }) {
  return (1 - r2Market) * partialR2FromT(t, df);
}

export function tFromDeltaR2({ deltaR2, df, r2Market }) {
  const partial = deltaR2 / (1 - r2Market);
  if (partial < 0 || partial >= 1) throw new Error("tFromDeltaR2: increment outside the reachable range for this market R-squared");
  return tFromPartialR2(partial, df);
}

// Design-side pair: an increment of `deltaR2` in a two-factor fit corresponds to
// beta = sqrt(deltaR2 * sstY / sxxResid), where sxxResid is the basket's sum of
// squares after projection on [1, market]. Kept separate from the t-based route so
// a reader can check either one by hand.
export function deltaR2FromBeta({ beta, basketResidualSsq, yTotalSsq }) {
  if (!(basketResidualSsq > 0) || !(yTotalSsq > 0)) return null;
  return (beta * beta * basketResidualSsq) / yTotalSsq;
}

export function betaFromDeltaR2({ deltaR2, basketResidualSsq, yTotalSsq, sign = -1 }) {
  if (!(basketResidualSsq > 0) || !(yTotalSsq > 0)) return null;
  return sign * Math.sqrt((deltaR2 * yTotalSsq) / basketResidualSsq);
}

// How long the panel would have to be for a given effect size to clear the rule with
// `targetPower`. The effect is held fixed in delta-R-squared (the desk's currency) at a
// fixed market share of variance, so the partial R-squared is constant and the t-statistic
// grows like sqrt(weeks) while the critical value converges: bisection on the week count
// finds the crossing. Returns null past the horizon, which is the honest "not reachable
// inside any usable sample" answer rather than an extrapolated number.
export function weeksForEffect({ deltaR2, r2Market, tests, qMax, targetPower = DEFAULT_POWER_TARGET, horizon = 200000 }) {
  const partial = deltaR2 / (1 - r2Market);
  if (!(partial > 0) || partial >= 1) return { reachable: false, reason: "increment outside the reachable range for this market R-squared", weeks: null };
  const gap = (weeks) => {
    const df = weeks - 3;
    const tCrit = tQuantile(df, qMax / tests);
    return tFromPartialR2(partial, df) - solveNcpForPower({ df, tCrit, targetPower });
  };
  if (gap(horizon) < 0) return { reachable: false, reason: `not reachable inside ${horizon} weeks`, weeks: null, partial };
  let lo = 4;
  let hi = horizon;
  if (gap(lo) > 0) return { reachable: true, weeks: lo, partial, df: 1 };
  for (let i = 0; i < 40; i++) {
    const mid = Math.round((lo + hi) / 2);
    if (gap(mid) < 0) lo = mid;
    else hi = mid;
  }
  const df = hi - 3;
  const tCrit = tQuantile(df, qMax / tests);
  return {
    reachable: true,
    weeks: hi,
    df,
    partial,
    tCrit,
    ncpRequired: solveNcpForPower({ df, tCrit, targetPower }),
    tOfEffect: tFromPartialR2(partial, df),
  };
}

// ---------------------------------------------------------------- design checks
// A level-difference basket is identically zero in every week Qloo carried the
// percentile forward. Such a regressor has no variance and is collinear with the
// intercept: the slope is not estimated badly, it is not estimated at all, so any
// "power" quoted for that slice is a number for an undefined quantity.
export function regressorDiagnostics(series, tol = 1e-12) {
  const weeks = series.length;
  let nonzero = 0;
  let sum = 0;
  for (const v of series) {
    if (v === null || !Number.isFinite(v)) continue;
    sum += v;
    if (Math.abs(v) > tol) nonzero++;
  }
  const mean = sum / weeks;
  const variance = series.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, weeks - 1);
  return { weeks, nonzeroRegressorWeeks: nonzero, mean, variance, frozen: nonzero === 0 };
}

// Sum of squares of the basket after regressing it on [1, market] — the information
// the design carries about the taste slope.
export function residualizedSumSquares(basket, market) {
  const n = basket.length;
  if (n !== market.length) throw new Error("residualizedSumSquares: length mismatch");
  let sb = 0;
  let sm = 0;
  let smm = 0;
  let sbm = 0;
  for (let i = 0; i < n; i++) {
    sb += basket[i];
    sm += market[i];
    smm += market[i] * market[i];
    sbm += basket[i] * market[i];
  }
  const det = n * smm - sm * sm;
  if (Math.abs(det) < 1e-18) throw new Error("residualizedSumSquares: market column is constant");
  const slope = (n * sbm - sm * sb) / det;
  const intercept = (sb - slope * sm) / n;
  let ssr = 0;
  for (let i = 0; i < n; i++) {
    const resid = basket[i] - (intercept + slope * market[i]);
    ssr += resid * resid;
  }
  let sst = 0;
  const mb = sb / n;
  for (let i = 0; i < n; i++) sst += (basket[i] - mb) ** 2;
  return { n, ssr, sst, basketMean: mb, degenerate: !(sst > 0) || ssr <= 1e-12 * sst };
}

// Where the regressor stops moving. The last week in which any handed-in basket has
// a non-zero value is the end of the informative prefix; everything after it is
// carry-forward, and a slope cannot be identified on it. This is measured from the
// committed series rather than asserted, so a change in Qloo's cadence moves the
// number instead of silently invalidating it.
export function informativePrefix(baskets, dates, tol = 1e-12) {
  let last = -1;
  for (const series of baskets) {
    for (let i = 0; i < series.length; i++) {
      const v = series[i];
      if (v !== null && Number.isFinite(v) && Math.abs(v) > tol && i > last) last = i;
    }
  }
  const weeks = dates?.length ?? baskets[0]?.length ?? 0;
  return {
    cutIndex: last + 1,
    informativeWeeks: last + 1,
    frozenWeeks: weeks - (last + 1),
    lastMovingDate: last >= 0 && dates ? dates[last] : null,
    firstFrozenDate: last + 1 < weeks && dates ? dates[last + 1] : null,
  };
}

// The held-out arm on a frozen tail. This is not a low-power result, it is the
// absence of a test: an identically zero regressor has zero residual sum of squares
// after the market column is projected out, so the taste slope has no sampling
// distribution to reason about. Returned instead of a number so a caller cannot
// print a power figure for it by accident.
export function frozenSliceVerdict({ slice, dates = null, trainWeeks = null }) {
  const diag = regressorDiagnostics(slice);
  if (!diag.frozen) {
    const nonzero = slice.filter((v) => v !== null && Math.abs(v) > 1e-12).length;
    return {
      computable: true,
      weeks: diag.weeks,
      nonzeroRegressorWeeks: nonzero,
      note: "the held-out slice carries movement; run the normal MDE on it",
    };
  }
  return {
    computable: false,
    weeks: diag.weeks,
    trainWeeks,
    nonzeroRegressorWeeks: 0,
    sliceStart: dates ? dates[dates.length - diag.weeks] : null,
    sliceEnd: dates ? dates.at(-1) : null,
    reason:
      "the taste regressor is identically zero on every held-out week (Qloo carries population_percentile forward), so its residual sum of squares is 0, the slope is not estimated at all, and detection probability collapses to the test size by construction rather than by measurement",
    detectionProbability: "equal to the nominal test size, not a computed power",
  };
}

// ---------------------------------------------------------------- the MDE

// One row of the published table. Everything here comes from the design: the weeks
// available, the fitted standard error, the market-only R-squared the name already
// carries, and the pre-registered multiplicity rule. No observed t-statistic enters.
export function minimumDetectableEffect({
  ticker,
  sector,
  weeks,
  se,
  r2Market,
  tests,
  qMax,
  targetPower = DEFAULT_POWER_TARGET,
  observed = null,
  dfOverride = null,
  subPeriod = null,
}) {
  const df = dfOverride ?? weeks - 3;
  if (!(df > 0)) return { ticker, sector, weeks, df, computable: false, reason: "no residual degrees of freedom" };
  if (!(se > 0) || !Number.isFinite(se)) {
    return { ticker, sector, weeks, df, computable: false, reason: "standard error is not positive; the taste slope is not identified" };
  }
  const crit = bhCriticalValue({ tests, qMax, df });
  const ncp = solveNcpForPower({ df, tCrit: crit.tCrit, targetPower });
  const betaMDE = ncp * se;
  const deltaR2 = deltaR2FromT({ t: ncp, df, r2Market });
  const partial = partialR2FromT(ncp, df);
  const row = {
    ticker,
    sector,
    weeks,
    df,
    t_crit: crit.tCrit,
    singleDiscoveryLevel: crit.singleDiscoveryLevel,
    ncpMDE: ncp,
    se,
    betaMDE,
    deltaR2MDEpts: deltaR2 * 100,
    partialR2MDEpts: partial * 100,
    minPartialCorrelation: Math.sqrt(partial),
    marketR2: r2Market,
    computable: true,
    observed: observed
      ? {
          beta: observed.beta,
          t: observed.t,
          q: observed.q,
          deltaR2Pts: observed.deltaR2 == null ? null : observed.deltaR2 * 100,
          absTvsNcpMDE: Math.abs(observed.t) / ncp,
          powerAtObserved: flagPower({ df, tCrit: crit.tCrit, ncp: Math.abs(observed.t) }),
        }
      : null,
  };
  if (subPeriod) row.subPeriod = subPeriod;
  return row;
}

// Book-level roll-up in the desk's currency.
export function bookSummary(rows) {
  const fit = rows.filter((r) => r.computable);
  if (!fit.length) throw new Error("bookSummary: no computable rows");
  const pts = fit.map((r) => r.deltaR2MDEpts);
  const q = (xs, p) => {
    const s = [...xs].sort((a, b) => a - b);
    if (!s.length) return null;
    const pos = p * (s.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  };
  const observedPower = fit.map((r) => (r.observed ? r.observed.powerAtObserved : NaN)).filter(Number.isFinite);
  // The noncentrality, critical value and partial R-squared depend only on df, so the
  // book figure is the one belonging to the median-df name rather than the first row.
  const byDf = [...fit].sort((a, b) => a.df - b.df)[Math.floor(fit.length / 2)];
  return {
    names: fit.length,
    medianDeltaR2Pts: q(pts, 0.5),
    iqr: [q(pts, 0.25), q(pts, 0.75)],
    minDeltaR2Pts: Math.min(...pts),
    maxDeltaR2Pts: Math.max(...pts),
    medianBetaMDE: q(fit.map((r) => r.betaMDE), 0.5),
    partialR2MDEpts: byDf.partialR2MDEpts,
    minPartialCorrelation: byDf.minPartialCorrelation,
    tCrit: byDf.t_crit,
    singleDiscoveryLevel: byDf.singleDiscoveryLevel,
    ncpMDE: byDf.ncpMDE,
    df: byDf.df,
    powerAtMedianObserved: q(observedPower, 0.5),
  };
}

// ---------------------------------------------------------------- estimator fast path

// The same two-factor OLS as src/ols.mjs for a [1, market, basket] design, written
// against the fixed column count so a 220k-draw simulation stays a few seconds.
// It uses the y'y - beta'X'y residual shortcut, so it agrees with ols() to solver
// precision (relative 1e-8 on the standard errors), which tests/mde.test.mjs pins.
export function fitTwoFactor(y, market, basket) {
  const n = y.length;
  let sm = 0;
  let sb = 0;
  let smm = 0;
  let sbm = 0;
  let sbb = 0;
  let sy = 0;
  let smy = 0;
  let sby = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const m = market[i];
    const b = basket[i];
    const obs = y[i];
    sm += m;
    sb += b;
    smm += m * m;
    sbm += b * m;
    sbb += b * b;
    sy += obs;
    smy += m * obs;
    sby += b * obs;
    syy += obs * obs;
  }
  const s = [
    [n, sm, sb],
    [sm, smm, sbm],
    [sb, sbm, sbb],
  ];
  const xty = [sy, smy, sby];
  const cof = [
    [smm * sbb - sbm * sbm, -(sm * sbb - sb * sbm), sm * sbm - sb * smm],
    [-(sm * sbb - sb * sbm), n * sbb - sb * sb, -(n * sbm - sm * sb)],
    [sm * sbm - sb * smm, -(n * sbm - sm * sb), n * smm - sm * sm],
  ];
  const det = s[0][0] * cof[0][0] + s[0][1] * cof[0][1] + s[0][2] * cof[0][2];
  // Collinearity is a relative property: det / (n * sumsq(market) * sumsq(basket))
  // is 1 for exactly orthogonal centred columns and collapses to 0 when the basket
  // is constant or a multiple of the market column. A frozen (all-zero) taste week
  // set lands on 0 and is reported as unidentified rather than divided by.
  const scale = n * smm * sbb;
  if (!Number.isFinite(det) || !(scale > 0) || Math.abs(det) / scale < 1e-9) {
    return { degenerate: true, beta: null, se: null, t: null, p: null, invDiag: null, df: n - 3, n };
  }
  const inv = cof.map((row, r) => row.map((c, j) => cof[j][r] / det)); // cofactor transpose / det
  const beta = inv.map((row, r) => row.reduce((acc, c, j) => acc + c * xty[j], 0));
  const fitted = beta[0] * xty[0] + beta[1] * xty[1] + beta[2] * xty[2];
  const sse = syy - fitted;
  const df = n - 3;
  if (!(df > 0)) return { degenerate: true, beta: null, se: null, t: null, p: null, invDiag: null, df, n };
  const sigma2 = sse / df;
  const invDiag = inv.map((row, r) => row[r]);
  const se = invDiag.map((d) => Math.sqrt(Math.max(0, sigma2 * d)));
  const mean = sy / n;
  const sst = y.reduce((acc, val) => acc + (val - mean) ** 2, 0);
  return {
    degenerate: false,
    beta,
    se,
    invDiag,
    sigma2,
    t: beta.map((b, i) => (se[i] === 0 ? Infinity : b / se[i])),
    p: se.map((_, i) => tDistP(Math.abs(beta[i] / se[i]), df)),
    df,
    n,
    r2: 1 - sse / sst,
  };
}

// ---------------------------------------------------------------- simulation

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 ^ t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One seeded stream, two consumers: `uniform` indexes block starts, `normal` draws
// errors. Handing the normal generator to anything that expects a [0,1) draw was a
// real bug in the first pass (negative indices made every resampled fit degenerate),
// so the two are exposed side by side rather than conflated.
export function makeRng(seed) {
  const rnd = mulberry32(seed);
  return {
    uniform: rnd,
    normal() {
      let u = 0;
      let v = 0;
      while (u === 0) u = rnd();
      while (v === 0) v = rnd();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}

export function gaussianRng(seed) {
  return makeRng(seed).normal;
}

// Circular block index set: contiguous weeks kept intact so the basket's own
// week-to-week dependence and the residual's survive inside a block, while the
// block order (and so the calendar alignment with anything longer than one block)
// is destroyed. Both facts are reported rather than smoothed over.
function blockStarts(n, blockWeeks, uniform) {
  const count = Math.ceil(n / blockWeeks);
  const out = new Array(n);
  let pos = 0;
  for (let b = 0; b < count; b++) {
    const start = Math.min(n - 1, Math.floor(uniform() * n));
    for (let k = 0; k < blockWeeks && pos < n; k++, pos++) out[pos] = (start + k) % n;
  }
  return out;
}

// Monte Carlo of the study as designed. The committed market and basket series are
// the design; each name's own fitted intercept, market loading and residual scale
// generate the outcome; one name per draw carries a true cultural beta of magnitude
// `ncp * its own standard error` (rotating through the book so every design is used
// the same number of times) while the rest carry zero; each draw is scored by the
// pre-registered rule (negative beta, |t| screen, Benjamini-Hochberg q across the
// book). The detection rate over draws is the quantity the analytic formula claims
// to be `targetPower`, so the two are directly comparable.
//
// Two arms:
//   blockWeeks = 0   iid Gaussian errors, design exactly as committed. This is the
//                    arm the analytic formula describes, so agreement is the check
//                    of the formula and of the BH implementation.
//   blockWeeks = 8   (market, basket, residual) triples resampled together in
//                    circular blocks of that length, from each name's own committed
//                    series. Contemporaneous relations and within-block dependence
//                    survive; alignment beyond one block does not. Divergence from
//                    the iid arm is the cost of the autocorrelation the iid arm
//                    assumes away, and is reported rather than reconciled away.
export function simulatePower({ designs, seed, draws = 1000, ncp, tests, qMax, absT = 2, blockWeeks = 0 }) {
  if (!designs?.length) throw new Error("simulatePower: no designs");
  if (!(ncp >= 0)) throw new Error("simulatePower: ncp must be a non-negative magnitude");
  const n = designs[0].y.length;
  if (designs.some((d) => d.y.length !== n || d.market.length !== n || d.basket.length !== n)) {
    throw new Error("simulatePower: every design must share one length");
  }
  const rng = makeRng(seed);
  const book = tests ?? designs.length;
  const perTestLevel = qMax / book;
  const plans = designs.map((d) => {
    const fit = fitTwoFactor(d.y, d.market, d.basket);
    if (fit.degenerate) {
      throw new Error(`simulatePower: ${d.ticker} carries a frozen regressor; the slope is not identified, so no power can be simulated`);
    }
    const sigma = Math.sqrt(fit.se[2] * fit.se[2] / fit.invDiag[2]); // = sqrt(SSE / df)
    const residuals = d.y.map((v, i) => v - (fit.beta[0] + fit.beta[1] * d.market[i] + fit.beta[2] * d.basket[i]));
    return {
      ticker: d.ticker,
      market: Float64Array.from(d.market),
      basket: Float64Array.from(d.basket),
      residuals: Float64Array.from(residuals),
      intercept: fit.beta[0],
      marketBeta: fit.beta[1],
      se: fit.se[2],
      sigma,
      df: fit.df,
    };
  });
  const df = plans[0].df;
  const tCrit = tQuantile(df, perTestLevel);
  const y = new Float64Array(n);
  const mres = new Float64Array(n);
  const bres = new Float64Array(n);
  const ps = new Float64Array(plans.length);
  const ts = new Float64Array(plans.length);
  const betas = new Float64Array(plans.length);
  let hits = 0;
  let falseFlags = 0;
  let nullTests = 0;
  let sizeHits = 0;
  let signalAbsT = 0;
  let degenerateFits = 0;
  for (let draw = 0; draw < draws; draw++) {
    const signal = draw % plans.length;
    for (let i = 0; i < plans.length; i++) {
      const d = plans[i];
      const betaTrue = i === signal ? -ncp * d.se : 0;
      const idx = blockWeeks > 0 ? blockStarts(n, blockWeeks, rng.uniform) : null;
      for (let t = 0; t < n; t++) {
        const s = idx ? idx[t] : t;
        // The block arm resamples the design too, so the regression it fits is the
        // design it generated: fitting a scrambled outcome against the unscrambled
        // basket would measure nothing but the scramble.
        const m = (mres[t] = d.market[s]);
        const b = (bres[t] = d.basket[s]);
        y[t] = d.intercept + d.marketBeta * m + betaTrue * b + (idx ? d.residuals[s] : d.sigma * rng.normal());
      }
      const fit = fitTwoFactor(y, idx ? mres : d.market, idx ? bres : d.basket);
      // A resampled design can land entirely on frozen weeks, in which case the slope
      // is not estimated at all. That is counted, not scored: it is the same failure
      // the held-out slice suffers, made visible instead of averaged away.
      if (fit.degenerate) {
        degenerateFits++;
        betas[i] = 0;
        ts[i] = 0;
        ps[i] = 1;
      } else {
        betas[i] = fit.beta[2];
        ts[i] = fit.t[2];
        ps[i] = fit.p[2];
      }
      if (!fit.degenerate && i !== signal) {
        nullTests++;
        if (ps[i] <= perTestLevel) sizeHits++;
      }
    }
    const qs = benjaminiHochberg(Array.from(ps));
    signalAbsT += Math.abs(ts[signal]);
    for (let i = 0; i < plans.length; i++) {
      const flagged = betas[i] < 0 && Math.abs(ts[i]) >= absT && qs[i] <= qMax;
      if (!flagged) continue;
      if (i === signal) hits++;
      else falseFlags++;
    }
  }
  const power = hits / draws;
  const se = Math.sqrt((power * (1 - power)) / draws);
  return {
    seed,
    draws,
    names: plans.length,
    weeks: n,
    df,
    ncp,
    absT,
    qMax,
    tests: book,
    blockWeeks,
    tCrit,
    power,
    powerSe: se,
    ci: [Math.max(0, power - 1.96 * se), Math.min(1, power + 1.96 * se)],
    meanSignalAbsT: signalAbsT / draws,
    degenerateFits,
    falseFlagRatePerNullName: falseFlags / Math.max(1, draws * (plans.length - 1)),
    empiricalSizePerNullTest: sizeHits / Math.max(1, nullTests),
  };
}
