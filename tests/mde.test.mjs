// The MDE table is the claim that this design could have seen something. Every
// number in it comes from four primitives — a t critical value, a noncentral-t
// power integral, a delta-R-squared identity and a Monte Carlo — so each one is
// pinned here against a value a reader can check by hand or against the estimator
// the pipeline already ships (src/ols.mjs). Nothing in this file reads output/desk.json:
// the design is synthetic and small, and the real run is scripts/mde.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ols, tDistP } from "../src/ols.mjs";
import {
  bhCriticalValue,
  betaFromDeltaR2,
  bookSummary,
  deltaR2FromBeta,
  deltaR2FromT,
  fitTwoFactor,
  flagPower,
  frozenSliceVerdict,
  gaussianRng,
  informativePrefix,
  logGamma,
  minimumDetectableEffect,
  normalCdf,
  normalUpperTail,
  partialR2FromT,
  powerTable,
  regressorDiagnostics,
  residualizedSumSquares,
  simulatePower,
  solveNcpForPower,
  tFromDeltaR2,
  tFromPartialR2,
  tQuantile,
  weeksForEffect,
} from "../src/mde.mjs";

const close = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) < tol, `${what}: got ${a}, expected ${b} (tol ${tol})`);

// A deterministic synthetic design: fixed, small, and reproducible without a seed
// because the series are arithmetic, not random.
function design(n = 60) {
  const market = [];
  const basket = [];
  const u = gaussianRng(4242);
  const y = [];
  for (let i = 0; i < n; i++) {
    market.push(0.01 * Math.sin(i / 3) + 0.004 * u());
    // A level-difference basket: piecewise, so it carries real week-to-week structure.
    basket.push(i < n / 2 ? 0.5 + 0.05 * (i % 5) : 0.4 - 0.05 * (i % 7));
  }
  for (let i = 0; i < n; i++) y.push(0.002 + 1.1 * market[i] - 12 * basket[i] + 0.02 * u());
  return { y, market, basket };
}

// ---------------------------------------------------------------- primitives

test("log-gamma and the normal tail land on textbook values", () => {
  close(logGamma(1), 0, 1e-12, "ln Gamma(1)");
  close(logGamma(0.5), Math.log(Math.PI) / 2, 1e-11, "ln Gamma(1/2)");
  close(logGamma(10), Math.log(362880), 1e-10, "ln Gamma(10) = ln 9!");
  close(normalUpperTail(0), 0.5, 1e-12, "P(Z > 0)");
  close(normalUpperTail(1.959963984540054), 0.025, 1e-9, "P(Z > 1.959964)");
  close(normalUpperTail(-1), 1 - normalUpperTail(1), 1e-12, "symmetry");
  close(normalCdf(0), 0.5, 1e-12, "Phi(0)");
});

test("t critical values reproduce closed-form and table cases", () => {
  // df = 1 is Cauchy: P(|T| > 1) = 1/2 exactly.
  close(tQuantile(1, 0.5), 1, 1e-9, "Cauchy median of |t|");
  // df = 2: P(T <= t) = 1/2 + t / (2 sqrt(2 + t^2)), so the two-sided 0.5 point is sqrt(2/3).
  close(tQuantile(2, 0.5), Math.sqrt(2 / 3), 1e-9, "df=2 two-sided p=0.5");
  // Standard table value.
  close(tQuantile(9, 0.05), 2.262157162740951, 1e-9, "t(9) at 5%");
  // The design point of this study: df = 99 at the Benjamini-Hochberg lone-discovery level.
  const t99 = tQuantile(99, 0.00125);
  close(tDistP(t99, 99), 0.00125, 1e-10, "p-value round trip at df=99");
  close(t99, 3.322736, 1e-5, "t_crit(99, 0.00125)");
});

