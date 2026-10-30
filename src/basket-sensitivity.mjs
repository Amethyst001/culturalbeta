// Basket-construction sensitivity, as pure functions. No I/O, no network: every
// input is a data object the caller already read from disk (cached Qloo
// responses, committed prices, output/desk.json). The weekly taste logic and the
// revision-week detection are re-implemented here from the committed algorithm
// (src/factor.mjs) on purpose — the round-trip test in
// tests/basket-sensitivity.test.mjs proves the re-derivation reproduces the
// committed betas bit for bit, which is what makes the variant deltas
// meaningful. The regression itself is imported, not re-implemented, from
// src/ols.mjs so the estimator is literally the desk's estimator.
import { ols } from "./ols.mjs";
import { benjaminiHochberg } from "./multiplicity.mjs";

const shiftDay = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const weekMonday = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

// One level per ISO week, averaged across the points that landed in it.
export function weeklyLevels(points, field) {
  const acc = new Map();
  for (const p of points ?? []) {
    if (!p?.date) continue;
    const v = p[field];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
    const wk = weekMonday(p.date);
    const cur = acc.get(wk) ?? { sum: 0, n: 0 };
    cur.sum += v;
    cur.n++;
    acc.set(wk, cur);
  }
  const out = new Map();
  for (const [wk, { sum, n }] of acc) out.set(wk, sum / n);
  return out;
}

// taste return = ln(level_t / level_{t-1}); a week without an adjacent earlier
// week carries no observation rather than a stretched one.
export function tasteReturnMap(points, field) {
  const levels = weeklyLevels(points, field);
  const out = new Map();
  for (const [wk, level] of levels) {
    const prev = levels.get(shiftDay(wk, -7));
    if (prev === undefined || !(prev > 0) || !Number.isFinite(level)) continue;
    out.set(wk, Math.log(level / prev));
  }
  return out;
}

