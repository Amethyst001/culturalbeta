// The live Qloo tools: guards, budget arithmetic, and the estimator re-run. The
// Qloo client is injected here so the only thing under test is our own code; the
// product path is the same functions with the real harness bound in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  LIVE, liveStatus, validateBrandName, validateTicker, pickEntity,
  reserve, settle, readBudget, alignLive, regressLive, createLiveTools, withLiveTools,
} from "../src/live-qloo.mjs";

function tmpDir() { return mkdtempSync(resolve(tmpdir(), "live-qloo-")); }

const dates = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2025, 0, 6) + i * 7 * 86400000).toISOString().slice(0, 10));

function smallDesk() {
  return {
    window: { start: dates[0], end: dates.at(-1), weeks: dates.length, alignedDates: dates },
    priorWindow: { alignedDates: dates.map((d) => new Date(Date.parse(`${d}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10)) },
    rows: [{
      ticker: "AAA", label: "Alpha Co", sector: "media", sectorLabel: "Media", status: "ok",
      culturalBeta: 3.5, culturalT: 2.1, culturalQ: 0.4, deltaR2: 0.02,
      basket: [{ id: "e1", name: "One", type: "brand", weight: 0.6 }, { id: "e2", name: "Two", type: "brand", weight: 0.4 }],
    }],
  };
}

function smallPrices() {
  const n = dates.length;
  const y = Array.from({ length: n }, (_, i) => Math.sin(i / 3) * 0.02);
  const spy = Array.from({ length: n }, (_, i) => Math.sin(i / 4) * 0.015);
  return {
    window: { alignedDates: dates },
    symbols: { SPY: { returns: spy }, AAA: { returns: y } },
  };
}

const prior = new Date(Date.parse(dates[0] + "T00:00:00Z") - 7 * 86400000).toISOString().slice(0, 10);
const pointsFor = (id) => [prior, ...dates].map((d, i) => ({ date: d, population_percentile: 0.5 + 0.02 * Math.sin(i / 3) }));

function fakeSeries(counter = { calls: 0 }) {
  return async (ids) => {
    counter.calls++;
    const byEntity = new Map(ids.map((id) => [id, pointsFor(id)]));
    return { byEntity, calls: [{ replayed: false }, { replayed: false }] };
  };
}

test("liveStatus is off unless both the flag and the key are present", () => {
  assert.equal(liveStatus({}).enabled, false);
  assert.equal(liveStatus({ AGENT_LIVE_QLOO: "1" }).enabled, false);
  assert.equal(liveStatus({ QLOO_API_KEY: "k" }).enabled, false);
  const on = liveStatus({ AGENT_LIVE_QLOO: "1", QLOO_API_KEY: "k" });
  assert.equal(on.enabled, true);
  assert.deepEqual(on.tools, ["live_brand_trends", "live_cultural_beta"]);
});

test("brand names that would reach a command line are refused", () => {
  assert.equal(validateBrandName("Lululemon").name, "Lululemon");
  assert.equal(validateBrandName("  Bath   & Body Works ").name, "Bath & Body Works");
  assert.ok(validateBrandName("Disney%PATH%").error);
  assert.ok(validateBrandName('He said "hi"').error);
  assert.ok(validateBrandName("a|b").error);
  assert.ok(validateBrandName("x".repeat(81)).error);
  assert.ok(validateBrandName("!!!").error);
});

test("tickers are strict", () => {
  assert.equal(validateTicker("dis").ticker, "DIS");
  assert.equal(validateTicker("BRK.B").ticker, "BRK.B");
  assert.ok(validateTicker("DIS!").error);
  assert.ok(validateTicker("").error);
});

test("pickEntity prefers an exact name over Qloo's first candidate", () => {
  const results = [{ id: "1", name: "Lululemon Athletica" }, { id: "2", name: "Lululemon" }];
  assert.equal(pickEntity(results, "lululemon").id, "2");
  assert.equal(pickEntity([], "nike"), null);
  assert.equal(pickEntity(results, "nike").id, "1");
  assert.equal(pickEntity(results, "zzz").id, "1");
});

test("the daily budget reserves a bound, refuses past the cap, and refunds to actual", async () => {
  const file = resolve(tmpDir(), "budget.json");
  const a = await reserve(40, { file, cap: 100 });
  assert.equal(a.ok, true);
  assert.equal(readBudget(file).requests, 40);
  const b = await reserve(70, { file, cap: 100 });
  assert.equal(b.ok, false);
  await settle({ reserved: 40, spent: 12, ops: 2 }, { file });
  assert.equal(readBudget(file).requests, 12);
  assert.equal(readBudget(file).ops, 2);
});

test("alignLive keeps only weeks where all three inputs exist", () => {
  const basket = new Map([[dates[0], 0.01], [dates[1], null], [dates[2], 0.02]]);
  const ret = new Map(dates.map((d) => [d, 0.001]));
  const out = alignLive({ dates: dates.slice(0, 3), basket, returnsByDate: ret, spyByDate: ret });
  assert.deepEqual(out.used, [dates[0], dates[2]]);
});

test("regressLive returns finite coefficients and refuses a short sample", () => {
  const n = 30;
  const spy = Array.from({ length: n }, (_, i) => Math.sin(i / 4) * 0.01);
  const taste = Array.from({ length: n }, (_, i) => Math.cos(i / 5) * 0.01);
  const y = spy.map((s, i) => 1.2 * s + 4 * taste[i] + 0.001);
  const out = regressLive({ y, spy, taste });
  assert.equal(out.weeks, n);
  assert.ok(Number.isFinite(out.cultural.beta));
  assert.ok(out.cultural.t > 10);
  assert.ok(Number.isFinite(out.marketOnly.beta));
  assert.throws(() => regressLive({ y: [1, 2], spy: [1, 2], taste: [1, 2] }), /too few/);
});

test("live_brand_trends resolves, pulls, and reports spend", async () => {
  const budget = resolve(tmpDir(), "b.json");
  const state = { liveCalls: 0 };
  const tools = createLiveTools({
    desk: smallDesk(), state, budgetFile: budget, pricesFile: resolve(tmpDir(), "missing.json"),
    qloo: {
      search: async () => [{ entity_id: "e9", name: "Gymshark", types: ["urn:entity:brand"] }],
      results: (json) => json.map((e) => ({ id: e.entity_id, name: e.name, type: e.types[0] })),
      series: fakeSeries(),
    },
  });
  const out = await tools.get("live_brand_trends").run({ name: "Gymshark" });
  assert.equal(out.resolved, true);
  assert.equal(out.entity.id, "e9");
  assert.equal(out.qloo.requests, 3);
  assert.equal(out.qloo.replayedPages, 0);
  assert.equal(readBudget(budget).requests, 3);
});

test("live_brand_trends refuses unsafe input without spending", async () => {
  const budget = resolve(tmpDir(), "b.json");
  const tools = createLiveTools({ desk: smallDesk(), budgetFile: budget, pricesFile: resolve(tmpDir(), "x.json"), qloo: { series: fakeSeries() } });
  const out = await tools.get("live_brand_trends").run({ name: "bad%name" });
  assert.match(out.error, /refuses/);
  assert.equal(readBudget(budget).requests, 0);
});

test("live_cultural_beta re-runs the estimator and compares with the committed row", async () => {
  const dir = tmpDir();
  const budget = resolve(dir, "b.json");
  writeFileSync(resolve(dir, "prices.json"), JSON.stringify(smallPrices()));
  const state = { liveCalls: 0 };
  const tools = createLiveTools({
    desk: smallDesk(), state, budgetFile: budget,
    pricesFile: resolve(dir, "prices.json"), qloo: { series: fakeSeries() },
  });
  const out = await tools.get("live_cultural_beta").run({ ticker: "AAA" });
  assert.equal(out.ticker, "AAA");
  assert.equal(out.live.weeks, 30);
  assert.ok(Number.isFinite(out.live.cultural.beta));
  assert.equal(out.committed.culturalBeta, 3.5);
  assert.equal(out.basketMembers.length, 2);
  const again = await tools.get("live_cultural_beta").run({ ticker: "AAA" });
  assert.equal(again.code, "LIVE_CALL_CAP");
});

test("live_cultural_beta says so when the ticker is not in the book", async () => {
  const tools = createLiveTools({ desk: smallDesk(), budgetFile: resolve(tmpDir(), "b.json"), pricesFile: resolve(tmpDir(), "x.json"), qloo: { series: fakeSeries() } });
  const out = await tools.get("live_cultural_beta").run({ ticker: "ZZZ" });
  assert.match(out.error, /not in the book/);
  assert.match(out.hint, /live_brand_trends/);
});

test("the live budget stops a read before it touches the endpoint", async () => {
  const budget = resolve(tmpDir(), "b.json");
  writeFileSync(budget, JSON.stringify({ date: new Date().toISOString().slice(0, 10), requests: 119, ops: 0 }));
  const tools = createLiveTools({ desk: smallDesk(), budgetFile: budget, pricesFile: resolve(tmpDir(), "x.json"), qloo: { series: fakeSeries() } });
  const out = await tools.get("live_brand_trends").run({ name: "Gymshark" });
  assert.equal(out.code, "LIVE_BUDGET_EXHAUSTED");
});

test("withLiveTools merges without mutating the base map", () => {
  const base = new Map([["desk_summary", { def: {}, run: () => ({}) }]]);
  const merged = withLiveTools(base, { desk: smallDesk(), pricesFile: resolve(tmpDir(), "x.json"), qloo: { series: fakeSeries() } });
  assert.equal(base.size, 1);
  assert.equal(merged.size, 3);
  assert.ok(merged.has("live_brand_trends"));
  assert.ok(merged.has("live_cultural_beta"));
});

test("LIVE constants are bounded", () => {
  assert.equal(LIVE.callsPerAnswer, 1);
  assert.ok(LIVE.maxTrendPages <= 96);
  assert.ok(LIVE.dailyRequests <= 200);
});
