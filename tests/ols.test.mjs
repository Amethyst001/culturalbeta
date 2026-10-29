import { test } from "node:test";
import assert from "node:assert/strict";
import { ols } from "../src/ols.mjs";

test("ols recovers exact coefficients from a noiseless two-regressor fit", () => {
  const x1 = Array.from({ length: 50 }, (_, i) => Math.sin(i / 3) * 0.02);
  const x2 = Array.from({ length: 50 }, (_, i) => Math.cos(i / 5) * 0.01);
  const y = x1.map((v, i) => 0.001 + 1.9 * v + -0.23 * x2[i]);
  const r = ols(y, [x1, x2]);
  assert.ok(Math.abs(r.beta[1] - 1.9) < 1e-8);
  assert.ok(Math.abs(r.beta[2] + 0.23) < 1e-8);
  assert.ok(r.se.every((s) => s < 1e-8));
});

test("ols standard errors and t-stats are consistent (beta/se == t)", () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const x = Array.from({ length: 106 }, () => rnd() * 0.04 - 0.02);
  const y = x.map((v) => 0.001 + 0.9 * v + (rnd() - 0.5) * 0.02);
  const r = ols(y, [x]);
  assert.ok(Math.abs(r.beta[1] / r.se[1] - r.t[1]) < 1e-9);
  assert.ok(r.p[1] >= 0 && r.p[1] <= 1);
});

test("t-dist p-value matches known values", async () => {
  const { tDistP } = await import("../src/ols.mjs");
  const p = tDistP(2.0, 100);
  assert.ok(Math.abs(p - 0.0481) < 0.005, `expected ~0.048, got ${p}`);
});

test("ols rejects mismatched lengths and singular designs", () => {
  assert.throws(() => ols([1, 2, 3], [[1, 2]]), /length mismatch/);
  assert.throws(() => ols([1, 2, 3], [[1, 2, 3], [2, 4, 6]]), /singular|degrees/);
});
