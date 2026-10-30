// Two tests that a sceptical reader will ask for before believing a factor:
// does the taste basket still explain returns on weeks it was not fitted on,
// and does it beat a version of itself that has been rotated out of alignment?
// Deterministic code, no model.
import { ols } from "./ols.mjs";

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// A pre-registered split is a test only where the regressor moves. Qloo's pull can
// end in a carry-forward: every basket reads zero on the weeks after the vendor's
// last revision. If that covers the scored slice, the cultural coefficient is
// multiplied by zero on every scored week, so the held-out cell has no power at any
// effect size and must be labelled untestable rather than read as a negative.
export function scoringDiagnostics({ baskets, dates, trainWeeks, tol = 1e-12 }) {
  if (!baskets.length) throw new Error("scoringDiagnostics: no baskets");
  if (baskets.some((b) => b.length !== dates.length)) throw new Error("scoringDiagnostics: basket length mismatch");
  const activeInTest = baskets.map((b) => b.slice(trainWeeks).filter((v) => Math.abs(v) > tol).length);
  const frozenDates = [];
  for (let t = trainWeeks; t < dates.length; t++) {
    if (baskets.every((b) => Math.abs(b[t]) <= tol)) frozenDates.push(dates[t]);
  }
  let lastMove = -1;
  for (let t = 0; t < dates.length; t++) {
    if (baskets.some((b) => Math.abs(b[t]) > tol)) lastMove = t;
  }
  return {
    testWeeks: dates.length - trainWeeks,
    medianActive: median(activeInTest),
    minActive: Math.min(...activeInTest),
    maxActive: Math.max(...activeInTest),
    frozenWeeks: frozenDates.length,
    frozenFrom: frozenDates[0] ?? null,
    testable: activeInTest.some((n) => n > 0),
    lastMove: lastMove >= 0 ? dates[lastMove] : null,
    frozenAfterWindow: dates.length - 1 - lastMove,
    note: "active = weeks in the scored slice where the name's taste basket return is non-zero; frozen = weeks where it is zero for every name at once (the endpoint's refresh tail), which carry no identification for the taste slope. testable is false when no name's basket moves in any scored week",
  };
}

function r2On(y, yhat) {
  const m = mean(y);
  const sst = y.reduce((s, v) => s + (v - m) ** 2, 0);
  const sse = y.reduce((s, v, i) => s + (v - yhat[i]) ** 2, 0);
  return 1 - sse / sst;
}

// Fit on the first k weeks, score on the rest. Never clamped: a factor that adds
// nothing out of sample must be allowed to report a negative ΔR².
export function outOfSample({ y, x, basket, trainShare = 0.66 }) {
  const c = oosComponents({ y, x, basket, trainShare });
  const r2 = r2On(c.yTe, c.yhatFull);
  const r2Market = r2On(c.yTe, c.yhatMarket);
  return { trainWeeks: c.trainWeeks, testWeeks: c.testWeeks, r2, r2Market, deltaR2: r2 - r2Market };
}

// The fitted forecasts behind an out-of-sample number, kept separately so a
// resampled test week costs a subtraction rather than a refit. The training
// coefficients never move; only which test weeks are scored.
export function oosComponents({ y, x, basket, trainShare = 0.66 }) {
  const n = y.length;
  const k = Math.min(Math.max(Math.round(n * trainShare), 24), n - 12);
  const tr = (a) => a.slice(0, k);
  const te = (a) => a.slice(k);
  const [yTe, xTe, bTe] = [te(y), te(x), te(basket)];
  const full = ols(tr(y), [tr(x), tr(basket)]);
  const mkt = ols(tr(y), [tr(x)]);
  const predict = (beta, cols) => yTe.map((_, i) => beta[0] + cols.reduce((s, c, j) => s + beta[j + 1] * c[i], 0));
  return { trainWeeks: k, testWeeks: n - k, yTe, yhatFull: predict(full.beta, [xTe, bTe]), yhatMarket: predict(mkt.beta, [xTe]) };
}

// Circular block resampling of the test weeks: consecutive weeks stay together
// so autocorrelation survives the resample. Used to put a standard error on a
// book-mean ΔR², which is otherwise a point with no uncertainty attached.
export function blockDraws(testN, { draws = 400, seed = 20261029, blockWeeks = 8 } = {}) {
  const rnd = mulberry32(seed);
  const out = [];
  for (let d = 0; d < draws; d++) {
    const idx = [];
    while (idx.length < testN) {
      const start = Math.floor(rnd() * testN);
      for (let b = 0; b < blockWeeks && idx.length < testN; b++) idx.push((start + b) % testN);
    }
    out.push(idx);
  }
  return out;
}

