// Unit tests for the Taste X-ray view's pure arithmetic (desk/xray.js): the
// lenient holdings parser, the position-weighted rollup, the canonical share
// link, and the honesty rules for the freshness gate and the revision replay.
// The desk script is a browser classic script, so it is evaluated here in a bare
// sandbox with a stub window; no DOM, no fetch, no committed data files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const src = readFileSync(fileURLToPath(new URL("../desk/xray.js", import.meta.url)), "utf8");
const sandbox = {};
sandbox.window = sandbox;
vm.runInNewContext(src, sandbox);
const X = sandbox.window.__xray;
assert.ok(X, "xray.js must expose its pure helpers on window.__xray");
// Values built inside the vm realm carry that realm's Array/Object prototypes,
// so bring them across before structural assertions.
const host = (x) => JSON.parse(JSON.stringify(x));

const desk = {
  rows: [
    {
      ticker: "DIS", label: "Walt Disney", status: "ok",
      culturalBeta: 2, marketBeta: 1,
      basket: [{ name: "Disneyland", weight: 0.6 }, { name: "Pixar", weight: 0.4 }],
    },
    {
      ticker: "NKE", label: "Nike", status: "ok",
      culturalBeta: 1, marketBeta: 0.5,
      basket: [{ name: "Disneyland", weight: 0.25 }, { name: "Runner's World", weight: 0.75 }],
    },
    { ticker: "WAIT", label: "Not estimated", status: "stale" },
  ],
};

test("parser: the canonical paste keeps typed weights", () => {
  const p = host(X.parseHoldings("DIS 40%, NKE 25%, SBUX 20%, AAPL 15%"));
  assert.deepEqual(p.map((h) => h.ticker), ["DIS", "NKE", "SBUX", "AAPL"]);
  assert.deepEqual(p.map((h) => h.weight), [40, 25, 20, 15]);
});

test("parser: plain tickers are weightless (equal weights at normalisation)", () => {
  const p = host(X.parseHoldings("DIS, NKE SBUX"));
  assert.deepEqual(p.map((h) => h.ticker), ["DIS", "NKE", "SBUX"]);
  assert.ok(p.every((h) => h.weight === null));
});

test("parser: colon form, percent-less weights, newlines, repeats stack", () => {
  assert.deepEqual(host(X.parseHoldings("DIS:40,NKE:25").map((h) => [h.ticker, h.weight])), [["DIS", 40], ["NKE", 25]]);
  assert.deepEqual(host(X.parseHoldings("DIS 40\nNKE 25").map((h) => [h.ticker, h.weight])), [["DIS", 40], ["NKE", 25]]);
  const dup = host(X.parseHoldings("DIS 10, DIS 30"));
  assert.deepEqual(dup, [{ ticker: "DIS", weight: 40 }]);
});

test("parser: drops stray words and junk, never throws on empty", () => {
  assert.deepEqual(host(X.parseHoldings("THE and OF")), []);
  assert.deepEqual(host(X.parseHoldings("")), []);
  assert.deepEqual(host(X.parseHoldings(null)), []);
  assert.equal(host(X.parseHoldings("DIS 40%, &garbage"))[0].ticker, "DIS");
});

test("canonical link: round-trips the canonical #/xray?h= form", () => {
  assert.equal(X.canonicalLink(X.parseHoldings("DIS 40%, NKE 25%, SBUX 20%, AAPL 15%")), "#/xray?h=DIS:40,NKE:25,SBUX:20,AAPL:15");
  assert.equal(X.canonicalLink(X.parseHoldings("DIS, NKE")), "#/xray?h=DIS:1,NKE:1");
  assert.equal(X.canonicalLink(X.parseHoldings("DIS 12.345")), "#/xray?h=DIS:12.35");
});

test("rollup: betas are position-weighted over covered rows only", () => {
  const r = X.rollup(X.parseHoldings("DIS 75%, NKE 25%"), desk);
  assert.equal(r.cultural, 0.75 * 2 + 0.25 * 1);
  assert.equal(r.market, 0.75 * 1 + 0.25 * 0.5);
  const mix = X.rollup(X.parseHoldings("DIS 50%, NKE 50%, NOPE 50%"), desk); // NOPE unknown, excluded
  assert.equal(mix.cultural, 1.5);
});

