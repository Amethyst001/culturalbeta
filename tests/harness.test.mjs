// The harness transport is the only path to Qloo, so it has to be right before
// the key arrives. These tests run the adapters against a stub that speaks the
// real CLI's argv and stdin shape and enforces the same schema caps the live
// executor enforces (trends: 5 entities and 20 points per call).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STUB = resolve(ROOT, "tests/stubs/qloo-stub.mjs");
const RUNNER = resolve(ROOT, "tests/stubs/adapter-runner.mjs");

function run(env = {}) {
  const dir = mkdtempSync(resolve(tmpdir(), "cb-harness-"));
  const res = spawnSync(process.execPath, [RUNNER], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, QLOO_BIN_JS: STUB, CULTURALBETA_QLOO_DIR: dir, QLOO_API_KEY: "stub-key", ...env },
  });
  let json = null;
  try { json = JSON.parse(res.stdout); } catch { /* asserted by callers */ }
  return { res, json, dir };
}

test("search goes through qloo api and caches the response", () => {
  const { res, json, dir } = run();
  try {
    assert.equal(res.status, 0, res.stderr);
    assert.equal(json.searchRawIsArray, true, "api search prints the entity array, not an envelope");
    assert.match(json.search.id, /^urn:entity:brand:stub-/);
    assert.ok(existsSync(resolve(dir, "search-TEST.json")), "search response must be cached");
    const cached = JSON.parse(readFileSync(resolve(dir, "search-TEST.json"), "utf8"));
    assert.equal(cached.harness.surface, "api search");
    assert.equal(cached.request.argv[0], "search");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recommend runs as an exec workflow, keeps affinity, and caches the call", () => {
  const { res, json, dir } = run();
  try {
    assert.equal(res.status, 0, res.stderr);
    assert.equal(json.recommend.count, 10);
    assert.equal(typeof json.recommend.first.affinity, "number");
    assert.match(json.recommend.first.id, /^urn:entity:movie:stub-/, "results arrive normalized to id/name/affinity");
    assert.equal(json.recommend.correlationId, "exec-stub-recommend", "the correlation id must come from the harness's own completed event");
    const cached = JSON.parse(readFileSync(resolve(dir, "recommend-TEST.json"), "utf8"));
    assert.equal(cached.harness.surface, "exec recommend");
    assert.equal(cached.input.target_type, "movie");
    assert.deepEqual(cached.input.signals, ["urn:entity:brand:q-elf"]);
    assert.equal(cached.response.results[0].affinity, cached.response.results[0].affinity);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a year of weekly points is paged inside the 20-point cap", () => {
  const { res, json, dir } = run();
  try {
    assert.equal(res.status, 0, res.stderr);
    assert.ok(json.series.calls >= 3, `expected >=3 paged calls, got ${json.series.calls}`);
    assert.ok(json.series.limits.every((n) => n <= 20), `limit cap violated: ${json.series.limits}`);
    assert.ok(json.series.entitiesPerCall.every((n) => n <= 5), `entity cap violated: ${json.series.entitiesPerCall}`);
    assert.ok(json.series.weeks.every((n) => n > 50), `expected >50 merged weeks, got ${json.series.weeks}`);
    const cached = JSON.parse(readFileSync(resolve(dir, "series-TEST.json"), "utf8"));
    assert.equal(cached.cadenceDays, 7);
    assert.equal(cached.calls.length, json.series.calls);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("more than five entities is refused before any call is made", () => {
  const { res, json, dir } = run();
  try {
    assert.equal(res.status, 0, res.stderr);
    assert.equal(json.batchError.code, "QLOO_BATCH");
    assert.equal(json.batch, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recommend takes a sector's ten signals and refuses an eleventh", () => {
  const { res, json, dir } = run();
  try {
    assert.equal(res.status, 0, res.stderr);
    assert.equal(json.signals.sent, 10);
    assert.equal(json.signals.count, 3);
    assert.equal(json.elevenError.code, "QLOO_BATCH");
    assert.equal(json.eleven, undefined);
    const cached = JSON.parse(readFileSync(resolve(dir, "recommend-ten.json"), "utf8"));
    assert.equal(cached.input.signals.length, 10);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a needs_input recommend falls back to api insights, not to an empty basket", () => {
  const { res, json, dir } = run({ STUB_MODE: "needsinput" });
  try {
    assert.equal(res.status, 0, res.stderr);
    assert.equal(json.recommendError, undefined, "the fallback must be inside qlooRecommend, not a thrown error");
    assert.equal(json.recommend.surface, "api insights");
    assert.equal(json.recommend.fallbackFrom, "QLOO_INPUT");
    assert.ok(json.recommend.count > 0, "a fallen-back call still has to return results");
    assert.equal(typeof json.recommend.first.affinity, "number", "insights carries affinity at query.affinity");
    const cached = JSON.parse(readFileSync(resolve(dir, "recommend-TEST.json"), "utf8"));
    assert.equal(cached.harness.surface, "api insights", "the cache names the surface that actually answered");
    assert.deepEqual(cached.request.signals, ["urn:entity:brand:q-elf"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an auth failure surfaces as QLOO_AUTH, not an empty result", () => {
  const { res, json, dir } = run({ STUB_MODE: "auth" });
  try {
    assert.equal(res.status, 0, res.stderr);
    assert.equal(json.seriesError.code, "QLOO_AUTH");
    assert.equal(json.seriesError.message.includes("Set QLOO_API_KEY"), true);
    assert.ok(!existsSync(resolve(dir, "series-TEST.json")), "a failed call must not cache a result");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
