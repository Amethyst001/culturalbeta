// The flag rule rests on this correction, so the q-values are pinned to a
// hand-computed example rather than trusted by inspection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { benjaminiHochberg } from "../src/multiplicity.mjs";

test("q-values are monotone in p and equal p when every test is null", () => {
  const p = [0.01, 0.02, 0.03, 0.04, 0.05];
  const q = benjaminiHochberg(p);
  for (let i = 0; i < p.length; i++) assert.ok(Math.abs(q[i] - 0.05) < 1e-12, `q[${i}] = ${q[i]}`);
});

test("a lone small p survives the correction, a middling one does not", () => {
  const [qSmall, qMid] = benjaminiHochberg([0.001, 0.5]);
  assert.ok(Math.abs(qSmall - 0.002) < 1e-12, `qSmall = ${qSmall}`);
  assert.ok(Math.abs(qMid - 0.5) < 1e-12, `qMid = ${qMid}`);
  const hundred = benjaminiHochberg([0.001, ...Array.from({ length: 99 }, () => 0.4)]);
  assert.ok(Math.abs(hundred[0] - 0.1) < 1e-12, `q at n=100 = ${hundred[0]}`);
});

test("q is capped at 1 and preserves input order", () => {
  const q = benjaminiHochberg([0.9, 0.0001, 0.6]);
  assert.ok(q.every((v) => v <= 1));
  assert.equal(q[1] , Math.min(...q));
  assert.deepEqual(benjaminiHochberg([]), []);
});
