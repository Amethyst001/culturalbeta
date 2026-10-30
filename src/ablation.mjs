// The ablation arm. Every argument on this desk says the taste basket explains
// return variation a market beta cannot see. A same-sector peer basket — the
// equal-weight weekly return of the other names in the sub-sector, from the same
// committed prices — is the control: it captures sector co-movement without
// Qloo. If the Qloo basket adds nothing over that control, the instrument is not
// load-bearing and the desk should read so.
//
// Nested comparison per name:
//   A: return ~ SPY
//   B: return ~ SPY + sector peers        (ΔR² = peerDeltaR2)
//   C: return ~ SPY + peers + taste       (ΔR² = tasteExtraR2 over B)
// The reported taste t is the basket coefficient inside C.
import { ols } from "./ols.mjs";

export function peerBasket(returnsByTicker, tickers, self, weeks) {
  const mates = tickers.filter((t) => t !== self).map((t) => returnsByTicker[t]).filter(Boolean);
  if (!mates.length) return null;
  const out = new Array(weeks);
  for (let i = 0; i < weeks; i++) {
    let sum = 0;
    for (const m of mates) sum += m[i];
    out[i] = sum / mates.length;
  }
  return out;
}

export function ablationOf(y, market, peer, taste) {
  const mkt = ols(y, [market]);
  const peerReg = ols(y, [market, peer]);
  const joint = ols(y, [market, peer, taste]);
  return {
    sectorBeta: peerReg.beta[2],
    sectorSE: peerReg.se[2],
    sectorT: peerReg.t[2],
    peerDeltaR2: peerReg.r2 - mkt.r2,
    tasteExtraR2: joint.r2 - peerReg.r2,
    tasteExtraT: joint.t[3],
  };
}

