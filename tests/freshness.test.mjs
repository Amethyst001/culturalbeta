// The mandatory live freshness attestation and the per-answer receipt. The Qloo
// client is injected, so what is under test is the bound, the cache, the degradation
// and the provenance — never a live endpoint. No test here can produce a date: a
// fabricated attestation is the failure this feature exists to prevent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  FRESHNESS, freshnessGateReason, referenceEntity, qlooFreshnessReading,
  runFreshnessCheck, createFreshnessChecker, readBudget,
} from "../src/live-qloo.mjs";
import { collectReceipts, redactSecrets } from "../src/agent.mjs";

function tmpDir() { return mkdtempSync(resolve(tmpdir(), "freshness-")); }

const days = Array.from({ length: 20 }, (_, i) => new Date(Date.UTC(2026, 5, 1) + i * 7 * 86400000).toISOString().slice(0, 10));
// Carry-forward on Qloo's cadence: the level repeats until one week where it moves.
const frozen = (level = 41.5) => days.map((d) => ({ date: d, population_percentile: level }));
const movedAt = (i, level = 44.2) => days.map((d, j) => ({ date: d, population_percentile: j < i ? 41.5 : level }));

const desk = {
  window: { start: "2024-10-14", end: "2026-10-26", weeks: 102 },
  valueAdd: { oos: { scoring: { testable: false, lastMove: "2025-12-22" } } },
  rows: [
    { ticker: "TINY", label: "Tiny Co", status: "ok", basket: [{ id: "b1", name: "Beta", type: "artist", weight: 0.9 }] },
    {
      ticker: "DIS", label: "Disney", status: "ok", qlooEntityId: "AEBE226F-1680-4C44-A4E6-792BC2E00931",
      basketScope: "sector:media",
      basket: [
        { id: "51AC9AB8-EF60-42AF-878C-D9EB34B50721", name: "Youtube", type: "brand", weight: 0.1256866907 },
        { id: "A79D1D11-0686-401E-8FFF-633E6A604929", name: "Captain Marvel", type: "movie", weight: 0.1264600512 },
      ],
      provenance: {
        entity: "fixtures/qloo/search-DIS.json",
        basket: "fixtures/qloo/basket-sector-media.json",
        series: "fixtures/qloo/series.json",
        prices: "fixtures/prices.json",
        qlooRequest: { operation: "recommend", path: "/v2/insights", entity: "AEBE226F-1680-4C44-A4E6-792BC2E00931", types: ["brand", "movie"], signals: ["AEBE226F-1680-4C44-A4E6-792BC2E00931"] },
      },
    },
  ],
};

const keyedEnv = { AGENT_LIVE_QLOO: "1", QLOO_API_KEY: "test-key-1234567890" };
function withLiveEnv(patch, fn) {
  const before = { ...process.env };
  Object.assign(process.env, patch);
  try { return fn(); } finally {
    for (const k of Object.keys(process.env)) if (!(k in before)) delete process.env[k];
    Object.assign(process.env, before);
  }
}

function fakeQloo(points, { correlationId = "cid-77af-0001", replayed = false, calls = null } = {}) {
  const seen = { n: 0, args: [] };
  return {
    seen,
    series: async (ids, type, opts) => {
      seen.n++;
      seen.args.push({ ids, type, ...opts });
      const list = calls ?? [{ correlationId, replayed, cacheName: `page-${seen.n}.json`, points: points.length }];
      return { byEntity: new Map(ids.map((id) => [id, points])), calls: list, cadenceDays: 7 };
    },
  };
}