test("the quadrature carries the chi-square mass and the power integral is exact at ncp = 0", () => {
  for (const df of [7, 20, 55, 99, 120]) {
    const table = powerTable(df);
    close(table.mass, 1, 1e-6, `chi-square mass captured at df=${df}`);
    // With no noncentrality the flag probability must collapse to the test size,
    // which for a two-sided p-value convention is half the nominal p, i.e. 0.005 here.
    const twoSided = 0.01;
    const c = tQuantile(df, twoSided);
    close(flagPower({ df, tCrit: c, ncp: 0 }), twoSided / 2, 1e-7, `size at ncp=0, df=${df}`);
  }
});

test("solveNcpForPower inverts flagPower", () => {
  const df = 99;
  const tCrit = tQuantile(df, 0.00125);
  for (const target of [0.5, 0.8, 0.95]) {
    const ncp = solveNcpForPower({ df, tCrit, targetPower: target });
    close(flagPower({ df, tCrit, ncp }), target, 1e-6, `power at the solved ncp, target ${target}`);
  }
  // Power is monotone in the noncentrality: a bigger true effect is easier to see.
  const a = flagPower({ df, tCrit, ncp: 2 });
  const b = flagPower({ df, tCrit, ncp: 3 });
  const c = flagPower({ df, tCrit, ncp: 4.179 });
  assert.ok(a < b && b < c, "flag power must rise with the noncentrality");
  close(c, 0.8, 1e-4, "the published MDE noncentrality");
});

// ---------------------------------------------------------------- the rule

test("the Benjamini-Hochberg critical value at 80 names and q = 0.10", () => {
  const crit = bhCriticalValue({ tests: 80, qMax: 0.1, df: 99 });
  assert.equal(crit.tests, 80);
  assert.equal(crit.singleDiscoveryLevel, 0.1 / 80, "the lone-discovery level is the BH q over the number of tests");
  close(crit.tCrit, 3.32273636656382, 1e-9, "t_crit at the lone-discovery level");
  // Hand check of why 0.00125: a single discovery sits at BH rank 1, so its q-value
  // is p * 80 / 1 and q <= 0.1 means p <= 0.00125.
  const p = tDistP(crit.tCrit, 99);
  close(p * 80, 0.1, 1e-7, "BH rank-1 q-value at the critical t");
  assert.match(crit.rule, /80 priced names/);
});

// ---------------------------------------------------------------- identities

test("partial R-squared is the exact t identity, both ways", () => {
  for (const t of [0.5, 1.7, 2.5, 4.179]) {
    for (const df of [20, 55, 99]) {
      close(tFromPartialR2(partialR2FromT(t, df), df), t, 1e-12, `t -> partial R2 -> t (t=${t}, df=${df})`);
    }
  }
  assert.throws(() => tFromPartialR2(1, 99), /must be in \[0,1\)/);
});

test("the delta-R-squared conversions round-trip and match the fit on real data", () => {
  const { y, market, basket } = design();
  const n = y.length;
  const df = n - 3;
  const full = ols(y, [market, basket]);
  const mkt = ols(y, [market]);
  const mean = y.reduce((a, b) => a + b, 0) / n;
  const sst = y.reduce((a, b) => a + (b - mean) ** 2, 0);
  // Route 1 (t-based, the exact identity): increment = (1 - r2_market) * t^2/(t^2+df).
  const viaT = deltaR2FromT({ t: full.t[2], df, r2Market: mkt.r2 });
  // Route 2 (design-based): increment = beta^2 * Sxx_resid / SST_y.
  const rs = residualizedSumSquares(basket, market);
  const viaDesign = deltaR2FromBeta({ beta: full.beta[2], basketResidualSsq: rs.ssr, yTotalSsq: sst });
  // Route 3: the definition, straight off the two R-squares.
  const viaR2 = full.r2 - mkt.r2;
  close(viaT, viaR2, 1e-12, "t-route vs definition");
  close(viaDesign, viaR2, 1e-12, "design-route vs definition");
  // And back: t recovered from the published delta-R-squared is the fitted t. The
  // tolerance is relative because this synthetic design fits almost perfectly, so the
  // t-statistic is in the hundreds and an absolute 1e-12 would be rounding noise.
  const tBack = tFromDeltaR2({ deltaR2: viaR2, df, r2Market: mkt.r2 });
  assert.ok(Math.abs(tBack - Math.abs(full.t[2])) < 1e-9 * tBack, `delta-R2 -> t: ${tBack} vs ${Math.abs(full.t[2])}`);
  // ...and beta recovered from it is the fitted beta.
  const betaBack = betaFromDeltaR2({ deltaR2: viaR2, basketResidualSsq: rs.ssr, yTotalSsq: sst, sign: Math.sign(full.beta[2]) });
  close(betaBack, full.beta[2], 1e-10, "delta-R2 -> beta");
});

