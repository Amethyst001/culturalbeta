// The Qloo cost of a run, derived from the same paging arithmetic src/qloo.mjs
// actually spends. One implementation, three consumers: the CLI that prints it
// before the budget is committed, the desk that shows it as a number, and the
// series step that refuses to run until the operator accepts it.
//
// This counts requests; it never makes one.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./env.mjs";

export const MAX_ENTITIES_PER_CALL = 5; // trends.entities maxItems
export const MAX_POINTS_PER_CALL = 20; // limit maximum
export const WINDOW_DAYS = (MAX_POINTS_PER_CALL - 1) * 7; // 133 days = 20 weekly points
// One `exec trends` page costs two Qloo requests per entity, not one: the
// harness re-resolves every entity id through /entities (verified against
// @qloo/qloo-harness 0.1.26, dist/resolution-provider.js:311, one call per input
// and an in-memory cache that cannot survive between CLI invocations) before it
// asks /v2/trending for the same entity.
export const REQUESTS_PER_ENTITY_PAGE = 2;
// Wall clock measured live on 2026-10-30: about 8 s per `exec` invocation, which
// is mostly Node startup, and the fan-out inside one invocation is already a
// Promise.all. scripts/qloo-series.mjs runs this many invocations at once.
export const EXEC_SECONDS = 8;
export const DEFAULT_CONCURRENCY = 3;

const shift = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

// Pages counted the way the pager walks them: each request answers with the
// twenty weekly points that END at its end_date, so the walk steps the end back
// by one page of points until it reaches the start of the window.
export function pageCount(from, to) {
  let cursor = to;
  let n = 0;
  while (cursor >= from && n < 500) {
    cursor = shift(cursor, -WINDOW_DAYS);
    n++;
  }
  return n;
}

// `entities` overrides the worst-case member count once the baskets have returned:
// { basketEntities: n } makes the trends line exact instead of an upper bound.
export function computeBudget({ basketEntities = null } = {}) {
  const book = JSON.parse(readFileSync(resolve(ROOT, "config/book.json"), "utf8"));
  const universe = JSON.parse(readFileSync(resolve(ROOT, "config/universe.json"), "utf8"));
  const pricesFile = resolve(ROOT, "fixtures/prices.json");
  const prices = existsSync(pricesFile) ? JSON.parse(readFileSync(pricesFile, "utf8")) : null;

  const names = universe.sectors.flatMap((s) => s.names);
  const featured = names.filter((n) => n.featured);
  const altQueries = names.reduce((acc, n) => acc + (n.altQueries?.length ?? 0), 0);
  const types = book.basket.types.length;

  // One pull spans both windows: it opens a week before the pre-registered second
  // window and closes a week after the primary one, as scripts/qloo-series.mjs does.
  const primary = prices?.window?.alignedDates ?? null;
  const prior = prices?.priorWindow?.alignedDates ?? null;
  const start = primary ? shift(prior?.[0] ?? primary[0], -7) : null;
  const end = primary ? shift(primary.at(-1), 7) : null;
  const windows = start ? pageCount(start, end) : null;

  const membersWorstCase =
    (universe.sectors.length + featured.length) * types * book.basket.perType;
  const seriesEntities = basketEntities ?? membersWorstCase + featured.length;
  // Batches are grouped by entity type, so the fewest collisions is the worst case:
  // an even spread across the basket's creative types, each group rounded up to five.
  const worstBatches = Math.ceil(seriesEntities / types / MAX_ENTITIES_PER_CALL) * types;

  const trends = windows === null ? null : {
    entities: seriesEntities,
    exact: basketEntities !== null,
    windows,
    windowStart: start,
    windowEnd: end,
    // `exec trends` fans out one request per entity per window, and the harness
    // pays a second request per entity per window to re-resolve the id; the
    // workflow invocations are the entities grouped into batches of five.
    workflowCalls: worstBatches * windows,
    restCalls: seriesEntities * windows * REQUESTS_PER_ENTITY_PAGE,
  };

  const lines = [
    { key: "search", label: "Entity mapping", calls: names.length + altQueries,
      note: `${names.length} lookups, one per listed name, plus ${altQueries} alternates kept ready for names whose first answer comes back under a longer company name.` },
    { key: "insights", label: "Taste baskets", calls: (universe.sectors.length + featured.length) * types,
      note: `one request per sub-sector and creative type (${universe.sectors.length} × ${types}), plus one per featured audience (${featured.length} × ${types}) — a basket costs one call, not one per name.` },
    { key: "trends", label: "Weekly trend points", calls: trends ? trends.restCalls : null,
      note: trends ? `${trends.entities}${trends.exact ? "" : " (upper bound)"} basket entities × ${trends.windows} pages of ${MAX_POINTS_PER_CALL} weeks from ${trends.windowStart} to ${trends.windowEnd}, ×${REQUESTS_PER_ENTITY_PAGE} requests an entity-page (the trend itself plus the id lookup the harness pays for it) — this is where the budget goes.` : "price window not fetched yet." },
  ];

  const total = lines.reduce((acc, l) => acc + (l.calls ?? 0), 0);
  return {
    generatedFrom: { universeNames: names.length, sectors: universe.sectors.length, featured: featured.length, creativeTypes: types, perType: book.basket.perType },
    window: start ? { start, end, weeks: Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 604800000) } : null,
    lines,
    trends,
    total,
    // Measured live: ~8 s per `exec` invocation, most of it Node startup, with
    // DEFAULT_CONCURRENCY invocations in flight — see scripts/qloo-series.mjs.
    estimatedMinutes: Math.round((trends ? trends.workflowCalls : 0) * EXEC_SECONDS / DEFAULT_CONCURRENCY / 60),
    controlCost: 0,
  };
}

// What a finished run actually spent, counted off the cached responses rather than
// the plan. `exec trends` bills one request per entity per window, so the trend
// total is summed from each cached call's own entity list.
export function spentFromCache(qlooDir) {
  if (!qlooDir || !existsSync(qlooDir)) return null;
  let files;
  try { files = readdirSync(qlooDir); } catch { return null; }
  const read = (f) => { try { return JSON.parse(readFileSync(resolve(qlooDir, f), "utf8")); } catch { return null; } };
  const search = files.filter((f) => /^search-.+\.json$/.test(f)).length;
  const baskets = files.filter((f) => /^recommend-.+\.json$/.test(f)).length;
  // The unit of the trend pull is one cached page = one request over up to five
  // entities; the merged `series-*` files are summaries of those same pages, so
  // counting the pages is what avoids double-counting a spend. Each entity-page
  // is REQUESTS_PER_ENTITY_PAGE requests, because the harness resolves the id
  // before it asks for the trend.
  let trends = 0;
  let trendCalls = 0;
  for (const f of files) {
    if (!/^page-.+\.json$/.test(f)) continue;
    const page = read(f);
    trends += (page?.input?.entities?.length ?? 0) * REQUESTS_PER_ENTITY_PAGE;
    trendCalls++;
  }
  if (!search && !baskets && !trends) return null;
  return { search, baskets, trends, trendCalls, total: search + baskets + trends };
}

