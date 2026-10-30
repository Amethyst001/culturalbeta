// The dispersion test decides between two readings of a near-zero mean beta:
// many names pulling in opposite directions with real, per-name exposures, or a
// single number with estimation noise scattered around it. The first is a story
// the desk can sell; the second means the per-name column is decoration. These
// tests plant both worlds and check the test tells them apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { betaDispersion } from "../src/dispersion.mjs";

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = Math.imul(1664525, s) + 1013904223 >>> 0; return s / 4294967296 - 0.5; };
}

// Every name sees the same market and its own basket, so the only difference
// between names is the taste coefficient we plant.
function book({ spreads, seed = 11, weeks = 140, shared = false }) {
  const rnd = lcg(seed);
  const market = Array.from({ length: weeks }, () => rnd() * 0.04);
  const common = Array.from({ length: weeks }, (_, t) => (t % 6 === 0 ? rnd() * 0.09 : 0));
  return spreads.map((taste, i) => {
    const alpha = rnd() * 0.01;
    const basket = shared ? common : Array.from({ length: weeks }, (_, t) => (t % 6 === 0 ? rnd() * 0.09 : 0));
    const y = market.map((m, t) => alpha + 0.9 * m + taste * basket[t] + rnd() * 0.002);
    return { ticker: `N${i}`, y, x: market, basket };
  });
}

test("a book with planted, opposite exposures shows excess dispersion", () => {
  const tastes = [-2.5, -1.8, -1.1, -0.4, 0.4, 1.1, 1.8, 2.5];
  const d = betaDispersion(book({ spreads: tastes }), { draws: 200 });
  assert.equal(d.names, 8);
  assert.ok(d.variance > d.samplingVariance, "cross-name spread should exceed noise");
  assert.ok(d.excess > 0);
  assert.ok(d.p < 0.05, `expected a small upper-tail p, got ${d.p}`);
  assert.equal(d.readsAs, "excess-dispersion");
});

test("a book where every name has the same exposure shows no dispersion", () => {
  const tastes = new Array(8).fill(0.9);
  const d = betaDispersion(book({ spreads: tastes, shared: true }), { draws: 200 });
  assert.ok(d.ratio < 2, `spread should sit near sampling noise, ratio ${d.ratio.toFixed(2)}`);
  assert.notEqual(d.readsAs, "excess-dispersion");
  assert.ok(d.p > 0.10, `identical names must not be called heterogeneous, p ${d.p}`);
});

test("the reported variance is the one in the per-name slopes", () => {
  const items = book({ spreads: [-1, 0, 1, 2] });
  const d = betaDispersion(items, { draws: 50 });
  const slopes = items.map((it) => {
    // independent reference fit: slope on the basket in a two-regressor regression
    const n = it.y.length;
    const m = it.y.reduce((s, v) => s + v, 0) / n;
    const mx = it.x.reduce((s, v) => s + v, 0) / n;
    const mb = it.basket.reduce((s, v) => s + v, 0) / n;
    let sxb = 0, sxx = 0, sbb = 0, syb = 0, syx = 0;
    for (let t = 0; t < n; t++) {
      const dx = it.x[t] - mx, db = it.basket[t] - mb, dy = it.y[t] - m;
      sxb += dx * db; sxx += dx * dx; sbb += db * db; syb += dy * db; syx += dy * dx;
    }
    const det = sxx * sbb - sxb * sxb;
    return (sxx * syb - sxb * syx) / det;
  });
  const mean = slopes.reduce((s, v) => s + v, 0) / slopes.length;
  const expected = slopes.reduce((s, v) => s + (v - mean) ** 2, 0) / (slopes.length - 1);
  assert.ok(Math.abs(d.variance - expected) < 1e-9, `variance ${d.variance} vs ${expected}`);
});

test("the power calibration finds a spread it can see in a well-identified book", () => {
  // Tight noise and a basket that moves often: a spread of one unit should be
  // detectable, so the calibration must not report "uninformative" by default.
  const items = book({ spreads: [-1, -0.5, 0, 0.5, 1, 1.5], weeks: 200 });
  const d = betaDispersion(items, { draws: 200, powerWorlds: 20 });
  assert.ok(d.detectable, "a detectable spread should exist in this book");
  assert.ok(d.detectable.sd <= 5, `smallest detectable sd ${d.detectable.sd}`);
  assert.ok(d.power[0].power >= 0.8, `power at sd 1 is ${d.power[0].power}`);
});

test("a non-detection is graded on power at the observed spread, not on the grid", () => {
  // Every name truly identical, noise does the scattering. The observed spread is
  // then about the same size as the noise, and a test that needs a far larger
  // spread to fire has not tested anything — so the reading must be "uninformative",
  // never "indeterminate", however far the grid reaches.
  const d = betaDispersion(book({ spreads: new Array(6).fill(0), seed: 7 }), { draws: 200, powerWorlds: 20 });
  assert.equal(typeof d.informative, "boolean");
  assert.ok(d.observedSd > 0);
  assert.ok(d.powerObserved >= 0 && d.powerObserved <= 1);
  if (d.readsAs === "indeterminate" || d.readsAs === "uninformative") {
    assert.equal(d.readsAs === "indeterminate", d.informative,
      `reading ${d.readsAs} with power ${d.powerObserved.toFixed(2)} at sd ${d.observedSd.toFixed(2)}`);
  }
  assert.notEqual(d.readsAs, "indeterminate");
});

test("short or mismatched series are rejected rather than silently rotated", () => {
  const items = book({ spreads: [0.5, 1.0, 1.5], weeks: 12 });
  assert.throws(() => betaDispersion(items, { minShift: 8 }), /too short/);
  const bad = book({ spreads: [0.5, 1.0, 1.5], weeks: 40 });
  bad[1] = { ...bad[1], basket: bad[1].basket.slice(0, 20) };
  assert.throws(() => betaDispersion(bad), /length mismatch/);
});
