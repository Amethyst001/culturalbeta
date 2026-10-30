// Acceptance test 3 (sample floor): starve one sub-sector's basket of weekly
// points -> the name priced against it loses its beta and is marked "insufficient
// signal"; other sectors still compute. Fixtures here are generated into an OS
// temp dir at test time (never committed): they exercise the loader's floor logic,
// not real Qloo data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TICKERS = ["ELF", "NKE", "LULU", "CMG", "SBUX", "MCD", "DIS"];
const SECTOR = { MCD: "restaurants" };
const sectorOf = (t) => SECTOR[t] ?? "apparel";

function seedFixtures(dir, starvedSector) {
  const entities = TICKERS.map((t) => ({ ticker: t, label: t, query: t, entityId: `TEST-${t}`, sector: sectorOf(t) }));
  writeFileSync(resolve(dir, "entities.json"), JSON.stringify(entities));

  const week = (w) => new Date(Date.UTC(2024, 9, 14) + w * 7 * 86400 * 1000).toISOString().slice(0, 10);
  const full = [];
  for (let w = 0; w < 108; w++) full.push({ date: week(w), population_percentile: 0.5 + 0.001 * Math.sin(w / 4) });
  const stub = [{ date: week(0), population_percentile: 0.51 }];

  const byId = {};
  for (const sector of [...new Set(TICKERS.map(sectorOf))]) {
    const members = [0, 1, 2, 3].map((i) => {
      const id = `TEST-B-${sector}-${i}`;
      byId[id] = { type: i === 3 ? "movie" : "brand", name: `${sector} neighbour ${i}`, points: sector === starvedSector ? stub : full };
      return { id, name: `${sector} neighbour ${i}`, type: i === 3 ? "movie" : "brand", affinity: 0.5 - i / 100, weight: 0.25 };
    });
    writeFileSync(resolve(dir, `basket-sector-${sector}.json`), JSON.stringify({
      sector,
      signalEntityIds: entities.filter((e) => e.sector === sector).map((e) => e.entityId),
      members,
      excludedByConstruction: TICKERS.map((t) => ({ ticker: t, entityId: `TEST-${t}` })),
    }));
  }
  writeFileSync(resolve(dir, "series.json"), JSON.stringify({ byId }));
}

test("a starved sector basket marks its names insufficient, others still compute", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "cb-floor-"));
  const out = mkdtempSync(resolve(tmpdir(), "cb-floor-out-"));
  try {
    seedFixtures(dir, "restaurants");
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
      const s = r.basket.reduce((a, w) => a + w.weight, 0);
      assert.ok(Math.abs(s - 1) < 1e-9, `${r.ticker} weights sum ${s}`);
      // no holding may appear in its own basket
      assert.ok(!r.basket.some((m) => m.id === r.qlooEntityId || m.id === `TEST-${r.ticker}`), `${r.ticker} basket contains a holding`);
      // ΔR² is exactly the gain of the two-regressor fit over market-only
      assert.ok(Math.abs(r.deltaR2 - (r.r2 - r.r2Market)) < 1e-12, `${r.ticker} ΔR² mismatch`);
      assert.ok(r.deltaR2 >= -1e-12, `${r.ticker} nested model cannot lose r²`);
    }
    const meanDelta = okRows.reduce((a, r) => a + r.deltaR2, 0) / okRows.length;
    assert.ok(Math.abs(desk.valueAdd.meanDeltaR2 - meanDelta) < 1e-12, "valueAdd mean mismatch");
    assert.equal(desk.valueAdd.holdings, okRows.length);

    // out-of-sample: the split covers the whole sample, is never clamped, and averages to the book value
    const { oos, placebo } = desk.valueAdd;
    assert.equal(oos.trainWeeks + oos.testWeeks, desk.window.weeks, "OOS split must cover the window");
    assert.equal(oos.holdings, okRows.length);
    for (const r of okRows) {
      assert.equal(r.oos.trainWeeks, oos.trainWeeks);
      assert.ok(Math.abs(r.oos.deltaR2 - (r.oos.r2 - r.oos.r2Market)) < 1e-12, `${r.ticker} OOS ΔR² mismatch`);
    }
    const meanOos = okRows.reduce((a, r) => a + r.oos.deltaR2, 0) / okRows.length;
    assert.ok(Math.abs(oos.meanDeltaR2 - meanOos) < 1e-12, "valueAdd OOS mean mismatch");

    // placebo: a share of draws, on the same real book, with a per-holding p on every row
    assert.equal(placebo.draws, 400);
    assert.ok(Math.abs(placebo.real - desk.valueAdd.meanDeltaR2) < 1e-12, "placebo real must be the in-sample mean");
    assert.ok(placebo.p > 0 && placebo.p <= 1, `placebo p out of range: ${placebo.p}`);
    for (const r of okRows) assert.ok(r.placeboP > 0 && r.placeboP <= 1, `${r.ticker} placebo p out of range`);
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