// ---------------------------------------------------------------- the MDE row

test("minimumDetectableEffect is ncp times the standard error, in both currencies", () => {
  const df = 99;
  const ncp = solveNcpForPower({ df, tCrit: tQuantile(df, 0.00125), targetPower: 0.8 });
  const se = 0.025;
  const r2Market = 0.3;
  const row = minimumDetectableEffect({ ticker: "XYZ", sector: "test", weeks: 102, se, r2Market, tests: 80, qMax: 0.1 });
  assert.equal(row.computable, true);
  assert.equal(row.df, 99, "weeks - 3 for an intercept plus two regressors");
  close(row.ncpMDE, 4.179022792672908, 1e-9, "MDE noncentrality");
  close(row.betaMDE, ncp * se, 1e-12, "MDE = ncp * SE");
  close(row.deltaR2MDEpts, (1 - r2Market) * (ncp * ncp) / (ncp * ncp + df) * 100, 1e-10, "delta-R2 points");
  close(row.partialR2MDEpts, (ncp * ncp) / (ncp * ncp + df) * 100, 1e-10, "partial R-squared points");
  close(row.minPartialCorrelation, Math.sqrt(row.partialR2MDEpts / 100), 1e-12, "partial correlation");
  // A flagged name needs a negative beta, so the published MDE is a negative slope.
  assert.ok(row.betaMDE > 0 && Number.isFinite(row.betaMDE), "magnitude form; the sign is in the rule");
});

test("the MDE grows as the design loses weeks and as the standard error grows", () => {
  const base = { ticker: "A", sector: "s", se: 0.02, r2Market: 0.4, tests: 80, qMax: 0.1 };
  const long = minimumDetectableEffect({ ...base, weeks: 102 });
  const short = minimumDetectableEffect({ ...base, weeks: 58 });
  const tiny = minimumDetectableEffect({ ...base, weeks: 20 });
  assert.ok(long.deltaR2MDEpts < short.deltaR2MDEpts, "fewer weeks must cost detectability");
  assert.ok(short.deltaR2MDEpts < tiny.deltaR2MDEpts, "and so must fewer still");
  const loud = minimumDetectableEffect({ ...base, weeks: 102, se: 0.04 });
  close(loud.betaMDE, 2 * long.betaMDE, 1e-12, "MDE is linear in the standard error");
});

test("an unidentified slope reports not computable rather than a big number", () => {
  for (const se of [0, -1, Number.NaN]) {
    const row = minimumDetectableEffect({ ticker: "FROZEN", sector: "s", weeks: 102, se, r2Market: 0.4, tests: 80, qMax: 0.1 });
    assert.equal(row.computable, false, `se = ${se}`);
    assert.match(row.reason, /not identified/);
    assert.equal(row.betaMDE, undefined);
  }
  const noDf = minimumDetectableEffect({ ticker: "NEW", sector: "s", weeks: 3, se: 0.02, r2Market: 0.4, tests: 80, qMax: 0.1 });
  assert.equal(noDf.computable, false);
  assert.match(noDf.reason, /degrees of freedom/);
});

