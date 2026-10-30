// Step 4 (Series): weekly trending points for every basket member, plus each
// holding's own line for context.
//
// `exec trends` caps a call at 5 entities and 20 points, so this groups members
// by type in batches of five and lets the adapter page the date range. Nothing is
// written unless every batch succeeded: a half-filled series would silently
// shorten the window.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../src/env.mjs";
import { qlooSeries, readCache, seriesPlan, seriesPageName, TREND_HISTORY_FLOOR, QLOO_DIR } from "../src/qloo.mjs";
import { computeBudget, pageCount, REQUESTS_PER_ENTITY_PAGE } from "../src/budget.mjs";

const book = JSON.parse(readFileSync(resolve(ROOT, "config/book.json"), "utf8"));
const entities = readCache("entities.json");
if (!entities) { console.error("fixtures/qloo/entities.json missing — run qloo-map first."); process.exit(2); }
const pricesFile = resolve(ROOT, "fixtures/prices.json");
const prices = existsSync(pricesFile) ? JSON.parse(readFileSync(pricesFile, "utf8")) : null;
const alignedDates = prices?.window.alignedDates ?? null;
const priorDates = prices?.priorWindow?.alignedDates ?? null;

const shift = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
// One pull covers both windows: the request opens before the prior window so the
// same series explains the primary window and the disjoint replication slice.
const firstDate = priorDates?.[0] ?? alignedDates?.[0] ?? null;
const start = firstDate ? shift(firstDate, -7) : shift(today, -(book.weeks + (book.secondWindow?.weeks ?? 0) + 6) * 7);
const end = alignedDates ? shift(alignedDates.at(-1), 7) : today;

const weekMonday = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

const all = readCache("entities.json");
if (!all) { console.error("fixtures/qloo/entities.json missing — run qloo-map first."); process.exit(2); }
const sectors = [...new Set(all.filter((e) => e.entityId).map((e) => e.sector))];

const sectorBaskets = [];
for (const s of sectors) {
  const f = resolve(QLOO_DIR, `basket-sector-${s}.json`);
  if (!existsSync(f)) { console.error(`sector ${s}: basket-sector-${s}.json missing — run qloo-sector-basket first.`); process.exit(2); }
  sectorBaskets.push(JSON.parse(readFileSync(f, "utf8")));
}

const featured = all.filter((e) => e.featured && e.entityId);
const ownBaskets = [];
for (const h of featured) {
  const f = resolve(QLOO_DIR, `basket-${h.ticker}.json`);
  if (!existsSync(f)) { console.error(`${h.ticker}: basket-${h.ticker}.json missing — run qloo-basket first.`); process.exit(2); }
  ownBaskets.push(JSON.parse(readFileSync(f, "utf8")));
}

const targets = new Map(); // id -> { id, name, type }
for (const b of [...sectorBaskets, ...ownBaskets]) for (const m of b.members) if (!targets.has(m.id)) targets.set(m.id, { id: m.id, name: m.name, type: m.type });

const byType = new Map();
for (const t of targets.values()) {
  if (!byType.has(t.type)) byType.set(t.type, []);
  byType.get(t.type).push(t);
}

console.log(`Window requested: ${start} → ${end} · ${targets.size} basket entities across ${byType.size} types`);

// Tasks: every batch of five basket entities, plus one own-line per holding.
const tasks = [];
for (const [type, list] of byType) {
  for (let i = 0; i < list.length; i += 5) {
    tasks.push({ kind: "sector", type, chunk: list.slice(i, i + 5), index: Math.floor(i / 5), cacheName: `series-${type}-${Math.floor(i / 5)}.json` });
  }
}
for (const row of featured) {
  tasks.push({ kind: "own", type: "brand", chunk: [{ id: row.entityId, name: row.label, type: "brand" }], ticker: row.ticker, cacheName: `trending-${row.ticker}.json` });
}

// Cost gate. This step is the whole budget, so the number is decided here and
// nowhere else. The entity total is only known after the basket calls have
// returned, which is why the figure scripts/qloo-budget.mjs prints beforehand is
// a bound and this one is exact. Nothing is requested until the operator names
// the number back.
const cost = computeBudget({ basketEntities: targets.size + featured.length });
if (cost.window && (cost.window.start !== start || cost.window.end !== end)) {
  console.error(`Window disagreement with src/budget.mjs (${cost.window.start}→${cost.window.end} vs ${start}→${end}) — not costing a run this script would not perform.`);
  process.exit(2);
}

// One unit all the way through: a page is one `exec trends` invocation over one
// batch of ≤5 entities, and an entity-page is REQUESTS_PER_ENTITY_PAGE billed
// requests, because the harness re-resolves each id before it asks for the trend
// (src/budget.mjs). seriesPlan is the most pages a batch could walk; the run
// itself stops at the first empty page, which is the endpoint's history floor,
// so the floor-bounded count is what the pull is expected to actually cost.
for (const t of tasks) t.pages = seriesPlan(t.chunk.map((c) => c.id), t.type, { start, end });

const pages = tasks.reduce((n, t) => n + t.pages.length, 0);
const entityPages = tasks.reduce((n, t) => n + t.pages.length * t.chunk.length, 0);
const cached = tasks.reduce((n, t) => n + t.pages.filter((p) => existsSync(resolve(QLOO_DIR, seriesPageName(p)))).length, 0);
const floor = TREND_HISTORY_FLOOR > start ? TREND_HISTORY_FLOOR : start;
const expectedPagesPerTask = pageCount(floor, end);

