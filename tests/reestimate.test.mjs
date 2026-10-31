import test from "node:test";
import assert from "node:assert/strict";
import { reestimateAfterRevision, revisionAddendum, revisionPayload } from "../src/reestimate.mjs";

const moved = [
  { entity: { ticker: "DIS", name: "Disney" }, latestRevision: "2025-12-22" },
  { entity: { ticker: "KDP", name: "Keurig Dr Pepper" }, latestRevision: "2025-12-22" },
  { entity: { ticker: "HSY", name: "Hershey" }, latestRevision: "2025-12-22" },
];

const liveOk = (ticker, beta, t, r2 = 0.07) => ({
  ticker,
  committed: { culturalBeta: 43.81, culturalT: 3.17, deltaR2: 0.0673 },
  live: { cultural: { beta, t } },
  deltaR2: r2,
  change: { beta: 1, t: 0.1, deltaR2: 0.001 },
  window: { start: "a", end: "b", committedWeeks: 102, liveWeeks: 102, droppedWeeks: 0 },
  qloo: { requests: 0, replayedPages: 47, correlationIds: ["cid-1"], files: ["page.json"] },
});

test("re-estimates only the revised names, at most the cap, once each", async () => {
  const calls = [];
  const run = async ({ ticker }) => {
    calls.push(ticker);
    return liveOk(ticker, 44.12, 3.22);
  };
  const out = await reestimateAfterRevision({ moved, run, max: 2 });
  assert.deepEqual(calls, ["DIS", "KDP"]);
  assert.equal(out.triggered, true);
  assert.equal(out.results.filter((r) => r.ok).length, 2);
});

test("a failed live read is reported, not swallowed", async () => {
  const run = async ({ ticker }) => (ticker === "DIS" ? { error: "daily cap reached", code: "BUDGET" } : liveOk(ticker, 40, 2.9));
  const out = await reestimateAfterRevision({ moved: moved.slice(0, 2), run, max: 2 });
  assert.equal(out.results[0].ok, false);
  assert.match(out.results[0].error, /daily cap/);
  assert.equal(out.results[1].ok, true);
  assert.equal(out.triggered, true);
});

test("a thrown live read does not stop the next name", async () => {
  let n = 0;
  const run = async ({ ticker }) => {
    n++;
    if (n === 1) throw Object.assign(new Error("boom"), { code: "LIVE_FAILED" });
    return liveOk(ticker, 40, 2.9);
  };
  const out = await reestimateAfterRevision({ moved, run, max: 2 });
  assert.equal(out.results.length, 2);
  assert.equal(out.results[1].ok, true);
});

test("no revised name means no spend and an explicit reason", async () => {
  const out = await reestimateAfterRevision({ moved: [], run: async () => { throw new Error("must not run"); } });
  assert.equal(out.triggered, false);
  assert.equal(out.reason, "no_revised_name_in_book");
});

test("the addendum always prints committed and re-estimated side by side", () => {
  const out = {
    triggered: true,
    tickers: ["DIS"],
    spent: 0,
    replayed: 47,
    results: [{ ticker: "DIS", ok: true, committed: { culturalBeta: 43.81, culturalT: 3.17, deltaR2: 0.0673 }, live: { beta: 44.12, t: 3.22 }, deltaR2: 0.0681 }],
  };
  const text = revisionAddendum({ moved: [moved[0]], reestimation: out });
  assert.match(text, /43\.81 → 44\.12/);
  assert.match(text, /committed reading of record/);
  assert.match(text, /no new Qloo request/);
});

test("the addendum never hides a failure behind an absence", () => {
  const out = { triggered: false, tickers: ["DIS"], spent: 0, replayed: 0, results: [{ ticker: "DIS", ok: false, error: "budget exhausted" }] };
  const text = revisionAddendum({ moved: [moved[0]], reestimation: out });
  assert.match(text, /could not run|no number/);
  assert.match(text, /committed panel/);
  assert.match(text, /DIS/);
});

test("the payload carries the pair as fields, not only prose", () => {
  const out = {
    triggered: true,
    tickers: ["DIS"],
    spent: 0,
    replayed: 47,
    results: [{ ticker: "DIS", ok: true, committed: { culturalBeta: 43.81, culturalT: 3.17, deltaR2: 0.0673 }, live: { beta: 44.12, t: 3.22 }, deltaR2: 0.0681, change: { beta: 0.31 }, requests: 0, replayedPages: 47, correlationIds: ["cid"] }],
  };
  const p = revisionPayload(out, moved.slice(0, 1));
  assert.equal(p.results[0].committed.beta, 43.81);
  assert.equal(p.results[0].live.beta, 44.12);
  assert.equal(p.moved[0].ticker, "DIS");
  assert.equal(p.replayed, 47);
});

test("no re-estimate means no payload rather than an empty claim", () => {
  assert.equal(revisionPayload(null, moved), null);
});