test("the gate is the first word: no env, no attestation, no date", async () => {
  assert.equal(freshnessGateReason({}), "live_gate_off");
  assert.equal(freshnessGateReason({ AGENT_LIVE_QLOO: "1" }), "qloo_key_missing");
  assert.equal(freshnessGateReason({ AGENT_LIVE_QLOO: "1", QLOO_API_KEY: "  " }), "qloo_key_missing");
  assert.equal(freshnessGateReason({ AGENT_LIVE_QLOO: "1", QLOO_API_KEY: "k" }), null);
  const budget = resolve(tmpDir(), "b.json");
  const q = fakeQloo(frozen());
  const out = await withLiveEnv({ AGENT_LIVE_QLOO: "0", QLOO_API_KEY: "" }, () => runFreshnessCheck({ desk, qloo: q, budgetFile: budget }));
  assert.equal(out.checked, false);
  assert.equal(out.why, "live_gate_off");
  assert.equal(q.seen.n, 0);
  assert.equal(readBudget(budget).requests, 0);
  // The absolute rule: nothing that reads like a Qloo date exists in a failed check.
  for (const k of ["latestWeek", "latestRevision", "verdict", "plain", "requests", "correlationIds"]) {
    assert.equal(out[k], undefined, `unchecked attestation must not carry ${k}`);
  }
});

test("the reference entity is read from the panel, never invented", () => {
  const ref = referenceEntity(desk);
  assert.equal(ref.ticker, "DIS");
  // the brand wins over the heavier movie because brands carry the deepest history
  assert.deepEqual(ref, { ticker: "DIS", id: "51AC9AB8-EF60-42AF-878C-D9EB34B50721", name: "Youtube", type: "brand", weight: 0.1257 });
  assert.equal(referenceEntity({ rows: [] }), null);
});

test("the check spends one page, reports the verdict, and refunds the reservation", async () => {
  const budget = resolve(tmpDir(), "b.json");
  const q = fakeQloo(frozen());
  const out = await withLiveEnv(keyedEnv, () => runFreshnessCheck({ desk, qloo: q, budgetFile: budget }));
  assert.equal(out.checked, true);
  assert.equal(out.verdict, "nothing_newer_than_panel_tail");
  assert.equal(out.newerThanPanel, false);
  assert.equal(out.latestWeek, days.at(-1));
  assert.equal(out.latestRevision, null);
  assert.equal(out.panel.lastRevision, "2025-12-22");
  assert.equal(out.requests, 1);
  assert.equal(readBudget(budget).requests, 1, "the reservation is refunded to what was spent");
  assert.equal(q.seen.n, 1);
  // one page of twenty weekly points must be enough: the window is sized to it
  assert.ok(/live-freshness-/.test(q.seen.args[0].cacheName));
  assert.equal(q.seen.args[0].ids.join(","), "51AC9AB8-EF60-42AF-878C-D9EB34B50721");
  assert.ok(out.plain.includes("nothing newer than the panel tail"));
  assert.ok(out.files.length >= 1 && out.correlationIds[0] === "cid-77af-0001");
});

test("a basket that asks for two pages never spends more than the cap", async () => {
  const budget = resolve(tmpDir(), "b.json");
  const q = fakeQloo(frozen(), { calls: [
    { correlationId: "cid-a", replayed: false, cacheName: "page-1.json" },
    { correlationId: "cid-b", replayed: false, cacheName: "page-2.json" },
    { correlationId: "cid-c", replayed: false, cacheName: "page-3.json" },
  ] });
  const out = await withLiveEnv(keyedEnv, () => runFreshnessCheck({ desk, qloo: q, budgetFile: budget }));
  assert.equal(out.requests, 3);
  assert.equal(readBudget(budget).requests, 3, "settle pays the pages actually walked");
  assert.equal(FRESHNESS.maxRequests, 2);
});

test("the book-level cache means five answers spend one request", async () => {
  const budget = resolve(tmpDir(), "b.json");
  let t = Date.UTC(2026, 9, 30, 18, 0, 0);
  const q = fakeQloo(frozen());
  const checker = createFreshnessChecker({ desk, clock: () => t, qloo: q, budgetFile: budget });
  const first = await checker.check();
  assert.equal(first.fromCache, false);
  for (let i = 0; i < 4; i++) {
    t += 60000;
    const again = await checker.check();
    assert.equal(again.fromCache, true);
    assert.equal(again.checked, true);
  }
  assert.equal(q.seen.n, 1);
  assert.equal(readBudget(budget).requests, 1);
  t += FRESHNESS.cacheMinutes * 60000;
  await checker.check();
  assert.equal(q.seen.n, 2, "the attestation is re-asked once it is older than the cache");
});