console.log(`Cost: ${pages} pages (${pages / tasks.length} per batch) = ${entityPages * REQUESTS_PER_ENTITY_PAGE} Qloo requests at worst, ${tasks.length} batches of ≤5 entities over ${cost.trends.windows} windows.`);
const expectedRequests = tasks.reduce((n, t) => n + Math.min(t.pages.length, expectedPagesPerTask) * t.chunk.length, 0) * REQUESTS_PER_ENTITY_PAGE;
console.log(`At the ${TREND_HISTORY_FLOOR} history floor verified on 2026-10-30 the walk is ${expectedPagesPerTask} pages: ~${expectedRequests} requests. ${cost.trends.restCalls} counts ${cost.trends.entities} entities at the same ${cost.trends.windows}-page bound${expectedRequests > cost.trends.restCalls ? ", above the published figure because a batch's five entity-pages each pay the id lookup" : ""}.`);
console.log(`Pages: ${cached} of ${pages} already cached — a re-run spends only what is missing.`);

if (process.env.QLOO_RUN !== "1") {
  console.log("Refusing to spend it: re-run with QLOO_RUN=1 once the number is accepted. Nothing was called, nothing was written.");
  process.exit(0);
}

// One harness invocation is a Node process plus a handful of fan-out requests, so
// the wall clock is dominated by startup, not by Qloo. A small pool of batches
// runs at once because the run is otherwise hours long; the harness retries 429
// against Retry-After up to three attempts, so the pool stays modest.
const CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.QLOO_CONCURRENCY ?? 3)));

const byId = {};
const calls = [];
let cadence = null;
let done = 0;

const runTask = async (t) => qlooSeries(t.chunk.map((c) => c.id), t.type, { start, end, cacheName: t.cacheName });

try {
  const queue = tasks.slice();
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const t = queue.shift();
      const res = await runTask(t);
      if (cadence === null && res.cadenceDays) cadence = res.cadenceDays;
      calls.push(...res.calls);
      let filled = 0;
      for (const c of t.chunk) {
        const points = res.byEntity.get(c.id) ?? [];
        if (points.length) filled++;
        if (t.kind === "own") {
          // own-series-* is the human-readable summary; trending-* keeps the request
          // record qlooSeries wrote, which is the provenance a contested point needs.
          writeFileSync(resolve(QLOO_DIR, `own-series-${t.ticker}.json`), JSON.stringify({ entityType: t.type, entity: c.id, window: { start, end }, cadenceDays: res.cadenceDays, weeks: points.length, points }, null, 1));
        } else {
          byId[c.id] = { type: t.type, name: c.name, weeks: points.length, first: points[0]?.date ?? null, last: points.at(-1)?.date ?? null, points };
        }
      }
      const replayed = res.calls.filter((c) => c.replayed).length;
      done++;
      console.log(`[${done}/${tasks.length}] ${t.kind === "own" ? `${t.ticker} own line` : `${t.type} batch ${t.index + 1}`}: ${filled}/${t.chunk.length} entities with points, ${res.calls.length} pages (${replayed} replayed)`);
    }
  });
  const settled = await Promise.allSettled(workers);
  const failed = settled.filter((s) => s.status === "rejected");
  if (failed.length) {
    const auth = failed.some((f) => f.reason?.code === "QLOO_AUTH");
    throw Object.assign(new Error(failed.map((f) => `${f.reason?.code ?? "ERROR"} — ${f.reason?.message}`).join("; ")), { code: auth ? "QLOO_AUTH" : "QLOO_RUN" });
  }
} catch (err) {
  console.error(`REFUSING TO WRITE: ${err.code ?? "ERROR"} — ${err.message}`);
  console.error("Pages already fetched are cached, so re-running spends only what is missing.");
  process.exit(err.code === "QLOO_AUTH" ? 2 : 3);
}

writeFileSync(resolve(QLOO_DIR, "series.json"), JSON.stringify({
  window: { start, end },
  cadenceDays: cadence,
  fetchedAt: new Date().toISOString(),
  calls: calls.length,
  byId,
}, null, 1));

console.log(`Saved fixtures/qloo/series.json (${Object.keys(byId).length} entities, ${calls.length} calls)`);

if (alignedDates) {
  const line = (name, b) => {
    const keys = new Set();
    for (const m of b.members) for (const p of byId[m.id]?.points ?? []) keys.add(weekMonday(p.date));
    const hit = alignedDates.filter((d) => keys.has(d)).length;
    const priorHit = priorDates ? priorDates.filter((d) => keys.has(d)).length : null;
    const flag = hit < book.minTrendingWeeks ? `  <-- below the ${book.minTrendingWeeks}-week floor` : "";
    console.log(`${name}: ${hit}/${alignedDates.length} aligned weeks${priorHit !== null ? `, ${priorHit}/${priorDates.length} in the prior window` : ""}${flag}`);
  };
  for (const b of sectorBaskets) line(`sector ${b.sector} (${b.namesPricedAgainstIt.length} names)`, b);
  for (const b of ownBaskets) line(`${b.ticker} audience basket`, b);
}
