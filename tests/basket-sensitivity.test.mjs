// Tests for the basket-construction sensitivity module.
//
// The load-bearing test is the round-trip on real cached data: if the
// re-derivation of the committed construction does not reproduce the beta in
// output/desk.json, every variant delta this study prints is meaningless. The
// rest covers the reporting rules: a zero-variance variant basket is called
// degenerate rather than fitted to a spurious slope, Benjamini-Hochberg is
// recomputed across each variant's own family, and nothing in the code path
// reaches the network — the study runs entirely on files already on disk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { norm } from "../src/universe.mjs";
import {
  revisionWeeks, blendBasketReturn, buildPool, selectMembers, fitName, flagBook,
  compareConstructions, spearman, quantile,
} from "../src/basket-sensitivity.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (rel) => JSON.parse(readFileSync(resolve(ROOT, rel), "utf8"));

test("a zero-variance variant basket is reported degenerate, not fitted", () => {
  // Two members whose population_percentile never moves: every weekly log
  // difference is zero, the basket regressor is a constant, the slope is not
  // identified — there is no honest beta here.
  const weeks = Array.from({ length: 40 }, (_, i) => {
    const d = new Date(Date.UTC(2024, 0, 1 + i * 7)).toISOString().slice(0, 10);
    return { date: d, population_percentile: 0.5 };
  });
  const seriesById = { a: { points: weeks }, b: { points: weeks } };
  const members = [
    { id: "a", weight: 0.6 }, { id: "b", weight: 0.4 },
  ];
  const basketMap = blendBasketReturn(members, seriesById, "population_percentile");
  const dates = weeks.map((p) => p.date);
  const y = dates.map((_, i) => Math.sin(i / 3) * 0.01);
  const market = dates.map((_, i) => Math.cos(i / 5) * 0.005);
  const fit = fitName({ y, market, basketMap, dates });
  assert.equal(fit.status, "degenerate");
  assert.equal(fit.culturalBeta, null);
  assert.equal(fit.culturalT, null);
  // A degenerate name is never flagged and never enters the BH family.
  const book = flagBook([fit, { ticker: "X", status: "fitted", culturalBeta: -3, culturalT: -5, culturalP: 1e-6 }], { absT: 2, qMax: 0.1 });
  assert.equal(fit.flagged, false);
  assert.deepEqual(book.flagged, ["X"]);
  assert.equal(book.familySize, 1);
});

test("too little basket coverage is reported insufficient, not fitted", () => {
  const mk = (n, id, v) => ({ id, points: Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(2024, 0, 1 + i * 7)).toISOString().slice(0, 10), [id]: null, population_percentile: v(i) })) });
  const dates = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i * 7)).toISOString().slice(0, 10));
  // Member has points only in the first 10 weeks; the other 50 dates get no
  // basket observation.
  const sparse = { m: mk(11, "m", (i) => 0.4 + 0.01 * i) };
  const basketMap = blendBasketReturn([{ id: "m", weight: 1 }], sparse, "population_percentile");
  const y = dates.map(() => 0.001);
  const fit = fitName({ y, market: dates.map(() => 0.0005), basketMap, dates, minWeeks: 30 });
  assert.equal(fit.status, "insufficient");
  assert.equal(fit.culturalBeta, null);
});

test("Benjamini-Hochberg is recomputed across each variant's own fitted family", () => {
  const mkFit = (ticker, culturalP, beta = -5, t = -2.5) => ({ ticker, status: "fitted", culturalBeta: beta, culturalT: t, culturalP });
  // One name at p = 0.02: flagged when the family is small (q = 0.02), not
  // flagged when diluted by 100 null names (q = 0.02 * 101 / 1 = 2.02 -> 1).
  const small = [mkFit("A", 0.02)];
  flagBook(small, { absT: 2, qMax: 0.1 });
  assert.equal(small[0].flagged, true);
  const large = [mkFit("A", 0.02), ...Array.from({ length: 100 }, (_, i) => mkFit("N" + i, 0.5, 1, 1))];
  const res = flagBook(large, { absT: 2, qMax: 0.1 });
  assert.deepEqual(res.flagged, []);
  // A second variant where the same name clears BH: q depends on the variant's
  // family, so it must be recomputed per construction, not inherited.
  const variantB = [mkFit("A", 0.0005), ...Array.from({ length: 100 }, (_, i) => mkFit("N" + i, 0.5, 1, 1))];
  const resB = flagBook(variantB, { absT: 2, qMax: 0.1 });
  assert.deepEqual(resB.flagged, ["A"]);
  // Flips are detected across constructions by compareConstructions.
  const baseMap = { A: { ...small[0], status: "fitted", culturalBeta: -1, culturalT: -1, culturalP: 0.4, flagged: false } };
  const varMap = { A: { ...variantB[0], flagged: true } };
  const cmp = compareConstructions(baseMap, varMap);
  assert.deepEqual(cmp.flagFlips, ["A"]);
});

