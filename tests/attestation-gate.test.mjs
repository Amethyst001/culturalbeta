// The gate is what separates a receipt that sits beside an answer from a receipt the
// answer acts on: a revision the check finds must change the answer's status, and a
// check that could not run must never be readable as a pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { attestationStamp, attestationGate } from "../src/live-qloo.mjs";

const entity = (over = {}) => ({ entity: { id: "E1", name: "Youtube", type: "brand", ticker: "DIS", sector: "media" }, checked: true, verdict: "newer_weeks_no_change", latestWeek: "2026-10-31", ...over });

const passing = {
  checked: true,
  verdict: "newer_weeks_no_change",
  latestWeek: "2026-10-31",
  answeredAt: "2026-10-30T21:47:12.000Z",
  correlationIds: ["exec-1"],
  entities: [entity()],
  panel: { lastRevision: "2025-12-22", windowEnd: "2026-10-26" },
};

test("a passing check says what it read and stamps the fields a reader can recompute", () => {
  const g = attestationGate(passing);
  assert.equal(g.state, "pass");
  assert.match(g.stamp, /^att-[0-9a-f]{12}$/);
  assert.match(g.note, /read for 1 entity/);
  assert.match(g.note, /21:47:12Z/);
  assert.equal(g.stamp, attestationStamp(passing), "the stamp is a function of the receipt alone");
});

test("the stamp moves when the reading moves, and not otherwise", () => {
  const a = attestationStamp(passing);
  assert.equal(attestationStamp({ ...passing, fromCache: true, cachedSeconds: 300, requests: 0 }), a, "cache and spend are not part of the claim");
  assert.notEqual(attestationStamp({ ...passing, latestWeek: "2026-11-07" }), a);
  assert.notEqual(attestationStamp({ ...passing, verdict: "qloo_has_a_newer_revision" }), a);
  assert.notEqual(attestationStamp({ ...passing, correlationIds: ["exec-2"] }), a);
});

test("a revision after the panel changes the answer's status, and names the entity", () => {
  const moved = {
    ...passing,
    verdict: "qloo_has_a_newer_revision",
    entities: [entity({ verdict: "qloo_has_a_newer_revision", latestRevision: "2026-03-02" })],
  };
  const g = attestationGate(moved);
  assert.equal(g.state, "moved");
  assert.match(g.note, /DIS \(Youtube\)/);
  assert.match(g.note, /2026-03-02/);
  assert.match(g.note, /no longer matches the feed/);
  assert.match(g.note, /2025-12-22/);
});

test("a check that could not run is unattested, never a pass and never a date", () => {
  for (const why of ["live_gate_off", "qloo_key_missing", "budget_exhausted", "no_trend_points"]) {
    const g = attestationGate({ checked: false, why, at: "2026-10-30T21:00:00.000Z" });
    assert.equal(g.state, "unattested");
    assert.ok(g.note.startsWith(`Not attested: ${why}`));
    assert.match(g.note, /nothing on this page has confirmed them against Qloo today/);
    assert.equal(g.stamp, attestationGate({ checked: false, why }).stamp, "the stamp carries no time of its own");
  }
  assert.notEqual(attestationGate({ checked: false, why: "live_gate_off" }).stamp, attestationStamp(passing), "unattested cannot collide with a reading");
});

test("one moved entity is enough to move the whole answer", () => {
  const g = attestationGate({
    ...passing,
    entities: [entity(), entity({ entity: { ...entity().entity, id: "E2", name: "BECCA", ticker: "ELF", sector: "beauty" }, verdict: "qloo_has_a_newer_revision", latestRevision: "2026-01-04" })],
  });
  assert.equal(g.state, "moved");
  assert.match(g.note, /ELF \(BECCA\)/);
  assert.doesNotMatch(g.note, /DIS \(Youtube\)/);
});
