// Two tests that a sceptical reader will ask for before believing a factor:
// does the taste basket still explain returns on weeks it was not fitted on,
// and does it beat a version of itself that has been rotated out of alignment?
// Deterministic code, no model.
import { ols } from "./ols.mjs";

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function r2On(y, yhat) {
  const m = mean(y);
  const sst = y.reduce((s, v) => s + (v - m) ** 2, 0);
  const sse = y.reduce((s, v, i) => s + (v - yhat[i]) ** 2, 0);
  return 1 - sse / sst;
}

// Fit on the first k weeks, score on the rest. Never clamped: a factor that adds
// nothing out of sample must be allowed to report a negative ΔR².
export function outOfSample({ y, x, basket, trainShare = 0.66 }) {
  const n = y.length;
  const k = Math.min(Math.max(Math.round(n * trainShare), 24), n - 12);
  const tr = (a) => a.slice(0, k);
  const te = (a) => a.slice(k);
  const [yTe, xTe, bTe] = [te(y), te(x), te(basket)];
  const full = ols(tr(y), [tr(x), tr(basket)]);
  const mkt = ols(tr(y), [tr(x)]);
  const predict = (beta, cols) => yTe.map((_, i) => beta[0] + cols.reduce((s, c, j) => s + beta[j + 1] * c[i], 0));
  const r2 = r2On(yTe, predict(full.beta, [xTe, bTe]));
  const r2Market = r2On(yTe, predict(mkt.beta, [xTe]));
  return { trainWeeks: k, testWeeks: n - k, r2, r2Market, deltaR2: r2 - r2Market };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rotate = (v, k) => v.map((_, i) => v[(i + k) % v.length]);

// Circular rotation, not a shuffle: the placebo keeps the taste series' own
// autocorrelation and cross-holdings alignment, and only destroys its alignment
// with the holding's returns. Every holding is rotated by the same shift, so the
// book-level test honours the correlation between holdings.
export function bookPlacebo(items, { draws = 400, seed = 20261029, minShift = 20 } = {}) {
  if (!items.length) throw new Error("placebo: no holdings");
  const n = items[0].basket.length;
  if (items.some((it) => it.basket.length !== n)) throw new Error("placebo: basket length mismatch");
  const span = n - 2 * minShift;
  if (span < 1) throw new Error("placebo: series too short to rotate");

  const mkt = items.map((it) => ols(it.y, [it.x]));
  const real = items.map((it, i) => ols(it.y, [it.x, it.basket]).r2 - mkt[i].r2);
  const realMean = mean(real);

  const rnd = mulberry32(seed);
  const bookDraws = [];
  const hits = new Array(items.length).fill(0);
  let ge = 0;
  for (let d = 0; d < draws; d++) {
    const shift = minShift + Math.floor(rnd() * span);
    const deltas = items.map((it, i) => ols(it.y, [it.x, rotate(it.basket, shift)]).r2 - mkt[i].r2);
    for (let i = 0; i < deltas.length; i++) if (deltas[i] >= real[i]) hits[i]++;
    const m = mean(deltas);
    bookDraws.push(m);
    if (m >= realMean) ge++;
  }
  const sorted = [...bookDraws].sort((a, b) => a - b);
  return {
    draws,
    seed,
    minShift,
    real: realMean,
    p: (1 + ge) / (1 + draws),
    placeboMean: mean(bookDraws),
    placeboP95: sorted[Math.min(sorted.length - 1, Math.floor(draws * 0.95))],
    perHolding: { real, p: hits.map((h) => (1 + h) / (1 + draws)) },
  };
}