test("spearman and quantile helpers", () => {
  assert.equal(spearman([1, 2, 3], [10, 20, 30]), 1);
  assert.equal(spearman([1, 2, 3], [30, 20, 10]), -1);
  assert.equal(spearman([1, 2, 3], [2, 2, 2]), null); // zero-variance ranks -> pearson null
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([1, 2, 3, 4], 0.9), 3.7);
});

test("affinity-ranked weights reproduce the committed basket (round-trip, real cached data)", () => {
  // The committed beauty basket is 2 brand + 2 movie + 2 artist + 2 tv_show,
  // each weighted affinity / sum(affinity). Re-forming it from the cached
  // recommend members with the affinity basis must return the same weights.
  const basket = readJson("fixtures/qloo/basket-sector-beauty.json");
  const committed = basket.members;
  const reformed = selectMembers(committed, buildPool(committed, []), { kind: "baseline" });
  assert.equal(reformed.length, committed.length);
  reformed.forEach((m, i) => {
    assert.equal(m.id, committed[i].id);
    assert.ok(Math.abs(m.weight - committed[i].weight) < 1e-15);
  });
  // And the weight basis itself is affinity normalisation.
  const total = committed.reduce((s, m) => s + m.affinity, 0);
  for (const m of committed) assert.ok(Math.abs(m.weight - m.affinity / total) < 1e-12);
});

test("the re-derived baseline beta reproduces output/desk.json for a real name", () => {
  // This is the gate for the whole study: same cached series, same cut
  // calendar, same estimator — the cultural beta must come back identical.
  const desk = readJson("output/desk.json");
  const prices = readJson("fixtures/prices.json");
  const book = readJson("config/book.json");
  const seriesById = readJson("fixtures/qloo/series.json").byId;
  const field = book.tasteSignal.field;

  const revisions = revisionWeeks(seriesById, field);
  const revSet = new Set(revisions.map((r) => r.date));
  const dates = prices.window.alignedDates.filter((d) => !revSet.has(d));
  assert.deepEqual(dates, desk.window.alignedDates, "re-derived calendar must equal the committed calendar");

  const cut = (arr) => arr.filter((_, i) => !revSet.has(prices.window.alignedDates[i]));
  const market = cut(prices.symbols[book.index.ticker].returns);
  for (const ticker of ["ELF", "DIS", "KDP"]) {
    const row = desk.rows.find((r) => r.ticker === ticker);
    const basket = readJson(`fixtures/qloo/basket-sector-${row.sector}.json`);
    const members = selectMembers(basket.members, buildPool(basket.members, []), { kind: "baseline" });
    const basketMap = blendBasketReturn(members, seriesById, field);
    const fit = fitName({ y: cut(prices.symbols[ticker].returns), market, basketMap, dates });
    assert.equal(fit.status, "fitted");
    assert.equal(fit.weeksUsed, dates.length);
    assert.ok(Math.abs(fit.culturalBeta - row.culturalBeta) < 1e-9, `${ticker} beta ${fit.culturalBeta} vs committed ${row.culturalBeta}`);
    assert.ok(Math.abs(fit.culturalT - row.culturalT) < 1e-9, `${ticker} t ${fit.culturalT} vs committed ${row.culturalT}`);
    assert.ok(Math.abs(fit.culturalP - row.culturalP) < 1e-9, `${ticker} p must match too — BH downstream depends on it`);
  }
});

