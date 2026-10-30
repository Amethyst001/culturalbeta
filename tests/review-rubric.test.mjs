// The panel is scored on the hackathon's own rubric: four criteria, /25 each. A
// reviewer that returns 29 on one of them, or a total that is not their sum, is
// flagged rather than clamped — a flattering number that breaks the rubric is the
// one kind of error that would inflate the record without anyone noticing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { auditScores } from "../src/rubric.mjs";

test("a criterion above 25 is flagged, and no rubric total is invented for it", () => {
  const v = { score_total: 78, scores: { technological_implementation: 18, design: 16, potential_impact: 15, quality_of_idea: 29 } };
  const a = auditScores(v);
  assert.equal(a.inRange, false);
  assert.equal(a.rubricTotal, null);
  assert.equal(a.sum, 78);
  assert.match(a.errors.join("; "), /quality_of_idea: 29 is outside 0–25/);
});

test("the four in-range criteria sum to a total that matches", () => {
  const a = auditScores({ score_total: 66, scores: { technological_implementation: 19, design: 13, potential_impact: 15, quality_of_idea: 19 } });
  assert.deepEqual(a.errors, []);
  assert.equal(a.inRange, true);
  assert.equal(a.rubricTotal, 66);
});

test("a total that is not the sum is an error, even when every criterion is legal", () => {
  const a = auditScores({ score_total: 90, scores: { technological_implementation: 20, design: 20, potential_impact: 20, quality_of_idea: 20 } });
  assert.equal(a.inRange, true);
  assert.match(a.errors.join("; "), /score_total 90 ≠ sum 80/);
});

test("a missing criterion cannot become a zero that looks like a score", () => {
  const a = auditScores({ score_total: 60, scores: { technological_implementation: 20, design: 20, potential_impact: 20 } });
  assert.equal(a.inRange, false);
  assert.match(a.errors.join("; "), /quality_of_idea: missing/);
});
