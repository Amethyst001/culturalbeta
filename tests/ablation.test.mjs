// The ablation arm must be honest in both directions: a planted taste factor on
// top of a real sector effect is found over the peer control, and a world with
// only market + peers yields no taste gain. Deterministic synthetic data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { peerBasket, ablationOf, ablationOos, ablationPlacebo } from "../src/ablation.mjs";

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = Math.imul(1664525, s) + 1013904223 >>> 0; return s / 4294967296 - 0.5; };
}

function world({ tasteWeight, seed = 7, n = 90 }) {
  const rnd = lcg(seed);
  const market = [], taste = [], peer = [], y = [];
  for (let i = 0; i < n; i++) {
    const m = rnd() * 0.04, t = rnd() * 0.05, p = 0.6 * m + rnd() * 0.02;
    market.push(m); taste.push(t); peer.push(p);
    y.push(0.001 + 0.9 * m + 0.7 * p + tasteWeight * t + rnd() * 0.004);
  }
  return { y, market, peer, taste };
}

test("a planted taste factor is found over the sector-peer control", () => {
  const w = world({ tasteWeight: 0.8 });
  const abl = ablationOf(w.y, w.market, w.peer, w.taste);
  const oos = ablationOos(w);
  assert.ok(abl.tasteExtraR2 > 0.01, `in-sample extra ${abl.tasteExtraR2}`);
  assert.ok(Math.abs(abl.tasteExtraT) > 3, `taste t over peers ${abl.tasteExtraT}`);
  assert.ok(oos.tasteExtraOosR2 > 0, `out-of-sample extra ${oos.tasteExtraOosR2}`);
  assert.equal(oos.trainWeeks + oos.testWeeks, w.y.length);
});

test("market and sector peers alone leave no taste gain", () => {
  const w = world({ tasteWeight: 0, seed: 11 });
  const abl = ablationOf(w.y, w.market, w.peer, w.taste);
  const oos = ablationOos(w);
  assert.ok(Math.abs(abl.tasteExtraT) < 2, `spurious taste t ${abl.tasteExtraT}`);
  assert.ok(Math.abs(oos.tasteExtraOosR2) < 0.01, `spurious out-of-sample extra ${oos.tasteExtraOosR2}`);
});

test("the peer basket is equal-weight, excludes the priced name and survives missing names", () => {
  const r = { A: [0.01, 0.02], B: [0.03, 0.04], C: null, D: [0.05, 0.06] };
  const peer = peerBasket(r, ["A", "B", "C", "D"], "A", 2);
  assert.deepEqual(peer, [0.04, 0.05]);
  assert.equal(peerBasket(r, ["A"], "A", 2), null);
});

test("the ablation placebo separates a real taste factor from a rotated one", () => {
  const plant = (w) => ({ y: w.y, market: w.market, peer: w.peer, basket: w.taste });
  const items = Array.from({ length: 6 }, (_, i) => plant(world({ tasteWeight: 0.9, seed: 100 + i })));
  const hit = ablationPlacebo(items, { draws: 120 });
  assert.ok(Math.abs(hit.real - meanOf(items.map((it) => ablationOos({ y: it.y, market: it.market, peer: it.peer, taste: it.basket }).tasteExtraOosR2))) < 1e-12,
    "the placebo's real statistic is the ablation's own point estimate");
  assert.ok(hit.p <= 0.05, `planted taste should beat rotation, p ${hit.p}`);
});

test("the ablation placebo is calibrated under the null", () => {
  // An unrelated basket is one draw from the same distribution as its rotations,
  // so p should be roughly uniform across worlds — no systematic edge either way.
  const ps = [];
  for (let s = 0; s < 5; s++) {
    const rnd = lcg(4242 + s);
    const noise = Array.from({ length: 6 }, (_, i) => {
      const w = world({ tasteWeight: 0, seed: 500 + i + s * 10 });
      return { y: w.y, market: w.market, peer: w.peer, basket: w.taste.map(() => rnd() * 0.05) };
    });
    const r = ablationPlacebo(noise, { draws: 120, seed: 7 });
    assert.ok(Math.abs(r.real) < 0.02, `unrelated basket extra ${r.real}`);
    assert.ok(r.p > 0 && r.p <= 1);
    ps.push(r.p);
  }
  const above = ps.filter((p) => p > 0.10).length;
  assert.ok(above >= 2, `null placebo should mostly not reject: ${ps.map((p) => p.toFixed(3)).join(" ")}`);
});

test("the ablation placebo is seeded and ordered", () => {
  const items = Array.from({ length: 4 }, (_, i) => {
    const w = world({ tasteWeight: 0.5, seed: 300 + i });
    return { y: w.y, market: w.market, peer: w.peer, basket: w.taste };
  });
  const a = ablationPlacebo(items, { draws: 80, seed: 99 });
  const b = ablationPlacebo(items, { draws: 80, seed: 99 });
  assert.equal(a.p, b.p);
  assert.equal(a.placeboMean, b.placeboMean);
  assert.ok(a.placeboMean <= a.placeboP95);
  assert.ok(a.p > 0 && a.p <= 1);
});

const meanOf = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
