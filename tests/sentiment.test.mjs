// The sentiment exclusion must be able to fail. A planted taste factor that is
// not a sentiment proxy has to survive the control; a world where returns are
// driven by sentiment alone must show no taste gain.
import { test } from "node:test";
import assert from "node:assert/strict";
import { alignSentiment, sentimentOos, pearson } from "../src/sentiment.mjs";

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = Math.imul(1664525, s) + 1013904223 >>> 0; return s / 4294967296 - 0.5; };
}

test("monthly sentiment is carried as a month-over-month change, not interpolated", () => {
  const monthly = [
    { date: "2025-01-01", value: 70 },
    { date: "2025-02-01", value: 72 },
    { date: "2025-03-01", value: 68 },
    { date: "2025-04-01", value: 69 },
  ];
  const dates = ["2025-01-06", "2025-01-13", "2025-02-03", "2025-02-10", "2025-03-03", "2025-03-10", "2025-04-07"];
  const a = alignSentiment(monthly, dates);
  assert.deepEqual(a.series, [0, 0, 2, 2, -4, -4, 1]);
  assert.equal(a.moving, 5);
  assert.equal(a.monthsCovered, 3);
});

test("taste that is not a sentiment proxy survives the control", () => {
  const rnd = lcg(31);
  const n = 120;
  const market = [], sent = [], taste = [], y = [];
  for (let i = 0; i < n; i++) {
    const m = rnd() * 0.04;
    const s = i % 4 === 0 ? rnd() * 2 : 0;
    const t = rnd() * 0.05;
    market.push(m); sent.push(s); taste.push(t);
    y.push(0.001 + 0.9 * m + 0.04 * s + 0.8 * t + rnd() * 0.003);
  }
  const r = sentimentOos({ y, market, sentiment: sent, basket: taste });
  assert.ok(r.tasteExtraOosR2 > 0, `planted taste should survive, got ${r.tasteExtraOosR2}`);
  assert.ok(Math.abs(r.sentimentBeta) > 0, "sentiment is in the model");
});

test("returns driven by sentiment leave no taste gain", () => {
  const rnd = lcg(77);
  const n = 120;
  const market = [], sent = [], taste = [], y = [];
  for (let i = 0; i < n; i++) {
    const m = rnd() * 0.04;
    const s = i % 4 === 0 ? rnd() * 2 : 0;
    const t = rnd() * 0.05;
    market.push(m); sent.push(s); taste.push(t);
    y.push(0.001 + 0.9 * m + 0.05 * s + rnd() * 0.003);
  }
  const r = sentimentOos({ y, market, sentiment: sent, basket: taste });
  assert.ok(Math.abs(r.tasteExtraOosR2) < 0.01, `no taste gain expected, got ${r.tasteExtraOosR2}`);
});

test("pearson is symmetric and bounded, and null for a flat series", () => {
  const a = [1, 2, 3, 4, 5];
  const b = [2, 4, 6, 8, 10];
  assert.equal(pearson(a, b).toFixed(6), "1.000000");
  assert.equal(pearson(b, a).toFixed(6), "1.000000");
  assert.equal(pearson(a, [0, 0, 0, 0, 0]), null);
  assert.ok(Math.abs(pearson(a, [5, 4, 3, 2, 1]) + 1) < 1e-12);
});