// meanAt(idx) scores one draw; the draws give the sampling distribution of the
// book mean. Quantiles are 5 / 95, i.e. a 90% interval, stated as such.
export function bootstrapMean(meanAt, testN, { draws = 400, seed = 20261029, blockWeeks = 8, prefix = 0 } = {}) {
  const stats = blockDraws(testN, { draws, seed: seed + prefix, blockWeeks }).map(meanAt);
  return { draws, blockWeeks, seed: seed + prefix, ...spread(stats) };
}

// The fixed-coefficient bootstrap above moves only the scored weeks, so it
// measures sampling error in the test slice and nothing else. Refitting each
// draw adds estimation error in the coefficients, which is the conservative
// direction: this interval is at least as wide, and it is the one a referee
// would reproduce if they asked what happens when the fit is allowed to move.
export function refitBootstrapMean(stat, weeks, { draws = 200, seed = 20261029, blockWeeks = 8, trainShare = 0.66, prefix = 0 } = {}) {
  const k = trainK(weeks, trainShare);
  const stats = blockDraws(weeks, { draws, seed: seed + prefix, blockWeeks })
    .map((idx) => stat(idx.slice(0, k), idx.slice(k)));
  return { draws, blockWeeks, seed: seed + prefix, trainWeeks: k, testWeeks: weeks - k, ...spread(stats) };
}

// One refit-per-draw ΔR²: fit on the resampled train rows, score the resampled
// test rows, against the same model with only its first `baseCount` columns.
export function refitDeltaR2(y, cols, tr, te, baseCount) {
  const pick = (a, idx) => idx.map((i) => a[i]);
  const yTr = pick(y, tr), yTe = pick(y, te);
  const fitOn = (n) => ols(yTr, cols.slice(0, n).map((c) => pick(c, tr)));
  const predictOn = (fit, n) => te.map((i) => fit.beta[0] + cols.slice(0, n).reduce((s, c, j) => s + fit.beta[j + 1] * c[i], 0));
  const base = predictOn(fitOn(baseCount), baseCount);
  const full = predictOn(fitOn(cols.length), cols.length);
  const m = mean(yTe);
  const sst = yTe.reduce((s, v) => s + (v - m) ** 2, 0);
  const sse = (yhat) => yTe.reduce((s, v, i) => s + (v - yhat[i]) ** 2, 0);
  return sst === 0 ? 0 : (sse(base) - sse(full)) / sst;
}

// The same refit bootstrap carried through per name as well as across the book,
// so a single pass yields both the book interval and a per-name interval. The
// split itself is held fixed: train rows are resampled among train weeks and
// test rows among test weeks, so a draw changes the fit and the scored weeks but
// never mixes the two halves.
export function refitBootstrap(items, colsOf, { weeks, baseCount, draws = 200, seed = 20261029, blockWeeks = 8, trainShare = 0.66 } = {}) {
  const k = trainK(weeks, trainShare);
  const trDraws = blockDraws(k, { draws, seed, blockWeeks });
  const teDraws = blockDraws(weeks - k, { draws, seed: seed + 97, blockWeeks });
  const perItem = items.map(() => []);
  for (let d = 0; d < draws; d++) {
    const tr = trDraws[d];
    const te = teDraws[d].map((i) => i + k);
    items.forEach((it, i) => perItem[i].push(refitDeltaR2(it.y, colsOf(it), tr, te, baseCount)));
  }
  const bookStats = perItem[0].map((_, d) => mean(perItem.map((a) => a[d])));
  return {
    draws, blockWeeks, seed, trainWeeks: k, testWeeks: weeks - k,
    book: spread(bookStats),
    perItem: perItem.map((a) => spread(a)),
  };
}

const trainK = (n, trainShare) => Math.min(Math.max(Math.round(n * trainShare), 24), n - 12);

