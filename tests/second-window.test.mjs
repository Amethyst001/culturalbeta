// End-to-end compute against hand-built Qloo fixtures: three names in one
// sub-sector, one featured, a synthetic price file with a disjoint prior window.
// This is the test that pins the replication slice, the BH-confirmed flag and the
// refusal when a sector basket is missing — none of which can be checked by unit
// tests alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEEKS = 106;
const BARS = WEEKS * 2 + 1;

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

function fixture() {
  const dir = mkdtempSync(resolve(tmpdir(), "cb-window-"));
  const qloo = resolve(dir, "qloo");
  const out = resolve(dir, "out");
  mkdirSync(qloo, { recursive: true });

  const bars = []; // Monday keys; bars[0] precedes the first return
  for (let i = 0; i < BARS; i++) bars.push(addDays("2022-10-17", i * 7));
  const dates = bars.slice(1); // two disjoint blocks of 106 weekly returns
  const primaryDates = dates.slice(WEEKS);
  const priorDates = dates.slice(0, WEEKS);

  const s = dates.map((_, i) => 0.006 * Math.sin(i * 0.23) + 0.0015 * Math.cos(i * 0.7));
  const r1 = dates.map((_, i) => 0.004 * Math.sin(i * 0.7) + 0.002 * Math.cos(i * 0.31));
  const r2 = dates.map((_, i) => 0.003 * Math.cos(i * 0.5) + 0.001 * Math.sin(i * 0.11));
  const b = dates.map((_, i) => 0.6 * r1[i] + 0.4 * r2[i]);
  const noise = (k) => dates.map((_, i) => 0.001 * Math.sin(i * 1.7 + k));

  const name = (k, a, c) => dates.map((_, i) => a * s[i] + c * b[i] + noise(k)[i]);
  const series = (r) => ({ returns: r.slice(WEEKS), priorReturns: r.slice(0, WEEKS), closes: r.map((v) => 100 * (1 + v)) });
  const prices = {
    window: { start: bars[WEEKS], end: bars[BARS - 1], weeks: WEEKS, alignedDates: primaryDates },
    priorWindow: { start: bars[0], end: bars[WEEKS], weeks: WEEKS, alignedDates: priorDates },
    symbols: {
      SPY: series(s),
      ELF: series(name(1, 0.7, -1.1)), // the taste headwind
      NKE: series(name(2, 0.5, 0.9)),  // taste tailwind
      COTY: series(name(3, 1.0, 0.05)), // no taste loading
    },
    dropped: [],
    source: { api: "stub", requestUrls: {}, fetchedAt: new Date().toISOString() },
  };
  const pricesFile = resolve(dir, "prices.json");
  writeFileSync(pricesFile, JSON.stringify(prices));

  const row = (ticker, label, featured = false) => ({ ticker, label, query: label, sector: "beauty", featured, entityId: `urn:entity:brand:${ticker.toLowerCase()}` });
  writeFileSync(resolve(qloo, "entities.json"), JSON.stringify([row("ELF", "e.l.f. Beauty", true), row("NKE", "Nike"), row("COTY", "Coty")]));

  // The factor is the week-to-week log difference of population_percentile, so a
  // member whose intended weekly taste returns are r is a running product of exp(r).
  // The level is seeded one week before the first return, exactly as the live fetch
  // opens a week before the window: without it the first week would have no prior
  // level and the pipeline would — correctly — refuse the name for a missing week.
  const points = (r) => {
    let level = 0.5;
    return [addDays(dates[0], -7), ...dates].map((d, i) => {
      if (i > 0) level *= Math.exp(r[i - 1]);
      return { date: d, population_percentile: level };
    });
  };
  const member = (id, name, affinity) => ({ id, name, type: "brand", affinity, weight: affinity / 10 });
  writeFileSync(resolve(qloo, "basket-sector-beauty.json"), JSON.stringify({
    sector: "beauty",
    signalEntityIds: ["urn:entity:brand:elf"],
    members: [member("urn:brand:m1", "Member One", 6), member("urn:brand:m2", "Member Two", 4)],
  }));
  writeFileSync(resolve(qloo, "basket-ELF.json"), JSON.stringify({
    ticker: "ELF",
    members: [{ id: "urn:brand:m1", name: "Member One", type: "brand", affinity: 6, weight: 1 }],
  }));
  writeFileSync(resolve(qloo, "series.json"), JSON.stringify({
    byId: {
      "urn:brand:m1": { type: "brand", name: "Member One", points: points(r1) },
      "urn:brand:m2": { type: "brand", name: "Member Two", points: points(r2) },
    },
  }));

  return { dir, qloo, out, pricesFile };
}