test("bookSummary reports the median and IQR of the delta-R-squared column", () => {
  const rows = [
    { computable: true, deltaR2MDEpts: 10, betaMDE: 5, partialR2MDEpts: 12, df: 99 },
    { computable: true, deltaR2MDEpts: 20, betaMDE: 6, partialR2MDEpts: 12, df: 99 },
    { computable: true, deltaR2MDEpts: 30, betaMDE: 7, partialR2MDEpts: 12, df: 99 },
    { computable: false, reason: "nope" },
  ];
  const s = bookSummary(rows);
  assert.equal(s.names, 3, "the uncomputable row is counted out, not averaged in");
  close(s.medianDeltaR2Pts, 20, 1e-12, "median");
  close(s.iqr[0], 15, 1e-12, "first quartile");
  close(s.iqr[1], 25, 1e-12, "third quartile");
  close(s.minDeltaR2Pts, 10, 1e-12, "min");
  close(s.maxDeltaR2Pts, 30, 1e-12, "max");
  assert.throws(() => bookSummary([{ computable: false, reason: "x" }]), /no computable rows/);
});

// ---------------------------------------------------------------- design checks

test("weeksForEffect inverts the MDE and is monotone in the effect size", () => {
  const spec = { tests: 80, qMax: 0.1, targetPower: 0.8 };
  // Self-check: ask for the increment the published MDE corresponds to at the panel
  // length, and the answer must come back at roughly the panel length.
  const df = 99;
  const ncp = solveNcpForPower({ df, tCrit: tQuantile(df, 0.1 / 80), targetPower: 0.8 });
  const r2Market = 0.25;
  const mdeIncrement = deltaR2FromT({ t: ncp, df, r2Market });
  const back = weeksForEffect({ ...spec, deltaR2: mdeIncrement, r2Market });
  assert.equal(back.reachable, true);
  assert.ok(Math.abs(back.weeks - 102) <= 3, `round trip landed at ${back.weeks} weeks, expected ~102`);
  // Bigger effects need less data; the relation must be monotone.
  const small = weeksForEffect({ ...spec, deltaR2: 0.0067, r2Market });
  const big = weeksForEffect({ ...spec, deltaR2: 0.2, r2Market });
  assert.ok(small.weeks > big.weeks, `${small.weeks} must exceed ${big.weeks}`);
  assert.ok(big.weeks < 102, "a 20-point increment is visible in less than the panel");
  // An absurdly small increment is not reachable inside the horizon: null, not a guess.
  const unreachable = weeksForEffect({ ...spec, deltaR2: 1e-7, r2Market, horizon: 200000 });
  assert.equal(unreachable.reachable, false);
  assert.equal(unreachable.weeks, null);
  assert.match(unreachable.reason, /not reachable/);
  assert.equal(weeksForEffect({ ...spec, deltaR2: 1.5, r2Market }).reachable, false);
});

test("residualizedSumSquares on a hand-computable design", () => {
  // basket [1,-1,1,-1] on market [1,2,3,4]: slope -0.4, intercept +1, so the fitted
  // line is 1 - 0.4*market = [0.6, 0.2, -0.2, -0.6] and the residuals are
  // [0.4, -1.2, 1.2, -0.4] -> ssr = 0.16 + 1.44 + 1.44 + 0.16 = 3.2. The basket is
  // already centred, so sst = 1 + 1 + 1 + 1 = 4.
  const rs = residualizedSumSquares([1, -1, 1, -1], [1, 2, 3, 4]);
  close(rs.ssr, 3.2, 1e-12, "residual sum of squares by hand");
  close(rs.sst, 4, 1e-12, "total sum of squares by hand");
  assert.equal(rs.degenerate, false);
  assert.equal(rs.basketMean, 0);
  // A constant regressor is collinear with the intercept: no slope information.
  assert.equal(residualizedSumSquares([2, 2, 2, 2, 2], [1, 2, 3, 4, 5]).degenerate, true);
  // A regressor that is an exact function of the market column has zero residual SS.
  const double = residualizedSumSquares([3, 5, 7, 9], [1, 2, 3, 4]);
  close(double.ssr, 0, 1e-12, "no variation left after the market projection");
  assert.equal(double.degenerate, true);
  // An all-zero slice (the frozen tail) carries nothing.
  assert.equal(residualizedSumSquares([0, 0, 0, 0], [1, 2, 3, 4]).degenerate, true);
  assert.throws(() => residualizedSumSquares([1, 2], [1, 2, 3]), /length mismatch/);
});

