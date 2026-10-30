// The run-cost number is a claim on the page, so it is computed and tested rather
// than typed. These tests read config and a temp cache directory; no request is made.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { computeBudget, spentFromCache, pageCount, MAX_POINTS_PER_CALL, REQUESTS_PER_ENTITY_PAGE } from "../src/budget.mjs";

test("the planned budget is the sum of its lines and puts the cost where the cost is", () => {
  const b = computeBudget();
  assert.equal(b.total, b.lines.reduce((acc, l) => acc + l.calls, 0));
  assert.equal(b.lines.length, 3);
  assert.ok(b.trends.restCalls > b.lines[0].calls + b.lines[1].calls, "trend points dominate, as the page says they do");
  assert.equal(b.controlCost, 0, "the peer-basket arm is free and says so");
});

test("the trend line is windows of the 20-point cap, not a hand-wave", () => {
  const b = computeBudget();
  assert.ok(b.trends.windows >= 6, `a 106-week window cannot fit in fewer than 6 pages, got ${b.trends.windows}`);
  assert.equal(b.trends.restCalls, b.trends.entities * b.trends.windows * REQUESTS_PER_ENTITY_PAGE);
  assert.equal(b.window.weeks, Math.round((Date.parse(`${b.window.end}T00:00:00Z`) - Date.parse(`${b.window.start}T00:00:00Z`)) / 604800000));
  assert.ok(b.window.weeks >= 200, `both pre-registered windows must be inside the pull, got ${b.window.weeks} weeks`);
  assert.ok(b.trends.windows * MAX_POINTS_PER_CALL >= b.window.weeks, "the pages cover the span they claim to");
});

// The live endpoint answers with the twenty points that END at end_date and
// returns nothing for a window shorter than its lookback, so a page plan built on
// forward windows would price a run that buys only empty pages.
test("a page is one block of points ending at its own end_date", () => {
  // A page answers with the 20 weekly points that END at its end_date, so a 55-week
  // span is three pages of 19 weeks. Forward 133-day windows would have priced the
  // same span as three pages too — and bought nothing, because the endpoint
  // refuses a window that opens less than ~180 days before its end.
  assert.equal(pageCount("2025-10-06", "2026-10-25"), 3);
  assert.equal(pageCount("2022-10-03", "2026-11-02"), 12);
  assert.equal(pageCount("2026-10-25", "2026-10-25"), 1, "a single day still costs the page that answers it");
});

test("naming the real entity count turns the bound into a number", () => {
  const bound = computeBudget();
  assert.equal(bound.trends.exact, false);
  const real = computeBudget({ basketEntities: 12 });
  assert.equal(real.trends.exact, true);
  assert.ok(real.trends.entities < bound.trends.entities);
  assert.equal(real.trends.restCalls, 12 * bound.trends.windows * REQUESTS_PER_ENTITY_PAGE);
  assert.ok(real.total < bound.total);
});

test("the spent count reads the cache the run actually left behind", () => {
  const dir = resolve(tmpdir(), `cb-budget-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(resolve(dir, "search-NKE.json"), "{}");
    writeFileSync(resolve(dir, "search-ELF-alt.json"), "{}");
    writeFileSync(resolve(dir, "recommend-sector-beauty-movie.json"), "{}");
    // One page file is one request; the merged batch summary repeats the same
    // pages and must not be counted a second time.
    writeFileSync(resolve(dir, "page-aaa.json"), JSON.stringify({ input: { entities: ["a", "b", "c"] } }));
    writeFileSync(resolve(dir, "page-bbb.json"), JSON.stringify({ input: { entities: ["d"] } }));
    writeFileSync(resolve(dir, "series-brand-0.json"), JSON.stringify({
      calls: [{ input: { entities: ["a", "b", "c"] } }, { input: { entities: ["d"] } }],
    }));
    // The merged output file is not a call record and must not be read as one.
    writeFileSync(resolve(dir, "series.json"), JSON.stringify({ calls: 99 }));
    const spent = spentFromCache(dir);
    // Each entity-page is two Qloo requests: the trend itself plus the id lookup
    // the harness pays before it.
    assert.deepEqual(spent, { search: 2, baskets: 1, trends: 8, trendCalls: 2, total: 11 });
    assert.equal(spentFromCache(resolve(dir, "nope")), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
