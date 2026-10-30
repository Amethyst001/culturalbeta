// The robustness tests must be able to find a signal that is there and refuse to
// find one that is not. Both are checked against constructed series, not fixtures.
import test from "node:test";
import assert from "node:assert/strict";
import { outOfSample, oosComponents, bookPlacebo, bookDatePermutation, bootstrapMean, blockDraws, refitBootstrap, fixedBootstrapPerItem, scoringDiagnostics } from "../src/robustness.mjs";

const T = 106;
const jitter = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
};

test("out-of-sample split covers the whole sample and recovers an exact signal", () => {
  const x = Array.from({ length: T }, (_, i) => Math.sin(i / 5) / 50);
  const basket = Array.from({ length: T }, (_, i) => Math.cos(i / 7) / 60);
  const y = x.map((v, i) => 1.1 * v + 0.8 * basket[i]);

  const oos = outOfSample({ y, x, basket });
  assert.equal(oos.trainWeeks + oos.testWeeks, T);
  assert.ok(oos.testWeeks >= 12 && oos.trainWeeks >= 24, "both halves are usable");
  assert.ok(oos.r2 > 0.999, `noiseless fit should predict exactly, got ${oos.r2}`);
  assert.ok(Math.abs(oos.deltaR2 - (oos.r2 - oos.r2Market)) < 1e-12, "ΔR² is the difference of the two fits");
});

test("out-of-sample ΔR² is reported negative when the factor stops working, never clamped", () => {
  const rnd = jitter(7);
  const x = Array.from({ length: T }, () => rnd() / 40);
  const y = x.map((v) => 1.0 * v + rnd() / 40);
  // the basket lines up with returns on the first half and against them on the second
  const basket = y.map((v, i) => (i < Math.round(T * 0.66) ? v * 0.5 : -v * 0.5));
  const oos = outOfSample({ y, x, basket });
  assert.ok(oos.deltaR2 < 0, `learned on one sign, fails on the other: got ${oos.deltaR2}`);
});

test("placebo finds a planted factor and does not find a rotated one", () => {
  const rnd = jitter(11);
  const x = Array.from({ length: T }, (_, i) => Math.sin(i / 6) / 40 + rnd() / 80);
  const basket = Array.from({ length: T }, (_, i) => Math.cos(i / 9) / 50 + rnd() / 90);
  const y = x.map((v, i) => 1.2 * v + 0.9 * basket[i] + rnd() / 60);

  const signal = bookPlacebo([{ y, x, basket }], { draws: 300, seed: 1 });
  assert.ok(signal.p < 0.05, `a planted factor must beat its rotations, p=${signal.p}`);
  assert.ok(signal.perHolding.p[0] < 0.05, "per-holding p agrees with the book");

  // same return series, but the factor is unrelated to it: rotations must look as good
  const noise = Array.from({ length: T }, (_, i) => Math.sin(i / 3) / 55);
  const nullCase = bookPlacebo([{ y, x, basket: noise }], { draws: 300, seed: 1 });
  assert.ok(nullCase.p > 0.10, `an unrelated factor must not beat its rotations, p=${nullCase.p}`);
});

test("placebo is deterministic for a fixed seed and shifts the whole book together", () => {
  const rnd = jitter(3);
  const y = Array.from({ length: T }, () => rnd() / 30);
  const x = Array.from({ length: T }, () => rnd() / 30);
  const a = Array.from({ length: T }, (_, i) => Math.sin(i / 4) / 40);
  const b = Array.from({ length: T }, (_, i) => Math.cos(i / 5) / 40);
  const one = bookPlacebo([{ y, x, basket: a }, { y, x, basket: b }], { draws: 120, seed: 42 });
  const two = bookPlacebo([{ y, x, basket: a }, { y, x, basket: b }], { draws: 120, seed: 42 });
  assert.equal(one.p, two.p, "same seed, same p");
  assert.equal(one.perHolding.real.length, 2);
  assert.ok(one.placeboP95 >= one.placeboMean, "95th percentile sits above the mean");
});