test("regressorDiagnostics and informativePrefix measure the carry-forward tail", () => {
  const dates = ["a", "b", "c", "d", "e", "f"];
  const series = [0.4, 0.41, 0.39, 0, 0, 0];
  const diag = regressorDiagnostics(series);
  assert.equal(diag.weeks, 6);
  assert.equal(diag.nonzeroRegressorWeeks, 3);
  assert.equal(diag.frozen, false);
  assert.equal(regressorDiagnostics([0, 0, 0]).frozen, true);
  const prefix = informativePrefix([series, [0, 0, 0, 0.2, 0, 0]], dates);
  assert.equal(prefix.informativeWeeks, 4, "the last week any basket moved");
  assert.equal(prefix.frozenWeeks, 2);
  assert.equal(prefix.lastMovingDate, "d");
  assert.equal(prefix.firstFrozenDate, "e");
  assert.equal(prefix.cutIndex, 4);
});

test("the frozen held-out slice is not computable, and a moving one is", () => {
  const dates = ["w1", "w2", "w3", "w4", "w5"];
  const verdict = frozenSliceVerdict({ slice: [0, 0, 0, 0, 0], dates, trainWeeks: 67 });
  assert.equal(verdict.computable, false, "the honest answer is 'not computable'");
  assert.equal(verdict.weeks, 5);
  assert.equal(verdict.nonzeroRegressorWeeks, 0);
  assert.equal(verdict.trainWeeks, 67);
  assert.match(verdict.reason, /identically zero/);
  assert.match(verdict.reason, /residual sum of squares is 0/);
  assert.match(verdict.detectionProbability, /nominal test size/);
  const live = frozenSliceVerdict({ slice: [0, 0.1, 0, 0.2, 0], dates });
  assert.equal(live.computable, true);
  assert.equal(live.nonzeroRegressorWeeks, 2);
});

// ---------------------------------------------------------------- estimator

test("fitTwoFactor reproduces ols() on the same design to solver precision", () => {
  // The fast path forms the residual sum of squares as y'y - beta'X'y while ols() sums
  // squared residuals, so the two differ by the shortcut's rounding, not by the model.
  // The tolerance below is relative and is the empirical worst case across the sizes.
  const rel = (a, b, tol, what) =>
    assert.ok(Math.abs(a - b) <= tol * Math.max(Math.abs(b), 1e-12), `${what}: ${a} vs ${b}`);
  for (const n of [12, 40, 60]) {
    const { y, market, basket } = design(n);
    const fast = fitTwoFactor(y, market, basket);
    const ref = ols(y, [market, basket]);
    assert.equal(fast.degenerate, false);
    assert.equal(fast.df, n - 3);
    for (let k = 0; k < 3; k++) {
      rel(fast.beta[k], ref.beta[k], 1e-9, `beta[${k}] at n=${n}`);
      rel(fast.se[k], ref.se[k], 1e-8, `se[${k}] at n=${n}`);
    }
    rel(fast.r2, ref.r2, 1e-10, `r2 at n=${n}`);
    rel(fast.t[2], ref.t[2], 1e-8, `t at n=${n}`);
  }
});

test("fitTwoFactor refuses to divide by a collinear design", () => {
  const market = [1, 2, 3, 4, 5, 6];
  const y = [0.1, -0.2, 0.3, 0.05, -0.1, 0.2];
  const frozen = fitTwoFactor(y, market, [0, 0, 0, 0, 0, 0]);
  assert.equal(frozen.degenerate, true);
  assert.equal(frozen.beta, null);
  assert.equal(frozen.df, 3);
  const cloned = fitTwoFactor(y, market, market.map((v) => 1 + 2 * v));
  assert.equal(cloned.degenerate, true, "a basket that is a line in the market carries no separate slope");
});

// ---------------------------------------------------------------- simulation