test("rollup: entity scores are weight x basketWeight, normalised to taste shares", () => {
  const r = X.rollup(X.parseHoldings("DIS 50%, NKE 50%"), desk);
  const top = r.entities[0];
  assert.equal(top.name, "Disneyland");
  assert.ok(Math.abs(top.score - (0.5 * 0.6 + 0.5 * 0.25)) < 1e-12); // 0.425 of the taste mass
  assert.ok(Math.abs(r.topShare - top.score) < 1e-12);
  assert.ok(r.entities.every((e) => e.score > 0));
});

test("rollup: concentration sentence input reflects the same weighted mass", () => {
  const r = X.rollup(X.parseHoldings("DIS 100%"), desk);
  assert.equal(r.entities[0].name, "Disneyland");
  assert.ok(Math.abs(r.topShare - 0.6) < 1e-12);
});

test("classify: covered / listed-but-unestimated / unknown", () => {
  assert.equal(X.classify({ ticker: "DIS" }, desk).kind, "covered");
  assert.equal(X.classify({ ticker: "WAIT" }, desk).kind, "listed");
  assert.equal(X.classify({ ticker: "ZZZZ" }, desk).kind, "unknown");
  assert.equal(X.classify({ ticker: "ZZZZ" }, null).kind, "unknown");
});

test("gate: an unchecked peek prints unattested and unsigned, never a date", () => {
  const g0 = X.gateOf(null);
  assert.deepEqual(host(g0), { state: "unattested", stamp: "unsigned", detail: "freshness endpoint did not answer" });
  const g = X.gateOf({ checked: false, why: "not_checked_yet", live: true });
  assert.equal(g.state, "unattested");
  assert.equal(g.stamp, "unsigned");
  assert.equal(g.detail, "not_checked_yet");
});

test("gate: a checked peek maps verdicts to pass/moved, keeping only carried fields", () => {
  assert.equal(X.gateOf({ checked: true, verdict: "nothing_newer_than_panel_tail", latestWeek: "2026-10-20", at: "2026-10-30T10:00:00Z" }).state, "pass");
  assert.equal(X.gateOf({ checked: true, verdict: "qloo_has_a_newer_revision" }).state, "moved");
  // No stamp in the payload as shipped -> "unsigned", not a plausible hash.
  assert.equal(X.gateOf({ checked: true, verdict: "nothing_newer_than_panel_tail" }).stamp, "unsigned");
});

test("replay: the mover sentence is built from the artifact's own numbers", () => {
  const replay = { revisionWeek: "2025-12-22", vintageBefore: { through: "2025-12-01" }, movers: [{ ticker: "DIS", betaBefore: 52.77452111145094, betaAfter: 43.80898536170825 }] };
  assert.equal(X.moverLine("DIS", replay), "moved between vintages: 52.77 at the pre-revision vintage (55 weeks) → 43.81 on today's panel (102 weeks); the move mixes Qloo's December 2025 revision with the longer sample");
  assert.equal(X.moverLine("KO", { movers: [{ ticker: "KO", betaBefore: 1.2, betaAfter: 1.5 }] }), null); // a sub-point wobble is not a move
  assert.equal(X.moverLine("NKE", replay), null); // not in the artifact, no claim
  assert.equal(X.moverLine("DIS", null), null);
});

test("shorts, junk weights and dollar amounts are read back, never silently re-signed or re-weighted", () => {
  const a = X.parseHoldings("DIS:-10, NKE:abc, SBUX 20");
  assert.equal(JSON.stringify(a.map((h) => [h.ticker, h.weight])), JSON.stringify([["SBUX", 20]]));
  assert.equal(a.skipped.length, 2);
  assert.match(a.skipped[0].why, /long-only/);
  assert.match(a.skipped[1].why, /not a number/);
  const b = X.parseHoldings("DIS $40,000, NKE $25,000");
  assert.equal(JSON.stringify(b.map((h) => [h.ticker, h.weight])), JSON.stringify([["DIS", 40000], ["NKE", 25000]]));
  assert.equal(X.parseHoldings("DIS:40, NKE").mixed, true);
  assert.equal(X.parseHoldings("DIS:40, NKE:60").mixed, false);
});

test("the rollup reports what share of the pasted weight it covers", () => {
  const desk = { rows: [{ ticker: "DIS", status: "ok", culturalBeta: 40, marketBeta: 1, basket: [] }] };
  const r = X.rollup(X.parseHoldings("DIS:75, ZZZZ:25"), desk);
  assert.ok(Math.abs(r.coveredShare - 0.75) < 1e-12);
  assert.equal(r.cultural, 40);
});