test("an exhausted budget degrades to a reason, never to a plausible date", async () => {
  const budget = resolve(tmpDir(), "b.json");
  writeFileSync(budget, JSON.stringify({ date: new Date().toISOString().slice(0, 10), requests: 120, ops: 0 }));
  const q = fakeQloo(movedAt(12));
  const out = await withLiveEnv(keyedEnv, () => runFreshnessCheck({ desk, qloo: q, budgetFile: budget, cap: 120 }));
  assert.equal(out.checked, false);
  assert.equal(out.why, "budget_exhausted");
  assert.equal(out.cap, 120);
  assert.equal(q.seen.n, 0, "the endpoint is never touched when the budget says stop");
  assert.equal(readBudget(budget).requests, 120, "the exhaustion is not paid for out of the same budget");
  for (const k of ["latestWeek", "latestRevision", "verdict", "plain"]) {
    assert.equal(out[k], undefined, `an exhausted-budget attestation must not carry ${k}`);
  }
});

test("a harness failure reports the code and holds it for a minute, not fifteen", async () => {
  const budget = resolve(tmpDir(), "b.json");
  let t = Date.UTC(2026, 9, 30, 18, 0, 0);
  let n = 0;
  const checker = createFreshnessChecker({
    desk, clock: () => t, budgetFile: budget,
    qloo: { series: async () => { n++; throw Object.assign(new Error("boom"), { code: "QLOO_UNAVAILABLE" }); } },
  });
  const out = await checker.check();
  assert.equal(out.checked, false);
  assert.equal(out.why, "harness_error");
  assert.equal(out.harnessCode, "QLOO_UNAVAILABLE");
  assert.equal(readBudget(budget).requests, 0, "a failed check is refunded in full");
  await checker.check();
  assert.equal(n, 1, "the failure is held briefly so an answer never queues behind a broken endpoint");
  t += (FRESHNESS.failureCacheSeconds + 1) * 1000;
  await checker.check();
  assert.equal(n, 2);
});

test("a replayed page is labelled as a cached response, not as a fresh ask", async () => {
  const budget = resolve(tmpDir(), "b.json");
  const q = fakeQloo(frozen(), { calls: [{ correlationId: "cid-old", replayed: true, cacheName: "page-old.json" }] });
  const out = await withLiveEnv(keyedEnv, () => runFreshnessCheck({ desk, qloo: q, budgetFile: budget }));
  assert.equal(out.checked, true);
  assert.equal(out.requests, 0);
  assert.equal(out.fromCachedPage, true);
  assert.equal(out.cachedResponseFetchedAt, null);
  assert.ok(out.plain.includes("replayed from the page cache"));
  assert.equal(readBudget(budget).requests, 0);
});

test("a revision newer than the panel tail is reported as newer, not as a pass", () => {
  const r = qlooFreshnessReading({ points: movedAt(12), panelLastRevision: "2025-12-22", panelWindowEnd: "2026-10-26" });
  assert.equal(r.latestRevision, days[12]);
  assert.equal(r.newerThanPanel, true);
  assert.equal(r.verdict, "qloo_has_a_newer_revision");
  assert.equal(r.revisionCount, 1);
  const none = qlooFreshnessReading({ points: [], panelLastRevision: "2025-12-22", panelWindowEnd: "2026-10-26" });
  assert.equal(none.latestWeek, null);
  assert.equal(none.verdict, "nothing_newer_than_panel_tail");
});

/* ---------- the receipt ---------- */

