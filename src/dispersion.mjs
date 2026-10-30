// Does the book actually differ across names? The mean cultural beta can be zero
// while individual names carry real, opposite exposures — and that dispersion is
// the claim the desk makes when it prints one beta per name rather than one for
// the book. This module tests it directly instead of inferring it from the mean.
//
// Statistic: the cross-sectional variance of the per-name cultural betas. Under
// no genuine heterogeneity its expectation is the average sampling variance, se².
// So we report both, the excess (V − mean se²), and calibrate the excess with a
// null that keeps every basket's own shape and destroys only its alignment: each
// name's basket is rotated independently. Independent rotations leave sampling
// noise in place and remove any shared or name-specific timing, which is exactly
// the null "the spread we see is estimation noise".
import { ols } from "./ols.mjs";

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rotate(a, k) {
  const n = a.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = a[(i + k) % n];
  return out;
}

function variance(a) {
  const m = mean(a);
  return a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1);
}

// What spread could this test have found? Without an answer, "no detectable
// heterogeneity" is a sentence that can be true because there is none or true
// because the test cannot see one. So the alternative is simulated: each name's
// outcome is shifted so its cultural beta becomes a draw from a known spread,
// holding everything else fixed. Adding c × basket to y moves that name's fitted
// cultural beta by exactly c, so the planted coefficient is exact rather than
// approximate. Each planted world is scored against the same 90% threshold the real
// book is, and the detection rate is the power at that spread.
function gaussian(seed) {
  const rnd = mulberry32(seed);
  return () => {
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

function plantedDraws(n, sd, seed) {
  const g = gaussian(seed);
  const z = Array.from({ length: n }, () => g());
  const m = mean(z);
  const s = Math.sqrt(z.reduce((acc, v) => acc + (v - m) ** 2, 0) / (n - 1));
  return z.map((v) => (sd * (v - m)) / s);
}

function powerAt(items, betas, threshold, sd, { worlds, seed }) {
  let hits = 0;
  for (let w = 0; w < worlds; w++) {
    const planted = plantedDraws(items.length, sd, seed + 101 * (w + 1));
    const shifted = items.map((it, j) => ({
      ...it,
      y: it.y.map((v, t) => v + (planted[j] - betas[j]) * it.basket[t]),
    }));
    const v = variance(shifted.map((it) => ols(it.y, [it.x, it.basket]).beta[2]));
    if (v > threshold) hits++;
  }
  return hits / worlds;
}

export function betaDispersion(items, { draws = 400, seed = 20261029, minShift = 8, sdGrid = [1, 5, 10, 25, 50], powerWorlds = 40 } = {}) {
  if (!items.length) throw new Error("dispersion: no holdings");
  const n = items[0].basket.length;
  if (items.some((it) => it.basket.length !== n || it.y.length !== n || it.x.length !== n)) {
    throw new Error("dispersion: series length mismatch");
  }
  const span = n - 2 * minShift;
  if (span < 1) throw new Error("dispersion: series too short to rotate");

  const real = items.map((it) => {
    const r = ols(it.y, [it.x, it.basket]);
    return { beta: r.beta[2], se: r.se[2] };
  });
  const betas = real.map((r) => r.beta);
  const ses = real.map((r) => r.se);
  const vReal = variance(betas);
  const sampling = mean(ses.map((s) => s * s));
  const excess = vReal - sampling;

  const rnd = mulberry32(seed);
  const vNull = [];
  const seNull = [];
  for (let d = 0; d < draws; d++) {
    const b = [];
    const s2 = [];
    for (const it of items) {
      const k = minShift + Math.floor(rnd() * span);
      const r = ols(it.y, [it.x, rotate(it.basket, k)]);
      b.push(r.beta[2]);
      s2.push(r.se[2] * r.se[2]);
    }
    vNull.push(variance(b));
    seNull.push(mean(s2));
  }
  const ge = vNull.filter((v) => v >= vReal).length;
  const le = vNull.filter((v) => v <= vReal).length;
  const sorted = [...vNull].sort((a, b) => a - b);
  const p = (1 + ge) / (1 + draws);
  const pLow = (1 + le) / (1 + draws);
  const ratio = sampling > 0 ? vReal / sampling : null;

  // The two tails answer different questions. p asks whether the book's spread is
  // wider than estimation noise, which is the claim being made. pLow asks whether
  // it is narrower, which is what you see when every name is really the same
  // number and the estimates merely scatter. Both are reported because the second
  // is the one that rules the desk's story out.
  // Calibrate what this test could have seen. The 90% threshold is the upper-tail
  // cutoff the real book is scored against, so the power figures are the detection
  // rates a book of this shape would have had at each planted spread.
  const threshold = sorted[Math.min(sorted.length - 1, Math.floor(draws * 0.90))];
  const power = sdGrid.map((sd) => ({ sd, power: powerAt(items, betas, threshold, sd, { worlds: powerWorlds, seed }) }));
  const detectable = power.find((r) => r.power >= 0.8) ?? null;
  // A test that could not detect a spread as large as the one it actually observed,
  // even if that spread were entirely real, has not tested anything. That is the
  // criterion for calling a non-detection informative rather than empty.
  const observedSd = Math.sqrt(vReal);
  const powerObserved = powerAt(items, betas, threshold, observedSd, { worlds: powerWorlds, seed: seed + 5000 });
  const informative = powerObserved >= 0.8;
  // The analytic benchmark (mean se²) and the empirical null disagree here by a wide
  // margin, which raises an obvious question: which one is wrong? The null answers it,
  // because inside those draws the true relationship is gone by construction and both
  // numbers can be computed on the same slopes. If the analytic figure overshoots the
  // cross-sectional variance by the same margin there, the gap is a property of the
  // statistic — mean se² treats the names as independent estimates, while every name
  // here is measured over one shared calendar — and not a fact about this book.
  const nullSampling = seNull.length ? mean(seNull) : null;
  const benchmarkGap = sampling > 0 ? mean(vNull) / sampling - 1 : null;
  const gapInNull = nullSampling > 0 ? mean(vNull) / nullSampling - 1 : null;

  const readsAs = ratio === null ? "undetermined"
    : p <= 0.10 ? "excess-dispersion"
    : pLow <= 0.10 ? "no-dispersion"
    : informative ? "indeterminate"
    : "uninformative";

  return {
    names: items.length,
    weeks: n,
    variance: vReal,
    samplingVariance: sampling,
    excess,
    ratio,
    draws,
    seed,
    minShift,
    nullMean: mean(vNull),
    nullP95: sorted[Math.min(sorted.length - 1, Math.floor(draws * 0.95))],
    nullP05: sorted[Math.min(sorted.length - 1, Math.floor(draws * 0.05))],
    p,
    pLow,
    readsAs,
    threshold,
    power,
    powerWorlds,
    sdGrid,
    detectable,
    observedSd,
    powerObserved,
    informative,
    benchmarkGap,
    nullSamplingVariance: nullSampling,
    gapInNull,
    note: "cross-sectional variance of the per-name cultural betas against the average squared standard error; the null rotates each name's basket independently, keeping its shape and removing its timing",
  };
}
