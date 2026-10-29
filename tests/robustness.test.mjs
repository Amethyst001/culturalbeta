// The robustness tests must be able to find a signal that is there and refuse to
// find one that is not. Both are checked against constructed series, not fixtures.
import test from "node:test";
import assert from "node:assert/strict";
import { outOfSample, bookPlacebo } from "../src/robustness.mjs";

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