// In-sample ΔR² cannot fall when a regressor is added, so the ablation needs the
// same discipline as the main result: fit the peer-only and peer+taste models on
// the train slice, score both on weeks neither saw, and report the signed gap.
export function ablationOos({ y, market, peer, taste, trainShare = 0.66 }) {
  const c = ablationComponents({ y, market, peer, taste, trainShare });
  const r2 = (yhat) => {
    const m = mean(c.yTe);
    const sst = c.yTe.reduce((s, v) => s + (v - m) ** 2, 0);
    return 1 - c.yTe.reduce((s, v, i) => s + (v - yhat[i]) ** 2, 0) / sst;
  };
  const r2Peer = r2(c.yhatPeer), r2Joint = r2(c.yhatJoint);
  return { trainWeeks: c.trainWeeks, testWeeks: c.testWeeks, r2Peer, r2Joint, tasteExtraOosR2: r2Joint - r2Peer };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Forecasts kept apart from the R² so a resampled test week is a subtraction.
export function ablationComponents({ y, market, peer, taste, trainShare = 0.66 }) {
  const n = y.length;
  const k = Math.min(Math.max(Math.round(n * trainShare), 24), n - 12);
  const tr = (a) => a.slice(0, k);
  const te = (a) => a.slice(k);
  const peerFit = ols(tr(y), [tr(market), tr(peer)]);
  const jointFit = ols(tr(y), [tr(market), tr(peer), tr(taste)]);
  const cols = [te(market), te(peer), te(taste)];
  const predict = (beta) => {
    const used = cols.slice(0, beta.length - 1);
    return te(y).map((_, i) => beta[0] + used.reduce((s, c, j) => s + beta[j + 1] * c[i], 0));
  };
  return { trainWeeks: k, testWeeks: n - k, yTe: te(y), yhatPeer: predict(peerFit.beta), yhatJoint: predict(jointFit.beta) };
}

// The ablation needs its own null. `bookPlacebo` rotates the basket and asks how
// often a rotation beats the real taste-over-market ΔR²; the ablation's claim is
// taste over *peers*, so the same rotation has to be scored against the peer
// models instead. Peer-only never touches the basket, so it is fitted once per
// name and only the joint model is refitted inside each draw.
export function ablationPlacebo(items, { draws = 400, seed = 20261029, minShift = 20, trainShare = 0.66 } = {}) {
  if (!items.length) throw new Error("ablation placebo: no holdings");
  const n = items[0].basket.length;
  if (items.some((it) => it.basket.length !== n)) throw new Error("ablation placebo: basket length mismatch");
  const span = n - 2 * minShift;
  if (span < 1) throw new Error("ablation placebo: series too short to rotate");

  const prep = items.map((it) => {
    const k = Math.min(Math.max(Math.round(n * trainShare), 24), n - 12);
    const tr = (a) => a.slice(0, k);
    const te = (a) => a.slice(k);
    const peerFit = ols(tr(it.y), [tr(it.market), tr(it.peer)]);
    const yTe = te(it.y), mTe = te(it.market), pTe = te(it.peer);
    const yhatPeer = yTe.map((_, i) => peerFit.beta[0] + peerFit.beta[1] * mTe[i] + peerFit.beta[2] * pTe[i]);
    const m = mean(yTe);
    return { it, tr, te, yTe, mTe, pTe, yhatPeer, sst: yTe.reduce((s, v) => s + (v - m) ** 2, 0) };
  });
  const sse = (p, yh) => p.yTe.reduce((s, v, i) => s + (v - yh[i]) ** 2, 0);
  const spread = (a) => Math.max(...a) - Math.min(...a);
  const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
  const sdFull = prep.map((p) => sd(p.it.basket));
  const MIN_TRAIN_WEEKS = 8;
  const MIN_TRAIN_SD = 0.05;
  // A rotated basket can land almost all of its movement in the test slice, leaving
  // the training window nearly flat. The taste coefficient there is identified by a
  // handful of points, and a nearly-flat regressor throws a coefficient that is
  // numerically valid and statistically meaningless. Those name-draws are skipped —
  // "this rotation carries too little training variation to fit" — rather than
  // scored, because the alternative is a null whose mean is set by 1e3 outliers.
  const identified = (p, i, taste) => {
    const tr = p.tr(taste);
    return tr.filter((v) => Math.abs(v) > 1e-12).length >= MIN_TRAIN_WEEKS && sd(tr) >= MIN_TRAIN_SD * sdFull[i];
  };
  const jointHat = (p, taste) => {
    const tasteTr = p.tr(taste);
    if (!(spread(tasteTr) >= 1e-12)) return null;
    const fit = ols(p.tr(p.it.y), [p.tr(p.it.market), p.tr(p.it.peer), tasteTr]);
    const tTe = p.te(taste);
    const [b0, b1, b2, b3] = fit.beta;
    return p.yTe.map((_, i) => b0 + b1 * p.mTe[i] + b2 * p.pTe[i] + b3 * tTe[i]);
  };
  const extra = (p, yhJoint) => (sse(p, p.yhatPeer) - sse(p, yhJoint)) / p.sst;

  const realBy = prep.map((p, i) => {
    if (!identified(p, i, p.it.basket)) return null;
    const yh = jointHat(p, p.it.basket);
    return yh ? extra(p, yh) : null;
  });
  const live = realBy.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
  if (!live.length) throw new Error("ablation placebo: the real basket is flat in every training window");
  const real = mean(live.map((i) => realBy[i]));

  const rnd = mulberry32(seed);
  const bookDraws = [];
  const hits = new Array(prep.length).fill(0);
  const seen = new Array(prep.length).fill(0);
  let ge = 0, valid = 0, skipped = 0;
  const minPresent = Math.max(1, Math.ceil(live.length * 0.8));
  for (let d = 0; d < draws; d++) {
    const shift = minShift + Math.floor(rnd() * span);
    const vals = new Array(prep.length).fill(null);
    for (const i of live) {
      const rot = rotate(prep[i].it.basket, shift);
      if (!identified(prep[i], i, rot)) continue;
      const yh = jointHat(prep[i], rot);
      if (yh) vals[i] = extra(prep[i], yh);
    }
    const present = live.filter((i) => vals[i] !== null);
    // A draw in which most names lose their training variation says nothing about
    // the book; it is dropped and counted, not averaged in.
    if (present.length < minPresent) { skipped++; continue; }
    for (const i of present) { seen[i]++; if (vals[i] >= realBy[i]) hits[i]++; }
    const m = mean(present.map((i) => vals[i]));
    bookDraws.push(m);
    valid++;
    if (m >= real) ge++;
  }
  const sorted = [...bookDraws].sort((a, b) => a - b);
  return {
    draws,
    validDraws: valid,
    skippedDraws: skipped,
    minTrainWeeks: MIN_TRAIN_WEEKS,
    minTrainSd: MIN_TRAIN_SD,
    seed,
    minShift,
    real,
    p: (1 + ge) / (1 + valid),
    placeboMean: valid ? mean(bookDraws) : null,
    placeboP95: valid ? sorted[Math.min(sorted.length - 1, Math.floor(valid * 0.95))] : null,
    perHolding: { real: realBy, p: hits.map((h, i) => (seen[i] ? (1 + h) / (1 + seen[i]) : null)) },
  };
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
