// Unit tests for the revision replay. Synthetic inputs here only pin the
// plumbing (window cut, determinism, degenerate basket handling, summary
// arithmetic); the real-data property is checked by scripts/revision-replay.mjs,
// which refuses to save unless it reproduces the committed desk and baskets.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReplay, fitName, vintageDates, summariseMovers, quantile, PRE_THROUGH,
} from "../src/revision-replay.mjs";

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// Twelve Mondays spanning the pre/post boundary, with one revision week cut.
const ALIGNED = Array.from({ length: 12 }, (_, i) => addDays("2025-11-03", i * 7));
const REVISION = "2025-12-08";
const AFTER = ALIGNED.filter((d) => d !== REVISION);
const PRE = ALIGNED.filter((d) => d <= PRE_THROUGH && d !== REVISION);

const series = (fn) => ALIGNED.map((_, i) => fn(i));
const spy = series((i) => 0.004 * Math.sin(i * 0.9) + 0.002 * Math.cos(i * 0.37));
const sectorOne = series((i) => 0.6 * Math.sin(i * 1.3) + 0.25 * Math.cos(i * 0.61));
const sectorTwo = series((i) => -0.4 * Math.sin(i * 0.8) + 0.3 * Math.cos(i * 1.7));
const returnsFor = (a, b, c, phase = 0) => ALIGNED.map((_, i) => a * spy[i] + b * sectorOne[i] + c * sectorTwo[i] + 0.001 * Math.sin(i * 2.1 + phase));

function fixture() {
  const prices = {
    window: { alignedDates: ALIGNED },
    symbols: {
      SPY: { returns: spy },
      AAA: { returns: returnsFor(0.8, 1.4, 0, 0.1) },
      BBB: { returns: returnsFor(0.5, -0.9, 0, 1.2) },
      CCC: { returns: returnsFor(0.7, 0, 0.6, 2.1) },
      DDD: { returns: returnsFor(1.1, 0, 0.4, 0.4) },
    },
  };
  const desk = {
    window: { alignedDates: AFTER },
    rows: [
      { ticker: "AAA", sector: "s1", status: "ok" },
      { ticker: "BBB", sector: "s1", status: "ok" },
      { ticker: "CCC", sector: "s1", status: "ok" },
      { ticker: "DDD", sector: "s2", status: "ok" },
      { ticker: "ZZZ", sector: "s1", status: "unresolved" },
    ],
  };
  const map = (values) => new Map(ALIGNED.map((d, i) => [d, values[i]]));
  const cultural = {
    taste: {
      AAA: map(sectorOne),
      BBB: map(sectorOne),
      CCC: map(ALIGNED.map(() => 0)), // constant basket: no identification
      DDD: map(sectorTwo),
    },
  };
  const book = {
    index: { ticker: "SPY" },
    minTrendingWeeks: 0,
    flagRule: { absT: 0, qMax: 1, negativeOnly: true },
  };
  return { desk, prices, cultural, book, revisionDates: [REVISION] };
}

test("the pre-revision window never includes a week after 2025-12-01", () => {
  const got = vintageDates(ALIGNED, PRE_THROUGH, [REVISION]);
  assert.deepEqual(got, PRE);
  assert.ok(got.every((d) => d <= "2025-12-01"), `leaked: ${got.filter((d) => d > "2025-12-01")}`);
  assert.ok(!got.includes(REVISION), "a revision week must not survive the cut");
  assert.ok(!got.includes("2025-12-15"), "a post-revision week must not enter the before vintage");

  const replay = buildReplay({ ...fixture(), generatedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(replay.vintageBefore.through, "2025-12-01");
  assert.equal(replay.vintageBefore.weeks, PRE.length);
});

test("identical inputs produce identical output", () => {
  const at = "2026-01-01T00:00:00.000Z";
  const a = buildReplay({ ...fixture(), generatedAt: at });
  const b = buildReplay({ ...fixture(), generatedAt: at });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.summary.namesCompared, 3, "AAA, BBB and DDD are comparable; CCC is not");
});

test("a name whose basket has no variation yields no invented beta", () => {
  const flat = Array.from({ length: 8 }, () => 0);
  const y = Array.from({ length: 8 }, (_, i) => 0.01 * Math.sin(i));
  const x = Array.from({ length: 8 }, (_, i) => 0.02 * Math.cos(i * 0.7));
  assert.equal(fitName(y, x, flat), null, "a constant basket cannot identify a slope");
  assert.equal(fitName(y, x, flat.map(() => 0.5)), null, "a non-zero constant is still no variation");

  const replay = buildReplay({ ...fixture(), generatedAt: "2026-01-01T00:00:00.000Z" });
  assert.ok(!replay.movers.some((m) => m.ticker === "CCC"), "CCC must not receive a fabricated beta");
  assert.equal(replay.vintageBefore.priced, 3);
  assert.equal(replay.vintageAfter.priced, 3);
});

test("summary counts are consistent with the movers array", () => {
  const replay = buildReplay({ ...fixture(), generatedAt: "2026-01-01T00:00:00.000Z" });
  const s = replay.summary;
  const abs = replay.movers.map((m) => Math.abs(m.deltaBeta)).sort((a, b) => a - b);
  const mid = abs.length >> 1;
  const median = abs.length % 2 ? abs[mid] : (abs[mid - 1] + abs[mid]) / 2;
  assert.equal(s.namesCompared, replay.movers.length);
  assert.equal(s.namesCompared, replay.vintageBefore.priced);
  assert.equal(s.flips, replay.movers.filter((m) => m.flipped).length);
  assert.deepEqual(s.flipTickers, replay.movers.filter((m) => m.flipped).map((m) => m.ticker).sort());
  assert.equal(s.medianAbsDeltaBeta, median);
  assert.equal(s.p90AbsDeltaBeta, quantile(abs, 0.9));
  assert.equal(s.maxAbsDeltaBeta, Math.max(...abs));
  assert.ok(replay.movers.every((m, i, a) => i === 0 || Math.abs(a[i - 1].deltaBeta) >= Math.abs(m.deltaBeta)), "movers are sorted by |deltaBeta|");

  const manufactured = summariseMovers([
    { ticker: "Z", deltaBeta: 0.5, flipped: true },
    { ticker: "X", deltaBeta: 2, flipped: true },
    { ticker: "Y", deltaBeta: -3, flipped: false },
  ]);
  assert.equal(manufactured.namesCompared, 3);
  assert.equal(manufactured.flips, 2);
  assert.deepEqual(manufactured.flipTickers, ["X", "Z"]);
  assert.equal(manufactured.medianAbsDeltaBeta, 2);
  assert.equal(manufactured.maxAbsDeltaBeta, 3);
  assert.equal(manufactured.p90AbsDeltaBeta, quantile([0.5, 2, 3], 0.9));
});