// Basket return for week t = sum(w_i r_it) / sum(w_i present at t): a member
// with no point that week is re-weighted out, not zero-filled.
export function blendBasketReturn(members, seriesById, field) {
  const acc = new Map();
  for (const m of members) {
    const points = seriesById[m.id]?.points ?? [];
    for (const [wk, r] of tasteReturnMap(points, field)) {
      const cur = acc.get(wk) ?? { sum: 0, weight: 0 };
      cur.sum += m.weight * r;
      cur.weight += m.weight;
      acc.set(wk, cur);
    }
  }
  const out = new Map();
  for (const [wk, { sum, weight }] of acc) if (weight > 0) out.set(wk, sum / weight);
  return out;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Catalogue-revision weeks: dates where the median absolute level move across at
// least minEntities series exceeds medianMove. Mirrors src/factor.mjs so the
// same weeks are cut from the same calendar as the committed run.
export function revisionWeeks(seriesById, field, { medianMove = 0.05, minEntities = 20 } = {}) {
  const perDate = new Map();
  for (const e of Object.values(seriesById ?? {})) {
    const level = weeklyLevels(e?.points ?? [], field);
    for (const [d, v] of level) {
      const prev = level.get(shiftDay(d, -7));
      if (prev === undefined || !(prev > 0)) continue;
      const moves = perDate.get(d) ?? [];
      moves.push(Math.abs(Math.log(v / prev)));
      perDate.set(d, moves);
    }
  }
  return [...perDate]
    .filter(([, moves]) => moves.length >= minEntities && median(moves) >= medianMove)
    .map(([d, moves]) => ({ date: d, medianMove: Number(median(moves).toFixed(4)), entities: moves.length }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---- basket construction under a spec -------------------------------------
// Member list shape everywhere: { id, name, type, weight, affinity }.
// `committed` is the fixed basket file's member list; `pool` is the committed
// members plus the excluded-but-cached candidates from the same sector's
// recommend responses (same universe filter the pipeline applied), so a
// 10-member basket is re-derived from data already on disk, never re-asked.

export function buildPool(committed, extraCandidates = []) {
  const seen = new Set(committed.map((m) => m.id));
  const extras = extraCandidates
    .filter((m) => m?.id && !seen.has(m.id) && typeof m.affinity === "number" && m.affinity > 0)
    .filter((m) => (seen.has(m.id) ? false : seen.add(m.id)));
  return [...committed, ...extras];
}

const renormalise = (picked) => {
  const total = picked.reduce((s, m) => s + m.affinity, 0);
  if (!(total > 0)) return null;
  return picked.map(({ id, name, type, affinity }) => ({ id, name, type, affinity, weight: affinity / total }));
};

// spec kinds:
//  baseline          — the committed members with the committed weights
//  seeds (k)         — top k of the pool ranked by affinity, affinity-normalised
//  equalWeights      — committed members, equal weight
//  brandsOnly        — committed brand members only, affinity-normalised
//  jackknifeDropTop  — committed members minus the single highest weight one
export function selectMembers(committed, pool, spec) {
  switch (spec.kind) {
    case "baseline":
      return committed.map((m) => ({ ...m }));
    case "seeds": {
      const ranked = [...pool].sort((a, b) => b.affinity - a.affinity || String(a.id).localeCompare(String(b.id)));
      return renormalise(ranked.slice(0, spec.k));
    }
    case "equalWeights": {
      if (!committed.length) return null;
      const w = 1 / committed.length;
      return committed.map(({ id, name, type, affinity }) => ({ id, name, type, affinity, weight: w }));
    }
    case "brandsOnly": {
      const brands = committed.filter((m) => m.type === "brand");
      return brands.length >= 2 ? renormalise(brands) : (brands.length === 1 ? [{ ...brands[0], weight: 1 }] : null);
    }
    case "jackknifeDropTop": {
      if (committed.length < 2) return null;
      let maxI = 0;
      committed.forEach((m, i) => { if (m.weight > committed[maxI].weight) maxI = i; });
      return renormalise(committed.filter((_, i) => i !== maxI));
    }
    default:
      throw new Error(`unknown spec ${JSON.stringify(spec)}`);
  }
}

// ---- per-name fit ----------------------------------------------------------
// The desk requires the basket on every aligned week; a variant with fewer
// members can legitimately miss weeks, so the variant fit is complete-case on
// the weeks the basket does carry, with the week count reported beside the
// beta. A basket that never moves is reported degenerate — it has no
// identified slope, and printing one would be the spurious result this whole
// study exists to avoid.
export function fitName({ y, market, basketMap, dates, minWeeks = 30 }) {
  const keep = [];
  for (let i = 0; i < dates.length; i++) if (basketMap.has(dates[i])) keep.push(i);
  if (keep.length < minWeeks) return { status: "insufficient", weeksUsed: keep.length, culturalBeta: null, culturalT: null, culturalP: null };
  const yv = keep.map((i) => y[i]);
  const xv = keep.map((i) => market[i]);
  const bv = keep.map((i) => basketMap.get(dates[i]));
  const mb = bv.reduce((a, b) => a + b, 0) / bv.length;
  const varB = bv.reduce((a, b) => a + (b - mb) ** 2, 0) / bv.length;
  if (!(varB > 0) || varB < 1e-24) return { status: "degenerate", weeksUsed: keep.length, culturalBeta: null, culturalT: null, culturalP: null };
  let reg, mkt;
  try {
    reg = ols(yv, [xv, bv]);
    mkt = ols(yv, [xv]);
  } catch {
    return { status: "degenerate", weeksUsed: keep.length, culturalBeta: null, culturalT: null, culturalP: null };
  }
  return {
    status: "fitted",
    weeksUsed: keep.length,
    culturalBeta: reg.beta[2],
    culturalSE: reg.se[2],
    culturalT: reg.t[2],
    culturalP: reg.p[2],
    marketBeta: reg.beta[1],
    r2: reg.r2,
    r2Market: mkt.r2,
    deltaR2: reg.r2 - mkt.r2,
    activeWeeks: bv.filter((v) => Math.abs(v) > 1e-12).length,
  };
}

// One flag rule for the whole book, recomputed per variant: negative beta,
// |t| screen, Benjamini-Hochberg q over the family that actually fitted under
// this construction. A per-name t is never the criterion on its own.
export function flagBook(fits, { absT, qMax }) {
  const fitted = fits.filter((f) => f.status === "fitted");
  for (const f of fits) {
    f.flagged = false;
    if (f.culturalQ !== undefined) delete f.culturalQ;
  }
  if (!fitted.length) return { flagged: [], familySize: 0 };
  const qs = benjaminiHochberg(fitted.map((f) => f.culturalP));
  fitted.forEach((f, i) => {
    f.culturalQ = qs[i];
    f.flagged = f.culturalBeta < 0 && Math.abs(f.culturalT) >= absT && f.culturalQ <= qMax;
  });
  return { flagged: fitted.filter((f) => f.flagged).map((f) => f.ticker), familySize: fitted.length };
}

// ---- statistics ------------------------------------------------------------
export function quantile(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const h = (s.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (h - lo) * (s[hi] - s[lo]);
}

export function pearson(a, b) {
  const n = a.length;
  if (n < 2) return null;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : null;
}

const ranks = (xs) => {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const r = new Array(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
};

export function spearman(a, b) {
  if (a.length !== b.length || a.length < 2) return null;
  return pearson(ranks(a), ranks(b));
}

// Compare one construction against the baseline, name by name over the names
// that fitted under both.
export function compareConstructions(baseline, variant) {
  const common = Object.keys(variant).filter((t) => baseline[t]?.status === "fitted" && variant[t].status === "fitted");
  const dBeta = common.map((t) => Math.abs(variant[t].culturalBeta - baseline[t].culturalBeta));
  const dT = common.map((t) => Math.abs(variant[t].culturalT - baseline[t].culturalT));
  const betasA = common.map((t) => baseline[t].culturalBeta);
  const betasB = common.map((t) => variant[t].culturalBeta);
  const flaggedInVariant = common.filter((t) => variant[t].flagged);
  const flaggedInBaseline = common.filter((t) => baseline[t].flagged);
  const flips = [...new Set([...flaggedInVariant.filter((t) => !baseline[t].flagged), ...flaggedInBaseline.filter((t) => !variant[t].flagged)])];
  return {
    compared: common.length,
    medianAbsDBeta: quantile(dBeta, 0.5),
    p90AbsDBeta: quantile(dBeta, 0.9),
    maxAbsDBeta: dBeta.length ? Math.max(...dBeta) : null,
    medianAbsDT: quantile(dT, 0.5),
    p90AbsDT: quantile(dT, 0.9),
    maxAbsDT: dT.length ? Math.max(...dT) : null,
    flaggedVariant: flaggedInVariant,
    flaggedBaseline: flaggedInBaseline,
    flagFlips: flips,
    rankCorrPearson: pearson(betasA, betasB),
    rankCorrSpearman: spearman(betasA, betasB),
  };
}