test("every answer carries the panel, the attestation and the calls behind it", async () => {
  const budget = resolve(tmpDir(), "b.json");
  const freshness = await withLiveEnv(keyedEnv, () => runFreshnessCheck({ desk, qloo: fakeQloo(frozen()), budgetFile: budget }));
  const trace = [
    { name: "get_holding", args: { ticker: "DIS" }, result: { ticker: "DIS", label: "Disney", status: "ok" } },
    { name: "get_basket", args: { ticker: "DIS" }, result: { ticker: "DIS" } },
    { name: "desk_summary", args: {}, result: { window: {} } },
  ];
  const out = collectReceipts({ desk, revision: "2026-10-30T18:00:00.000Z", trace, freshness });
  assert.equal(out[0].kind, "panel");
  assert.equal(out[0].file, "output/desk.json");
  const fresh = out.find((r) => r.kind === "freshness");
  assert.equal(fresh.checked, true);
  assert.ok(fresh.latestWeek, "a checked receipt does carry the week Qloo reported");
  assert.equal(fresh.verdict, "nothing_newer_than_panel_tail");
  assert.deepEqual(fresh.correlationIds, ["cid-77af-0001"], "the harness's own correlation id is in the receipt");
  assert.equal(fresh.entity, "51AC9AB8-EF60-42AF-878C-D9EB34B50721");
  assert.equal(fresh.requests, 1);
  assert.ok(fresh.files.some((f) => /live-freshness-/.test(f)));
  const committed = out.filter((r) => r.kind === "committed");
  assert.equal(committed.length, 1, "two tools on one name are one receipt");
  assert.deepEqual(committed[0].tools, ["get_holding", "get_basket"]);
  assert.deepEqual(committed[0].files, ["fixtures/qloo/search-DIS.json", "fixtures/qloo/basket-sector-media.json", "fixtures/qloo/series.json", "fixtures/prices.json"]);
  assert.equal(committed[0].request.operation, "recommend");
});

test("a live tool result contributes a receipt with its entity ids and correlation ids", () => {
  const trace = [{
    name: "live_cultural_beta",
    args: { ticker: "DIS" },
    result: {
      ticker: "DIS",
      qloo: {
        requests: 4, pages: 4, replayedPages: 0, operation: "exec trends",
        entities: ["id-1", "id-2"], correlationIds: ["cid-live-1"], files: ["page-9.json"],
        requestedAt: "2026-10-30T18:04:02.000Z", dailyBudget: { date: "2026-10-30", requests: 5, ops: 5 },
      },
    },
  }];
  const out = collectReceipts({ desk, revision: "r", trace, freshness: { checked: false, why: "budget_exhausted" } });
  const live = out.find((r) => r.kind === "live");
  assert.deepEqual(live.entities, ["id-1", "id-2"]);
  assert.deepEqual(live.correlationIds, ["cid-live-1"]);
  assert.equal(live.requests, 4);
  assert.equal(live.requestedAt, "2026-10-30T18:04:02.000Z");
  assert.equal(out.find((r) => r.kind === "freshness").checked, false);
  assert.equal(out.find((r) => r.kind === "freshness").why, "budget_exhausted");
});

test("a key can never ride along in a receipt", () => {
  const leaky = {
    checked: false, why: "harness_error",
    note: "harness stderr said QLOO_API_KEY=supersecretqlookey was used",
    bearer: "agentkeyvalue123",
    env: { PATH: "/somewhere" },
  };
  const out = collectReceipts({ desk, revision: "r", trace: [], freshness: leaky });
  const fresh = out.find((r) => r.kind === "freshness");
  assert.equal(fresh.checked, false);
  assert.equal(fresh.why, "harness_error");
  // The receipt is built from a whitelist of provenance fields, so a stray string
  // in a tool result has no path to the browser at all.
  assert.equal(fresh.note, undefined);
  assert.equal(fresh.bearer, undefined);
  assert.equal(fresh.env, undefined);
  const redacted = redactSecrets(
    { files: ["page-1.json", "used supersecretqlookey to ask"], token: "x", correlationIds: ["agentkeyvalue123"] },
    { QLOO_API_KEY: "supersecretqlookey", AGENT_API_KEY: "agentkeyvalue123" },
  );
  assert.deepEqual(redacted.files, ["page-1.json", "[redacted]"]);
  assert.deepEqual(redacted.correlationIds, ["[redacted]"]);
  assert.equal(redacted.token, undefined, "a field named like a credential is dropped outright");
});
