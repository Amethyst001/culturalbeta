import test from "node:test";
import assert from "node:assert/strict";
import { vintageRowsFromMovers, applyVintageRows } from "../src/vintage-rows.mjs";
import { revisionAddendum } from "../src/reestimate.mjs";

const movers = [{ ticker: "DIS", betaBefore: 52.7745, tBefore: 3.1506, deltaR2Before: 0.12257, betaAfter: 43.809, tAfter: 3.166, deltaR2After: 0.06727 }];
const rows = [{ ticker: "DIS", culturalBeta: 43.809, culturalT: 3.166, deltaR2: 0.06727, culturalQ: 0.164 }, { ticker: "KDP", culturalBeta: -27.4, culturalT: -2.67, deltaR2: 0.01 }];

test("the replay desk takes beta, t and ΔR² from the same vintage row", () => {
  const out = applyVintageRows(rows, vintageRowsFromMovers(movers));
  const dis = out.find((r) => r.ticker === "DIS");
  assert.equal(dis.culturalBeta, 52.7745);
  assert.equal(dis.culturalT, 3.1506);
  assert.equal(dis.deltaR2, 0.12257);
  assert.equal(dis.culturalQ, 0.164, "book-wide q is carried, not invented");
  assert.notEqual(dis, rows[0], "the committed row object is never mutated");
  assert.equal(rows[0].culturalT, 3.166);
  assert.equal(out.find((r) => r.ticker === "KDP"), rows[1], "names outside the replay are untouched");
});

test("a mover without t or ΔR² keeps the row's own values instead of printing NaN", () => {
  const out = applyVintageRows(rows, vintageRowsFromMovers([{ ticker: "DIS", betaBefore: 50 }]));
  assert.equal(out[0].culturalBeta, 50);
  assert.equal(out[0].culturalT, 3.166);
});

test("the addendum prints ΔR² in points from both sides of the pair", () => {
  const s = revisionAddendum({ moved: [{ ticker: "DIS" }], reestimation: { results: [{ ticker: "DIS", ok: true, committed: { culturalBeta: 52.77, culturalT: 3.15, deltaR2: 0.1226 }, live: { beta: 43.81, t: 3.17 }, deltaR2: 0.0673 }], replayed: 47, spent: 0 } });
  assert.match(s, /t 3\.15 → 3\.17; ΔR² \+12\.26 pts → \+6\.73 pts/);
  assert.doesNotMatch(s, /fit neither tightened/, "a real t move must not carry the identical-fit note");
});

import { revisionAddendum as addendum2 } from "../src/reestimate.mjs";
test("in replay mode the addendum names the pre-revision vintage, not the reading of record, as the first number", () => {
  const reestimation = { spent: 0, replayed: 47, results: [{ ok: true, ticker: "DIS", committed: { culturalBeta: 52.77, culturalT: 3.15, deltaR2: 0.1226 }, live: { beta: 43.81, t: 3.17 }, deltaR2: 0.0673 }] };
  const replayText = addendum2({ moved: [], reestimation, caveat: "Replay caveat: x." });
  assert.match(replayText, /first number in each pair is the pre-revision vintage/);
  assert.doesNotMatch(replayText, /first number in each pair is the committed reading of record/);
});