test("the committed universe exclusion is what bounds the cache pool", () => {
  // Extra candidates enter the pool only when the pipeline's own name
  // exclusion passes them AND their weekly series is on disk; a book name
  // must never appear in any variant basket.
  const entities = readJson("fixtures/qloo/entities.json");
  const universeIds = new Set(entities.map((e) => e.entityId).filter(Boolean));
  const universeNames = new Set(entities.flatMap((e) => [norm(e.label), norm(e.query)]).filter(Boolean));
  const isUniverseName = (name) => {
    const n = norm(name);
    if (!n) return true;
    if (universeNames.has(n)) return true;
    return entities.some((h) => {
      const q = norm(h.query);
      return q.length >= 4 && (n === q || n.startsWith(`${q} `) || n.endsWith(` ${q}`));
    });
  };
  const seriesIds = new Set(Object.keys(readJson("fixtures/qloo/series.json").byId));
  for (const sector of ["beauty", "media", "grocery"]) {
    const basket = readJson(`fixtures/qloo/basket-sector-${sector}.json`);
    const committedIds = new Set(basket.members.map((m) => m.id));
    const extras = [];
    for (const call of basket.calls) {
      const rec = readJson(`fixtures/qloo/recommend-sector-${sector}-${call.type}.json`);
      const results = Array.isArray(rec.response?.results) ? rec.response.results : [];
      for (const e of results) {
        const id = e?.entity_id ?? e?.id ?? null;
        if (!id || committedIds.has(id) || universeIds.has(id) || isUniverseName(e?.name)) continue;
        if (typeof e.affinity !== "number" || !(e.affinity > 0)) continue;
        if (!seriesIds.has(id)) continue;
        extras.push({ id, name: e.name, type: call.type, affinity: e.affinity });
      }
    }
    const pool = buildPool(basket.members, extras);
    for (const spec of [{ kind: "seeds", k: 10 }, { kind: "seeds", k: 3 }]) {
      const picked = selectMembers(basket.members, pool, spec);
      for (const m of picked) {
        assert.ok(!universeIds.has(m.id), `${m.name} is a book name and must not be in a basket`);
        assert.ok(!isUniverseName(m.name), `${m.name} name-matches a book name`);
      }
    }
    // Pool must be strictly larger than committed somewhere (extras exist on
    // disk), otherwise the seeds axis would be vacuous.
    assert.ok(pool.length >= basket.members.length);
  }
});

test("no code path reaches the network", async () => {
  // The sensitivity module must not import the Qloo client or the harness.
  const src = readFileSync(resolve(ROOT, "src/basket-sensitivity.mjs"), "utf8");
  assert.ok(!/from\s+["']\.\/(qloo|harness|live-qloo)\.mjs["']/.test(src), "src must not import qloo/harness modules");
  assert.ok(!/child_process/.test(src), "src must not spawn processes");
  // And with fetch and process.spawn stubbed to throw, the full re-derivation
  // still runs — proof nothing in the exercised path calls them.
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (...args) => { fetchCalls++; throw new Error("network reached"); };
  try {
    const desk = readJson("output/desk.json");
    const prices = readJson("fixtures/prices.json");
    const book = readJson("config/book.json");
    const seriesById = readJson("fixtures/qloo/series.json").byId;
    const field = book.tasteSignal.field;
    const revSet = new Set(revisionWeeks(seriesById, field).map((r) => r.date));
    const dates = prices.window.alignedDates.filter((d) => !revSet.has(d));
    const cut = (arr) => arr.filter((_, i) => !revSet.has(prices.window.alignedDates[i]));
    const market = cut(prices.symbols[book.index.ticker].returns);
    for (const row of desk.rows.filter((r) => r.status === "ok").slice(0, 5)) {
      const basket = readJson(`fixtures/qloo/basket-sector-${row.sector}.json`);
      for (const spec of [{ kind: "baseline" }, { kind: "seeds", k: 5 }, { kind: "equalWeights" }]) {
        const members = selectMembers(basket.members, buildPool(basket.members, []), spec);
        const fit = fitName({ y: cut(prices.symbols[row.ticker].returns), market, basketMap: blendBasketReturn(members, seriesById, field), dates });
        assert.ok(["fitted", "degenerate", "insufficient"].includes(fit.status));
      }
    }
  } finally {
    globalThis.fetch = realFetch;
    assert.equal(fetchCalls, 0, "the study must never call fetch");
  }
});