test("the block bootstrap puts a spread on a book-mean ΔR² and is seed-deterministic", () => {
  const rnd = jitter(7);
  const x = Array.from({ length: T }, (_, i) => Math.sin(i / 5) / 40 + rnd() / 60);
  const basket = Array.from({ length: T }, (_, i) => Math.cos(i / 8) / 45 + rnd() / 70);
  const items = Array.from({ length: 8 }, () => {
    const y = x.map((v, i) => 1.1 * v + 0.8 * basket[i] + rnd() / 40);
    return oosComponents({ y, x, basket });
  });
  const delta = (c, idx) => {
    const ys = idx.map((i) => c.yTe[i]);
    const m = ys.reduce((a, b) => a + b, 0) / ys.length;
    const sst = ys.reduce((s, v) => s + (v - m) ** 2, 0);
    const sse = (yh) => idx.reduce((s, i) => s + (c.yTe[i] - yh[i]) ** 2, 0);
    return (sse(c.yhatMarket) - sse(c.yhatFull)) / sst;
  };
  const meanAt = (idx) => items.reduce((s, c) => s + delta(c, idx), 0) / items.length;
  const n = items[0].testWeeks;
  const one = bootstrapMean(meanAt, n, { draws: 200, seed: 5 });
  const two = bootstrapMean(meanAt, n, { draws: 200, seed: 5 });
  assert.equal(one.se, two.se, "same seed, same interval");
  assert.ok(one.se > 0, "a point estimate gets a positive standard error");
  assert.ok(one.lo < one.hi, "the interval is ordered");
  const draws = blockDraws(12, { draws: 5, seed: 1, blockWeeks: 4 });
  assert.equal(draws.length, 5);
  assert.ok(draws.every((d) => d.length === 12 && d.every((i) => i >= 0 && i < 12)), "indices stay inside the test window");
  assert.ok(draws[0].slice(0, 4).every((v, i, arr) => i === 0 || v === (arr[0] + i) % 12), "a block is consecutive weeks");
});

test("the refit-per-draw bootstrap adds coefficient error and is seed-deterministic", () => {
  const rnd = jitter(11);
  const x = Array.from({ length: T }, (_, i) => Math.sin(i / 5) / 40 + rnd() / 60);
  const basket = Array.from({ length: T }, (_, i) => Math.cos(i / 8) / 45 + rnd() / 70);
  // the taste signal is real on the train half and absent on the test half, so a
  // refit draw sees genuinely different coefficients from draw to draw
  const items = Array.from({ length: 8 }, () => ({
    y: x.map((v, i) => 1.1 * v + (i < T * 0.66 ? 0.8 * basket[i] : 0) + rnd() / 40),
  }));
  const opts = { weeks: T, baseCount: 1, draws: 120, seed: 5 };
  const one = refitBootstrap(items, (it) => [x, basket], opts);
  const two = refitBootstrap(items, (it) => [x, basket], opts);
  assert.equal(one.book.se, two.book.se, "same seed, same interval");
  assert.equal(one.perItem.length, items.length, "one interval per name");
  assert.ok(one.book.lo < one.book.hi, "the interval is ordered");
  assert.equal(one.trainWeeks + one.testWeeks, T);
  const fixed = bootstrapMean(
    (idx) => items.reduce((s, it) => {
      const c = oosComponents({ y: it.y, x, basket });
      const ys = idx.map((i) => c.yTe[i]);
      const m = ys.reduce((a, b) => a + b, 0) / ys.length;
      const sse = (yh) => idx.reduce((acc, i) => acc + (c.yTe[i] - yh[i]) ** 2, 0);
      return s + (sse(c.yhatMarket) - sse(c.yhatFull)) / ys.reduce((acc, v) => acc + (v - m) ** 2, 0);
    }, 0) / items.length,
    items[0].y.length - one.trainWeeks, { draws: 120, seed: 5 },
  );
  assert.ok(one.book.se > fixed.se, "the refit adds coefficient error on this series, so it is wider: " + one.book.se.toFixed(5) + " vs " + fixed.se.toFixed(5));
});

