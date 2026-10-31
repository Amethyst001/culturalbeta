import test from "node:test";
import assert from "node:assert/strict";
import { reestimateAfterRevision, revisionAddendum, revisionPayload } from "../src/reestimate.mjs";

// The committed side of the re-estimation table is the desk row of record, read
// straight from the live tool's committed object; the live side is the estimator
// re-run. These tests pin the two to distinct payload fields (they may hold equal
// VALUES — the honest identical case — but they must be sourced independently) and
// pin the one sentence that may explain an unchanged t and ΔR² beside a moved beta.

const IDENTICAL = "The revision's whole move lands in the coefficient; the fit neither tightened nor loosened (t = beta/se scales with it).";

// The live tool's output shape: committed straight off the desk row, live from the
// re-run estimator (beta and t under live.cultural, ΔR² on the live object).
const toolResult = ({ beta = 43.81, t = 3.17, deltaR2 = 0.0673, liveBeta = 52.77, liveT = 4.05, liveDeltaR2 = 0.0912 } = {}) => ({
  ticker: "DIS",
  window: { committedWeeks: 102, liveWeeks: 102, droppedWeeks: 0 },
  live: { cultural: { beta: liveBeta, t: liveT }, deltaR2: liveDeltaR2 },
  committed: { culturalBeta: beta, culturalT: t, deltaR2 },
  change: { beta: liveBeta - beta, t: liveT - t, deltaR2: liveDeltaR2 - deltaR2 },
  qloo: { requests: 0, replayedPages: 47 },
});

// The shape reestimateAfterRevision stores, which the addendum and payload read.
const mappedResult = (fixture = {}) => {
  const r = toolResult(fixture);
  return {
    ticker: r.ticker,
    ok: true,
    committed: r.committed,
    live: r.live.cultural,
    deltaR2: r.live.deltaR2,
    change: r.change,
    requests: 0,
    replayedPages: 47,
  };
};

const reestimation = (r) => ({ triggered: true, tickers: [r.ticker], spent: 0, replayed: 47, results: [r] });

test("the payload exposes the committed side as its own fields, sourced separately from the live side", () => {
  // Committed and live differ in this fixture, so equal values could not fake a pass.
  const p = revisionPayload(reestimation(mappedResult()), [{ entity: { ticker: "DIS", name: "Disney" } }]);
  const row = p.results[0];
  assert.equal(Object.hasOwn(row, "committedT"), true, "committedT must be a field of its own, not only nested");
  assert.equal(Object.hasOwn(row, "committedDeltaR2"), true);
  assert.equal(row.committedT, 3.17);
  assert.equal(row.committedT, row.committed.t);
  assert.equal(row.committedDeltaR2, 0.0673);
  assert.equal(row.committedDeltaR2, row.committed.deltaR2);
  // The fraction is stored as a fraction: conversion to points is the prose's job.
  assert.notEqual(row.committedDeltaR2, 6.73);
  assert.equal(row.live.t, 4.05);
  assert.equal(row.live.deltaR2, 0.0912);
  assert.notEqual(row.committedT, row.live.t);
  assert.notEqual(row.committedDeltaR2, row.live.deltaR2);
});

test("the committed fields exist even when the two sides hold equal values", () => {
  // The genuinely identical case: a rescaling revision moves beta, not t or ΔR².
  const p = revisionPayload(reestimation(mappedResult({ liveT: 3.17, liveDeltaR2: 0.0673 })), []);
  const row = p.results[0];
  assert.equal(Object.hasOwn(row, "committedT"), true);
  assert.equal(Object.hasOwn(row, "committedDeltaR2"), true);
  assert.equal(row.committedT, row.live.t);
  assert.equal(row.committedDeltaR2, row.live.deltaR2);
});

test("identicalNote is null when the sides differ and a sentence when they print the same", () => {
  const differing = revisionPayload(reestimation(mappedResult()), []).results[0];
  assert.equal(differing.identicalNote, null);
  // Equal only at the precision the answer prints: t to 2dp, ΔR² to 4dp.
  const identical = revisionPayload(reestimation(mappedResult({ liveT: 3.166, liveDeltaR2: 0.06734 })), []).results[0];
  assert.equal(identical.identicalNote, IDENTICAL);
  // One dimension matching is not the note: the fit must be unchanged too.
  const half = revisionPayload(reestimation(mappedResult({ liveT: 3.171, liveDeltaR2: 0.0681 })), []).results[0];
  assert.equal(half.identicalNote, null);
});

test("a failed re-estimate carries no committed fields and no note", () => {
  const p = revisionPayload({ triggered: false, tickers: ["DIS"], spent: 0, replayed: 0, results: [{ ticker: "DIS", ok: false, error: "budget exhausted" }] }, []);
  const row = p.results[0];
  assert.equal(row.committedT, null);
  assert.equal(row.committedDeltaR2, null);
  assert.equal(row.identicalNote, null);
});

test("the addendum prints ΔR² in points on both sides and appends the note only when it applies", () => {
  const differing = revisionAddendum({ moved: [{ entity: { ticker: "DIS", name: "Disney" } }], reestimation: reestimation(mappedResult()) });
  assert.match(differing, /ΔR² \+6\.73 pts → \+9\.12 pts/);
  assert.doesNotMatch(differing, /whole move lands in the coefficient/);

  const identical = revisionAddendum({ moved: [{ entity: { ticker: "DIS", name: "Disney" } }], reestimation: reestimation(mappedResult({ liveT: 3.166, liveDeltaR2: 0.06734 })) });
  assert.match(identical, /ΔR² \+6\.73 pts → \+6\.73 pts/);
  assert.match(identical, /whole move lands in the coefficient/);

  const negative = revisionAddendum({ moved: [{ entity: { ticker: "DIS", name: "Disney" } }], reestimation: reestimation(mappedResult({ deltaR2: -0.0411, liveDeltaR2: -0.0411, liveT: 3.17 })) });
  assert.match(negative, /ΔR² -4\.11 pts → -4\.11 pts/);
});

test("the live tool's committed object reaches the payload unchanged, through the injected run", async () => {
  // The run function is the live tool's; whatever desk row it hands back as
  // `committed` is what the payload must print — never the re-estimated row.
  const run = async () => toolResult({ liveT: 3.166, liveDeltaR2: 0.06734 });
  const out = await reestimateAfterRevision({ moved: [{ entity: { ticker: "DIS" } }], run });
  const p = revisionPayload(out, [{ entity: { ticker: "DIS" } }]);
  assert.equal(p.results[0].committedT, 3.17);
  assert.equal(p.results[0].committedDeltaR2, 0.0673);
  assert.equal(p.results[0].live.beta, 52.77);
  assert.equal(p.results[0].identicalNote, IDENTICAL);
});
