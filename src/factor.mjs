// Cultural factor construction.
//
// Inputs, all from live Qloo calls:
//   basket-<T>.json   entities a holding's audience leans toward, with the
//                     affinity Qloo ranked them by. The book's own holdings are
//                     excluded by construction, so the basket is the cultural
//                     neighbourhood of a brand, not the rest of the book.
//   series.json       weekly trending points for every basket member.
//
// tasteReturn_t = ln(level_t / level_{t-1}) of the weekly `population_percentile`
// a basket member holds, with several same-week points averaged into one level.
// The week-over-week difference, not the level: a level entered on its own would
// price a name by how popular its audience's favourites are, which is a
// cross-section, not a cultural return.
//
// This replaced the pre-registered `velocity_fold_change` reading on 2026-10-30,
// once the keyed pull had measured it: that field is 0 on 71 of the 106
// primary-window weeks, the same dates are zero for every entity (Qloo's own
// refresh cadence, not per-entity stillness), and it equals
// `population_percent_delta` on every cached point. The level is the field that
// moves, and a zero difference on a flat week now reads as what the endpoint
// recorded — no cultural movement — rather than as a missing observation.
//
// Basket return for week t = sum(w_i * r_it) / sum(w_i present at t): if a member
// has no point that week it is re-weighted out, not zero-filled. A week with no
// adjacent earlier week carries no difference rather than a stretched one, so a
// gap in a member's history never invents change. No Qloo input throws — the
// pipeline never prints a beta it cannot source.
import { readCache } from "./qloo.mjs";

const weekMonday = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

// One level per ISO week, averaged across whatever points landed in it — the API
// cadence is weekly today but a finer one would still be one number per week.
function weeklyLevels(points, cfg) {
  const acc = new Map();
  for (const p of points ?? []) {
    if (!p?.date) continue;
    const v = p[cfg.field];
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

export function tasteSeries(trendingFile, cfg) {
  const levels = weeklyLevels(trendingFile.points ?? [], cfg);
  const out = new Map();
  for (const [wk, level] of levels) {
    const prev = levels.get(shiftDay(wk, -7));
    if (prev === undefined || !(prev > 0) || !Number.isFinite(level)) continue;
    out.set(wk, Math.log(level / prev));
  }
  return out;
}

const shiftDay = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// Qloo revises its catalogue wholesale on a few dates, and the level series jumps
// with it. Measured on the live pull: on 2025-04-11 and 2025-10-17 most entities'
// percentiles moved by a factor of two or more in the same week, while the median
// weekly move everywhere else is 0.0000. That is an index rescaling, not people
// changing their minds, and a week-over-week "return" computed across it would be
// a 3-4 log-unit outlier carrying no cultural information.
//
// Those weeks are cut from the windows rather than modelled with dummies: every
// name shares the same dates, so a dummy would absorb the same weeks everywhere
// and leave nothing to estimate, while dropping the week keeps every series
// aligned — the level after the jump still differences normally against the week
// after it, so only the boundary week is lost.
//
// The cut is on the median move across the book, not on a per-name outlier: a
// typical week's median is 0.0007 in log units because most entities are frozen,
// while the revision weeks read 0.195-0.262. The threshold sits at 0.05, more than
// fifty times a normal week and four times below the smallest revision, so the
// separation is not a tuning choice. Points are bucketed to the same Monday keys
// the price windows use, because the endpoint stamps its points on whatever day it
// refreshed rather than on the window's calendar.
export function revisionWeeks(seriesById, cfg, { medianMove = 0.05, minEntities = 20 } = {}) {
  const perDate = new Map();
  for (const e of Object.values(seriesById ?? {})) {
    const level = weeklyLevels(e?.points ?? [], cfg);
    for (const [d, v] of level) {
      const prev = level.get(shiftDay(d, -7));
      if (prev === undefined || !(prev > 0)) continue;
      const moves = perDate.get(d) ?? [];
      moves.push(Math.abs(Math.log(v / prev)));
      perDate.set(d, moves);
    }
  }
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  return [...perDate]
    .filter(([, moves]) => moves.length >= minEntities && median(moves) >= medianMove)
    .map(([d, moves]) => ({ date: d, medianMove: Number(median(moves).toFixed(4)), entities: moves.length }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function alignTaste(map, dates) {
  return dates.map((d) => map.get(d) ?? null);
}

export function blendBasket(members, seriesById, cfg) {
  const acc = new Map();
  for (const m of members) {
    const points = seriesById[m.id]?.points ?? [];
    for (const [wk, r] of tasteSeries({ points }, cfg)) {
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

// Every name is measured against its sub-sector's basket, so one factor prices
// the whole book. Featured names additionally carry an audience-level basket
// built from their own entity; that reading is reported separately and never
// replaces the comparable sector number.
export function loadCulturalInputs(book, universe) {
  const entitiesFile = readCache("entities.json");
  const seriesFile = readCache("series.json");
  if (!entitiesFile || !seriesFile) {
    const err = new Error("QLOO_REQUIRED: fixtures/qloo/entities.json and series.json must exist from live Qloo calls. Refusing to print betas without Qloo.");
    err.code = "QLOO_REQUIRED";
    throw err;
  }
  const byId = seriesFile.byId ?? {};
  const idByTicker = Object.fromEntries(entitiesFile.map((r) => [r.ticker, r.entityId]));
  const sectorBaskets = {};
  const ownBaskets = {};
  const taste = {};
  const ownTaste = {};

  const resolved = entitiesFile.filter((e) => e.entityId);
  for (const name of resolved) {
    const sector = name.sector;
    if (!sector) {
      const err = new Error(`QLOO_REQUIRED: fixtures/qloo/entities.json row ${name.ticker} has no sector.`);
      err.code = "QLOO_REQUIRED";
      throw err;
    }
    if (!sectorBaskets[sector]) {
      const b = readCache(`basket-sector-${sector}.json`);
      if (!b?.members?.length) {
        const err = new Error(`QLOO_REQUIRED: fixtures/qloo/basket-sector-${sector}.json is missing or empty. Run qloo-sector-basket, then qloo-series.`);
        err.code = "QLOO_REQUIRED";
        throw err;
      }
      sectorBaskets[sector] = b;
    }
    taste[name.ticker] = blendBasket(sectorBaskets[sector].members, byId, book.tasteSignal);
  }

  for (const name of resolved.filter((e) => e.featured)) {
    const b = readCache(`basket-${name.ticker}.json`);
    if (!b?.members?.length) {
      const err = new Error(`QLOO_REQUIRED: fixtures/qloo/basket-${name.ticker}.json is missing or empty. Run qloo-basket, then qloo-series.`);
      err.code = "QLOO_REQUIRED";
      throw err;
    }
    ownBaskets[name.ticker] = b.members;
    ownTaste[name.ticker] = blendBasket(b.members, byId, book.tasteSignal);
  }

  return { entities: entitiesFile, idByTicker, sectorBaskets, ownBaskets, taste, ownTaste, series: byId };
}