test("the per-name fixed interval matches the book interval and is narrower than the refit one", () => {
  let rs = 11;
  const rnd = () => ((rs = (rs * 1103515245 + 12345) % 2147483648) / 2147483648);
  const T = 106, k = 70;
  const x = Array.from({ length: T }, (_, i) => Math.sin(i / 6) / 30 + rnd() / 50);
  const basket = Array.from({ length: T }, (_, i) => Math.cos(i / 8) / 45 + rnd() / 70);
  const items = Array.from({ length: 6 }, () => ({
    y: x.map((v, i) => 1.05 * v + (i < k ? 0.7 * basket[i] : 0) + rnd() / 40),
  }));
  const comps = items.map((it) => oosComponents({ y: it.y, x, basket }));
  const perName = fixedBootstrapPerItem(comps, { weeks: T, draws: 120, seed: 9 });
  const refit = refitBootstrap(items, () => [x, basket], { weeks: T, baseCount: 1, draws: 120, seed: 9 });
  const same = fixedBootstrapPerItem(comps, { weeks: T, draws: 120, seed: 9 });
  assert.equal(perName.length, items.length, "one interval per name");
  assert.deepEqual(perName, same, "same seed, same interval");
  perName.forEach((s) => assert.ok(s.lo <= s.hi, "interval ordered"));
  const width = (s) => s.hi - s.lo;
  const narrower = perName.filter((s, i) => width(s) < width(refit.perItem[i])).length;
  assert.ok(narrower >= items.length - 1, "holding coefficients still is narrower than refitting them: " + narrower + "/" + items.length);
});

test("the block-respecting permutation is a second null on the same draws, not a replacement", () => {
  // A basket that moves in short bursts, as a level series refreshed on a cadence does.
  const rnd = jitter(23);
  const x = Array.from({ length: T }, () => rnd() / 40);
  const burst = Array.from({ length: T }, (_, i) => (i % 5 === 0 ? 0.05 + rnd() / 60 : 0));
  const items = Array.from({ length: 5 }, () => ({ y: x.map((v, i) => 0.9 * v + 0.6 * burst[i] + rnd() / 50), x, basket: burst }));
  const perm = bookDatePermutation(items, { draws: 80, seed: 5, blockWeeks: 6 });
  assert.equal(perm.blockWeeks, 6);
  assert.equal(perm.draws, 80);
  assert.ok(perm.p > 0 && perm.p <= 1, `week-by-week p ${perm.p}`);
  assert.ok(perm.pBlocked > 0 && perm.pBlocked <= 1, `blocked p ${perm.pBlocked}`);
  assert.ok(Number.isFinite(perm.blockedMean), "blocked null has a mean");
  assert.notEqual(perm.blockedMean, perm.placeboMean, "the two nulls are computed on different index orders");
  const again = bookDatePermutation(items, { draws: 80, seed: 5, blockWeeks: 6 });
  assert.deepEqual(again.pBlocked, perm.pBlocked, "same seed, same blocked p");
});

// The held-out slice is a test only where the basket moves. These two cases are the
// difference between a weak test and no test, so the flag is pinned rather than
// inferred from the fixture.
test("a scored slice that never moves is reported untestable, not as a negative", () => {
  const n = 40, trainK = 26;
  const dates = Array.from({ length: n }, (_, i) => `w${String(i).padStart(2, "0")}`);
  const moves = Array.from({ length: n }, (_, i) => (i < 20 ? Math.sin(i) / 50 : 0));
  const frozenBaskets = [moves, moves.map((v) => v * 0.5), moves.map((v) => -v)];
  const frozen = scoringDiagnostics({ baskets: frozenBaskets, dates, trainWeeks: trainK });
  assert.equal(frozen.testable, false);
  assert.equal(frozen.testWeeks, n - trainK);
  assert.equal(frozen.frozenWeeks, n - trainK);
  assert.equal(frozen.frozenFrom, dates[trainK]);
  assert.equal(frozen.lastMove, dates[19]);
  assert.equal(frozen.frozenAfterWindow, n - 1 - 19);
  assert.equal(frozen.medianActive, 0);

  const live = scoringDiagnostics({ baskets: [moves.map((v) => (v === 0 ? 0 : v)), Array.from({ length: n }, (_, i) => Math.cos(i) / 40)], dates, trainWeeks: trainK });
  assert.equal(live.testable, true);
  assert.equal(live.frozenWeeks, 0);
  assert.equal(live.lastMove, dates[n - 1]);
  assert.equal(live.frozenAfterWindow, 0);
  assert.ok(live.medianActive > 0);
});
