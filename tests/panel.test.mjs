// The pooled panel has to be honest in both directions: a planted sub-sector
// taste slope is recovered by the pooled fit, a world with only market movement
// gives no cultural signal, and the within-fit still holds the market slope when
// every name shares it. Deterministic synthetic data, no Qloo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pooledPanel, panelNameMarket } from "../src/panel.mjs";

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = Math.imul(1664525, s) + 1013904223 >>> 0; return s / 4294967296 - 0.5; };
}

function book({ taste, seed = 3, names = 12, weeks = 120, marketSpread = 0 }) {
  const rnd = lcg(seed);
  const market = Array.from({ length: weeks }, () => rnd() * 0.05);
  const baskets = {
    food: Array.from({ length: weeks }, (_, t) => (t % 5 === 0 ? rnd() * 0.08 : 0)),
    media: Array.from({ length: weeks }, (_, t) => (t % 7 === 0 ? rnd() * 0.08 : 0)),
  };
  const items = [];
  for (let i = 0; i < names; i++) {
    const sector = i % 2 ? "food" : "media";
    const alpha = rnd() * 0.01;
    const basket = baskets[sector];
    // marketSpread > 0 gives each name its own loading, so a single common slope is
    // the wrong restriction and only a per-name loading can recover the taste slope.
    const loading = 1.0 + marketSpread * (i / (names - 1) - 0.5) * 2;
    const y = market.map((m, t) => alpha + loading * m + taste * basket[t] + rnd() * 0.004);
    items.push({ ticker: `N${i}`, sector, y, x: market, basket });
  }
  return { items, baskets, market };
}

test("a planted sub-sector taste slope is recovered by the pooled fit", () => {
  const { items } = book({ taste: 0.7 });
  const p = pooledPanel(items, { permDraws: 60 });
  const food = p.sectors.find((s) => s.id === "food");
  const media = p.sectors.find((s) => s.id === "media");
  assert.ok(Math.abs(food.beta - 0.7) < 0.25, `food beta ${food.beta.toFixed(2)}`);
  assert.ok(Math.abs(media.beta - 0.7) < 0.3, `media beta ${media.beta.toFixed(2)}`);
  assert.ok(Math.abs(p.market.beta - 1.0) < 0.15, `market beta ${p.market.beta.toFixed(2)}`);
  assert.ok(p.deltaR2 > 0.02, `within ΔR² ${p.deltaR2.toFixed(4)}`);
  assert.ok(p.null.p < 0.10, `permutation p ${p.null.p}`);
});

test("market movement alone leaves no pooled cultural signal", () => {
  const { items } = book({ taste: 0, seed: 21 });
  const p = pooledPanel(items, { permDraws: 60 });
  for (const s of p.sectors) assert.ok(Math.abs(s.t) < 3, `${s.id} t ${s.t.toFixed(2)}`);
  assert.ok(p.null.p > 0.10, `permutation p ${p.null.p} on a null book`);
});

test("ridge shrinks a barely-moving basket toward zero, not a well-identified one", () => {
  const { items } = book({ taste: 0.7, seed: 5 });
  const p = pooledPanel(items, { permDraws: 10, ridge: 0.05 });
  assert.ok(p.ridge && p.ridge.lambda > 0, "ridge ran");
  const food = p.sectors.find((s) => s.id === "food");
  assert.ok(Math.abs(food.ridgeShift) < 0.2, `well-identified food slope moved ${food.ridgeShift.toFixed(3)}`);
  assert.ok(p.ridge.maxAbsShift < 1.5, `largest ridge shift ${p.ridge.maxAbsShift.toFixed(3)}`);
});

test("a series length mismatch is refused rather than silently truncated", () => {
  const { items } = book({ taste: 0.2 });
  items[0] = { ...items[0], y: items[0].y.slice(0, -1) };
  assert.throws(() => pooledPanel(items, { permDraws: 5 }), /length mismatch/);
});

test("with name-specific market loadings the per-name arm still recovers the taste slope", () => {
  // Loadings run 0.6 -> 1.4, so forcing one common slope fits the market badly and
  // the cultural columns absorb the error. Each name's own loading has to be used.
  const { items } = book({ taste: 0.7, seed: 9, marketSpread: 0.4 });
  const p = panelNameMarket(items, { permDraws: 60 });
  const food = p.sectors.find((s) => s.id === "food");
  const media = p.sectors.find((s) => s.id === "media");
  assert.ok(Math.abs(food.beta - 0.7) < 0.25, `food beta ${food.beta.toFixed(2)}`);
  assert.ok(Math.abs(media.beta - 0.7) < 0.3, `media beta ${media.beta.toFixed(2)}`);
  assert.ok(Math.abs(p.market.meanBeta - 1.0) < 0.15, `mean loading ${p.market.meanBeta.toFixed(2)}`);
  assert.ok(p.market.sd > 0.15, `loadings should vary, sd ${p.market.sd.toFixed(2)}`);
  assert.ok(p.deltaR2 > 0.02, `within ΔR² ${p.deltaR2.toFixed(4)}`);
  assert.ok(p.null.p < 0.10, `permutation p ${p.null.p}`);
});

test("name-specific loadings do not manufacture a taste signal where there is none", () => {
  const { items } = book({ taste: 0, seed: 15, marketSpread: 0.4 });
  const p = panelNameMarket(items, { permDraws: 60 });
  for (const s of p.sectors) assert.ok(Math.abs(s.t) < 3, `${s.id} t ${s.t.toFixed(2)}`);
  assert.ok(p.null.p > 0.10, `permutation p ${p.null.p} on a null book`);
});
