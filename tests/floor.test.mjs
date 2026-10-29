// Acceptance test 3 (sample floor): remove one holding's trending fixture -> that
// row loses its beta and is marked "insufficient signal"; other rows still compute.
// Fixtures here are generated into an OS temp dir at test time (never committed):
// they exist only to exercise the loader's floor logic, not as Qloo data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TICKERS = ["ELF", "NKE", "LULU", "CMG", "SBUX", "MCD", "DIS"];

function seedFixtures(dir, dropTrendingFor) {
  const entities = TICKERS.map((t) => ({ ticker: t, entityId: `TEST-${t}`, entityName: t }));
  writeFileSync(resolve(dir, "entities.json"), JSON.stringify(entities));
  const matrix = {};
  for (const t of TICKERS) matrix[t] = Object.fromEntries(TICKERS.filter((o) => o !== t).map((o) => [o, 0.5]));
  writeFileSync(resolve(dir, "affinity.json"), JSON.stringify({ matrix }));
  for (const t of TICKERS) {
    if (t === dropTrendingFor) {
      writeFileSync(resolve(dir, `trending-${t}.json`), JSON.stringify({ points: [{ date: "2026-01-05", velocity_fold_change: 1.01 }] }));
      continue;
    }
    const points = [];
    const start = Date.UTC(2024, 9, 14);
    for (let w = 0; w < 108; w++) {
      const d = new Date(start + w * 7 * 86400 * 1000);
      points.push({ date: d.toISOString().slice(0, 10), velocity_fold_change: 1 + 0.001 * Math.sin(w / 4) });
    }
    writeFileSync(resolve(dir, `trending-${t}.json`), JSON.stringify({ points }));
  }
}

test("missing trending signal marks the row insufficient, others still compute", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "cb-floor-"));
  const out = mkdtempSync(resolve(tmpdir(), "cb-floor-out-"));
  try {
    seedFixtures(dir, "MCD");
    const res = spawnSync(process.execPath, [resolve(ROOT, "scripts/compute-betas.mjs")], {
      env: { ...process.env, CULTURALBETA_QLOO_DIR: dir, CULTURALBETA_OUTPUT_DIR: out }, encoding: "utf8", cwd: ROOT,
    });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /MCD: INSUFFICIENT SIGNAL/);
    const desk = JSON.parse(readFileSync(resolve(out, "desk.json"), "utf8"));
    const mcd = desk.rows.find((r) => r.ticker === "MCD");
    assert.equal(mcd.status, "insufficient signal");
    assert.equal(mcd.culturalBeta, null);
    assert.equal(mcd.marketBeta, null);
    const okRows = desk.rows.filter((r) => r.status === "ok");
    assert.ok(okRows.length >= 6, `expected >=6 ok rows, got ${okRows.length}`);
    // basket weights sum to 1 on every computed row
    for (const r of okRows) {
      const s = r.basketWeights.reduce((a, w) => a + w.weight, 0);
      assert.ok(Math.abs(s - 1) < 1e-9, `${r.ticker} weights sum ${s}`);
      // ΔR² is exactly the gain of the two-regressor fit over market-only
      assert.ok(Math.abs(r.deltaR2 - (r.r2 - r.r2Market)) < 1e-12, `${r.ticker} ΔR² mismatch`);
      assert.ok(r.deltaR2 >= -1e-12, `${r.ticker} nested model cannot lose r²`);
    }
    const meanDelta = okRows.reduce((a, r) => a + r.deltaR2, 0) / okRows.length;
    assert.ok(Math.abs(desk.valueAdd.meanDeltaR2 - meanDelta) < 1e-12, "valueAdd mean mismatch");
    assert.equal(desk.valueAdd.holdings, okRows.length);
    // median |t| is the honest strength summary: robust to one strong name
    const ts = okRows.map((r) => Math.abs(r.culturalT)).sort((a, b) => a - b);
    const mid = ts.length >> 1;
    const medT = ts.length % 2 ? ts[mid] : (ts[mid - 1] + ts[mid]) / 2;
    assert.ok(Math.abs(desk.valueAdd.medianAbsCulturalT - medT) < 1e-12, "valueAdd median |t| mismatch");
    assert.ok(!res.stdout.includes("cultural 0.00"), "never prints fabricated zero beta");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});