test("the seeded Monte Carlo is deterministic and refuses a frozen design", () => {
  const { y, market, basket } = design(48);
  const designs = [0.5, -0.5, 1.25].map((b, i) => ({
    ticker: `T${i}`,
    y: y.map((v, t) => v + b * basket[t] + 0.01 * Math.cos(i * 7 + t)),
    market,
    basket,
  }));
  const spec = { designs, seed: 99, draws: 40, ncp: 3, tests: 80, qMax: 0.1, absT: 2, blockWeeks: 0 };
  const a = simulatePower(spec);
  const b = simulatePower(spec);
  assert.deepEqual(a, b, "same seed, same draws, same answer");
  const c = simulatePower({ ...spec, seed: 100 });
  assert.notEqual(a.power, c.power, "a different seed must actually move the stream");
  assert.throws(
    () => simulatePower({ ...spec, designs: [{ ticker: "F", y, market, basket: basket.map(() => 0) }] }),
    /frozen regressor/,
    "no power may be simulated for a slope that is not identified",
  );
  assert.throws(() => simulatePower({ ...spec, ncp: -1 }), /non-negative/);
  assert.throws(() => simulatePower({ ...spec, designs: [{ ticker: "L", y, market, basket: basket.slice(0, 9) }] }), /one length/);
});

test("the simulated iid arm matches the analytic flag power it claims to check", () => {
  // A design the size of the study's: enough names that the lone-discovery level binds,
  // few enough draws to stay a unit test. The block arm is checked in scripts/mde.mjs.
  const { market, basket } = design(90);
  const u = gaussianRng(77);
  const n = market.length;
  const df = n - 3;
  const tests = 20;
  const qMax = 0.1;
  const tCrit = tQuantile(df, qMax / tests);
  assert.ok(tCrit > 2, "the |t| screen must not be the binding constraint here");
  const designs = [];
  for (let i = 0; i < tests; i++) {
    const y = [];
    for (let t = 0; t < n; t++) y.push(0.001 + 0.9 * market[t] + 0.02 * u());
    designs.push({ ticker: `N${i}`, y, market, basket });
  }
  const ncp = solveNcpForPower({ df, tCrit, targetPower: 0.8 });
  const sim = simulatePower({ designs, seed: 20261030, draws: 500, ncp, tests, qMax, absT: 2, blockWeeks: 0 });
  const analytic = flagPower({ df, tCrit, ncp });
  close(analytic, 0.8, 1e-6, "the analytic target");
  assert.ok(Math.abs(sim.power - analytic) < 0.05, `simulated ${sim.power} vs analytic ${analytic} (se ${sim.powerSe})`);
  close(sim.tCrit, tCrit, 1e-9, "the simulation uses the same critical value");
  assert.equal(sim.df, df);
  assert.equal(sim.degenerateFits, 0, "a moving basket never blocks the arm");
  // Size check: with no signal anywhere, the per-test rejection rate is the nominal level.
  const null0 = simulatePower({ designs, seed: 20261031, draws: 400, ncp: 0, tests, qMax, absT: 2, blockWeeks: 0 });
  close(null0.empiricalSizePerNullTest, qMax / tests, 0.004, "empirical size at the lone-discovery level");
});

test("the block arm runs on a real dependent design and reports its degeneracy count", () => {
  const { y, market, basket } = design(80);
  const designs = [0, 1, 2].map((i) => ({ ticker: `B${i}`, y: y.map((v, t) => v + 0.003 * i + 0.01 * Math.sin(t / (i + 2))), market, basket }));
  const r1 = simulatePower({ designs, seed: 515, draws: 25, ncp: 4.179, tests: 80, qMax: 0.1, absT: 2, blockWeeks: 8 });
  const r2 = simulatePower({ designs, seed: 515, draws: 25, ncp: 4.179, tests: 80, qMax: 0.1, absT: 2, blockWeeks: 8 });
  assert.deepEqual(r1, r2, "the block arm is seeded too");
  assert.equal(r1.blockWeeks, 8);
  assert.ok(r1.power > 0, "a moving basket resampled in blocks still identifies a slope");
  assert.ok(r1.empiricalSizePerNullTest >= 0 && r1.empiricalSizePerNullTest <= 1);
  assert.ok(r1.degenerateFits <= designs.length * 25, "degeneracy is counted, never hidden");
});