// The fixed-coefficient interval carried to every name: the fit is held still
// and only the scored weeks move, so each row can print the same two ranges the
// book does. Uses the per-name test predictions already in the components, so
// no refit happens here.
export function fixedBootstrapPerItem(comps, { weeks, draws = 400, seed = 20261029, blockWeeks = 8, trainShare = 0.66 } = {}) {
  const k = trainK(weeks, trainShare);
  const idxDraws = blockDraws(weeks - k, { draws, seed, blockWeeks });
  return comps.map((c) => {
    const stats = idxDraws.map((idx) => {
      const m = mean(idx.map((j) => c.yTe[j]));
      const sst = idx.reduce((s, j) => s + (c.yTe[j] - m) ** 2, 0);
      if (sst === 0) return 0;
      const sse = (yh) => idx.reduce((s, j) => s + (c.yTe[j] - yh[j]) ** 2, 0);
      return (sse(c.yhatMarket) - sse(c.yhatFull)) / sst;
    });
    return { draws, blockWeeks, ...spread(stats) };
  });
}

function spread(stats) {
  const m = mean(stats);
  const sd = Math.sqrt(stats.reduce((s, v) => s + (v - m) ** 2, 0) / (stats.length - 1));
  const sorted = stats.slice().sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
  return { se: sd, lo: q(0.05), hi: q(0.95) };
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
// Circular rotation keeps the factor's cadence and destroys only its alignment
// with returns. On a sparse factor that is a weak null: the rotation moves the
// block of moving weeks as a unit, so it never asks whether the *pattern* of
// moving weeks matters. A date permutation keeps the multiset of weekly moves —
// the same sharp jumps, and the same permutation for every name so cross-name
// alignment survives — but scatters them over the calendar freely. Two nulls
// that agree are worth more than one; where they disagree, the rotation is the
// conservative one for a serially correlated factor and the permutation is the
// richer one for a sparse one.
export function bookDatePermutation(items, { draws = 400, seed = 20261029, blockWeeks = 6 } = {}) {
  if (!items.length) throw new Error("date permutation: no holdings");
  const n = items[0].basket.length;
  if (items.some((it) => it.basket.length !== n)) throw new Error("date permutation: basket length mismatch");
  const mkt = items.map((it) => ols(it.y, [it.x]));
  const real = items.map((it, i) => ols(it.y, [it.x, it.basket]).r2 - mkt[i].r2);
  const realMean = mean(real);

  const rnd = mulberry32(seed);
  // A week-by-week shuffle dissolves the refresh cadence: a step that lasted weeks
  // becomes isolated spikes, which is a book the data could never have produced. The
  // second null shuffles whole blocks instead, so each basket keeps its local serial
  // structure and only the order of the blocks changes. Reported beside the first
  // rather than swapped in, because the choice between them is not ours to make after
  // seeing the answer.
  const rndBlock = mulberry32(seed + 977);
  const bookDraws = [];
  const blockMeans = [];
  const hits = new Array(items.length).fill(0);
  let ge = 0;
  let geBlocked = 0;
  const nb = Math.floor(n / blockWeeks);
  for (let d = 0; d < draws; d++) {
    const idx = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const deltas = items.map((it, i) => ols(it.y, [it.x, idx.map((j) => it.basket[j])]).r2 - mkt[i].r2);
    for (let i = 0; i < deltas.length; i++) if (deltas[i] >= real[i]) hits[i]++;
    const m = mean(deltas);
    bookDraws.push(m);
    if (m >= realMean) ge++;

    const order = [...Array(nb).keys()];
    for (let i = nb - 1; i > 0; i--) { const j = Math.floor(rndBlock() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const bidx = [];
    for (const b of order) for (let k = 0; k < blockWeeks; k++) bidx.push(b * blockWeeks + k);
    for (let t = nb * blockWeeks; t < n; t++) bidx.push(t);
    const bm = mean(items.map((it, i) => ols(it.y, [it.x, bidx.map((j) => it.basket[j])]).r2 - mkt[i].r2));
    blockMeans.push(bm);
    if (bm >= realMean) geBlocked++;
  }
  const sorted = [...bookDraws].sort((a, b) => a - b);
  return {
    draws,
    seed,
    real: realMean,
    p: (1 + ge) / (1 + draws),
    placeboMean: mean(bookDraws),
    placeboP95: sorted[Math.min(sorted.length - 1, Math.floor(draws * 0.95))],
    blockWeeks,
    pBlocked: (1 + geBlocked) / (1 + draws),
    blockedMean: mean(blockMeans),
    perHolding: { real, p: hits.map((h) => (1 + h) / (1 + draws)) },
  };
}

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