function compute(f) {
  return spawnSync(process.execPath, [resolve(ROOT, "scripts/compute-betas.mjs")], {
    encoding: "utf8",
    cwd: ROOT,
    env: {
      ...process.env,
      CULTURALBETA_QLOO_DIR: f.qloo,
      CULTURALBETA_OUTPUT_DIR: f.out,
      CULTURALBETA_PRICES_FILE: f.pricesFile,
    },
  });
}

test("the second window is a disjoint slice, run with the same estimator", () => {
  const f = fixture();
  try {
    const res = compute(f);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const desk = JSON.parse(readFileSync(resolve(f.out, "desk.json"), "utf8"));
    assert.equal(desk.window.weeks, WEEKS);
    assert.equal(desk.rows.length, 3);
    assert.ok(desk.priorWindow, "desk must carry the prior window");
    assert.equal(desk.priorWindow.weeks, WEEKS);
    assert.ok(desk.priorWindow.end <= desk.window.start, "the replicating window must precede the primary one");
    const overlap = desk.priorWindow.alignedDates?.filter((d) => desk.window.alignedDates?.includes(d)) ?? [];
    assert.equal(overlap.length, 0, "no return may belong to both windows");
    const sec = desk.valueAdd.secondary;
    assert.ok(sec, "second window must be computed when prior returns exist");
    assert.equal(sec.window.weeks, WEEKS);
    assert.equal(typeof sec.replicates, "boolean");
    assert.ok(sec.oos.meanDeltaR2 > 0, `expected the basket to generalise, got ${sec.oos.meanDeltaR2}`);
    assert.equal(sec.replicates, true);
    for (const r of desk.rows.filter((x) => x.status === "ok")) {
      assert.ok(r.secondary, `${r.ticker} must carry its own second-window reading`);
      assert.equal(r.secondary.weeks, WEEKS);
    }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("a negative beta is flagged only after the book-wide q", () => {
  const f = fixture();
  try {
    const res = compute(f);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const desk = JSON.parse(readFileSync(resolve(f.out, "desk.json"), "utf8"));
    const by = Object.fromEntries(desk.rows.map((r) => [r.ticker, r]));
    assert.ok(by.ELF.culturalBeta < 0);
    assert.ok(Math.abs(by.ELF.culturalT) > 2);
    assert.ok(by.ELF.culturalQ <= 0.1, `q = ${by.ELF.culturalQ}`);
    assert.equal(by.ELF.flagged, true);
    assert.equal(by.NKE.flagged, false, "a positive beta is never a risk flag");
    assert.equal(by.COTY.flagged, false, "a null loading is not a flag");
    assert.equal(desk.valueAdd.holdings, 3);
    assert.ok(desk.rows.every((r) => r.culturalQ !== undefined), "every priced name carries its q");
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("a missing sector basket refuses the run instead of pricing a fragment", () => {
  const f = fixture();
  try {
    rmSync(resolve(f.qloo, "basket-sector-beauty.json"));
    const res = compute(f);
    assert.equal(res.status, 2, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stderr, /REFUSING TO PRINT/);
    assert.match(res.stderr, /basket-sector-beauty/);
    assert.ok(!existsSync(resolve(f.out, "desk.json")), "no desk may be saved from a missing basket");
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
