// Cultural factor construction from Qloo /v2/trending weekly points + affinity basket.
// tasteReturn_t = log(velocity_fold_change) when the value is a positive ratio,
// else population_percent_delta/100 (documented fallback field, same week).
// Basket for holding i = leave-one-out affinity-weighted taste returns of the other
// holdings; weights normalized to sum 1. No Qloo input => throw (never a silent 0).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./env.mjs";
import { readCache } from "./qloo.mjs";

function weekMonday(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function tasteSeries(trendingFile, cfg) {
  const map = new Map();
  for (const p of trendingFile.points ?? []) {
    if (!p?.date) continue;
    const wk = weekMonday(p.date);
    let r = null;
    const vfc = p[cfg.field];
    if (typeof vfc === "number" && Number.isFinite(vfc) && vfc > 0) r = Math.log(vfc);
    else {
      const alt = p[cfg.fallbackField];
      if (typeof alt === "number" && Number.isFinite(alt)) r = alt / 100;
    }
    if (r !== null) map.set(wk, r);
  }
  return map;
}

export function alignTaste(map, dates) {
  return dates.map((d) => map.get(d) ?? null);
}

export function basketWeights(affinityMatrix, tickers, selfTicker) {
  const row = affinityMatrix[selfTicker];
  if (!row) throw new Error(`AFFINITY_MISSING: no affinity row for ${selfTicker}`);
  const terms = tickers.filter((t) => t !== selfTicker).map((t) => [t, row[t]]);
  const usable = terms.filter(([, v]) => typeof v === "number" && v > 0);
  if (!usable.length) throw new Error(`AFFINITY_EMPTY: ${selfTicker} has no positive shared-audience affinity — refusing to fabricate weights`);
  const sum = usable.reduce((s, [, v]) => s + v, 0);
  return usable.map(([t, v]) => [t, v / sum]);
}

export function loadCulturalInputs(book) {
  const entitiesFile = readCache("entities.json");
  const affinityFile = readCache("affinity.json");
  if (!entitiesFile || !affinityFile) {
    const err = new Error("QLOO_REQUIRED: fixtures/qloo/entities.json and affinity.json must exist from live Qloo calls. Refusing to print betas without Qloo.");
    err.code = "QLOO_REQUIRED";
    throw err;
  }
  const idByTicker = Object.fromEntries(entitiesFile.map((r) => [r.ticker, r.entityId]));
  const taste = {};
  const coverage = {};
  for (const t of book.holdings.map((h) => h.ticker)) {
    const f = readCache(`trending-${t}.json`);
    taste[t] = f ? tasteSeries(f, book.tasteSignal) : new Map();
    coverage[t] = taste[t].size;
  }
  return { entities: entitiesFile, affinityMatrix: affinityFile.matrix, idByTicker, taste, coverage };
}
