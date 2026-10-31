// Server-side Qloo access. Every request goes through the event harness
// (`qloo exec` / `qloo api`), which is the only surface the hackathon supports.
// The key is read by the harness from QLOO_API_KEY in the inherited env and is
// never an argument, a URL or a file we write.
//
// Each call caches the request it made and the result it got, so every number on
// the desk traces to a cached file plus the exact operation that produced it.
// The harness also returns a correlation id; it is stored with the cache entry so
// a contested number can be pointed at one call.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { ROOT } from "./env.mjs";
import { execOperation, apiCall, harnessVersion, HarnessError } from "./harness.mjs";

export const QLOO_DIR = process.env.CULTURALBETA_QLOO_DIR
  ? resolve(process.env.CULTURALBETA_QLOO_DIR)
  : resolve(ROOT, "fixtures/qloo");

// Caps enforced by the harness before it ever calls Qloo. Exceeding either one
// fails validation instead of returning a clipped page, so they are load-bearing.
const SERIES_MAX_ENTITIES = 5; // trends.entities maxItems
const SERIES_MAX_POINTS = 20; // limit maximum
const SERIES_MAX_CALLS = 400; // refuse to half-fill a series rather than page forever

let versionOnce = null;
function version() {
  // The promise is memoised, not its result: three probes started together must
  // share one harness spawn instead of racing three of them.
  if (versionOnce === null) versionOnce = harnessVersion().catch(() => "unknown");
  return versionOnce;
}

function writeCache(name, payload) {
  if (!name) return;
  mkdirSync(QLOO_DIR, { recursive: true });
  writeFileSync(resolve(QLOO_DIR, name), JSON.stringify(payload, null, 1));
}

export function readCache(name) {
  const f = resolve(QLOO_DIR, name);
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, "utf8"));
}

function statusError(operation, env) {
  const status = String(env.status ?? "error").toLowerCase();
  const code = status === "needs_input" ? "QLOO_INPUT" : `QLOO_${status.toUpperCase()}`;
  const detail = env.warnings?.join("; ") ?? env.summary ?? "";
  return new HarnessError(code, `${operation} returned ${env.status}${detail ? `: ${detail}` : ""}`, { correlationId: env.execution?.correlation_id ?? null });
}

// `qloo api search --json` prints the raw result array, not an envelope. Verified
// against @qloo/qloo-harness 0.1.26: dist/router.js:3168 returns
// JSON.stringify(entities) for the json format and dist/router.js:3179 reads each
// entity's `entity_id`. The wrapped shapes are accepted too, because a shape the
// harness changes later should degrade to "unresolved", never to a crash after
// the search calls are already spent.
export function searchResults(json) {
  const list = Array.isArray(json) ? json
    : Array.isArray(json?.results) ? json.results
    : Array.isArray(json?.results?.entities) ? json.results.entities
    : Array.isArray(json?.entities) ? json.entities
    : [];
  return list
    .map((e) => ({
      id: e?.entity_id ?? e?.id ?? null,
      name: e?.name ?? null,
      // Live /search answers carry `types: ["urn:entity:brand"]`, not a scalar
      // `type`; verified against the hackathon endpoint on 2026-10-30.
      type: Array.isArray(e?.types) ? (e.types.find((t) => String(t).startsWith("urn:entity:")) ?? e.types[0] ?? null)
        : (e?.type ?? null),
    }))
    .filter((e) => e.id && e.name);
}

// What an audience wants next, through `qloo api insights`. Chosen over the
// `exec recommend` workflow after reading the harness: dist/resolution-provider.js
// re-resolves every entity input (a UUID costs one /entities call, anything else
// costs a /search), so ten signals cost eleven requests where this costs one, and
// a URN input would be searched as a brand name and come back not_found.
// dist/router.js:5223 puts --signal-entities straight into the request instead.
export async function qlooInsights(signals, targetType, { limit = 10, cacheName } = {}) {
  const list = (Array.isArray(signals) ? signals : [signals]).filter(Boolean);
  if (!list.length || list.length > RECOMMEND_MAX_SIGNALS) {
    throw new HarnessError("QLOO_BATCH", `insights accepts 1-${RECOMMEND_MAX_SIGNALS} signals, got ${list.length}`);
  }
  const args = ["insights", "--type", targetType, "--signal-entities", list.join(","), "--take", String(limit)];
  const json = await apiCall(args);
  writeCache(cacheName, {
    harness: { version: await version(), surface: "api insights" },
    request: { argv: args, signals: list, target_type: targetType, limit },
    fetchedAt: new Date().toISOString(),
    response: json,
  });
  return json;
}

// `api insights --json` prints a bare array of entities (dist/router.js:5262 reads
// response.results.entities and formatEntities stringifies the array). Affinity is
// not a top-level field on the live response: it sits at query.affinity, which is
// what the harness's own TSV formatter reads too.
export function insightResults(json) {
  const list = Array.isArray(json) ? json
    : Array.isArray(json?.results?.entities) ? json.results.entities
    : Array.isArray(json?.entities) ? json.entities
    : Array.isArray(json?.results) ? json.results
    : [];
  return list
    .map((e) => ({
      id: e?.entity_id ?? e?.id ?? null,
      name: e?.name ?? null,
      type: e?.subtype ?? (Array.isArray(e?.types) ? e.types[0] : e?.type) ?? null,
      affinity: typeof e?.affinity === "number" ? e.affinity : (typeof e?.query?.affinity === "number" ? e.query.affinity : null),
      popularity: typeof e?.popularity === "number" ? e.popularity : null,
    }))
    .filter((e) => e.id && e.name);
}

// Entity lookup through the harness's deterministic API surface. `type` is the
// search filter: consumer names are brands, but a casino reads as a place in
// Qloo's index and a brand-only search for it comes back empty.
export const searchArgv = (query, { take = 10, type = "brand" } = {}) =>
  ["search", "--query", query, "--type", type, "--take", String(take)];

export async function qlooSearch(query, { take = 10, cacheName, type = "brand" } = {}) {
  const args = searchArgv(query, { take, type });
  const json = await apiCall(args);
  writeCache(cacheName, { harness: { version: await version(), surface: "api search" }, request: { argv: args }, fetchedAt: new Date().toISOString(), response: json });
  return json;
}

// What an audience wants next. `exec recommend` reads `signals` — one entity for
// an audience-level basket, up to ten for a sub-sector basket — and returns the
// entities of `target_type` that share that taste, each with the affinity the
// ranking used. This is the basket's source: the book's own names are filtered
// out by the caller, never by Qloo.
const RECOMMEND_MAX_SIGNALS = 10;

export async function qlooRecommend(signals, targetType, { limit = 10, cacheName } = {}) {
  const list = Array.isArray(signals) ? signals.filter(Boolean) : [signals];
  if (!list.length || list.length > RECOMMEND_MAX_SIGNALS) {
    throw new HarnessError("QLOO_BATCH", `recommend accepts 1–${RECOMMEND_MAX_SIGNALS} signals, got ${list.length}`);
  }
  const input = { target_type: targetType, signals: list, limit };
  // The workflow first: it is the validated surface, it returns a correlation id,
  // and the live entity ids are bare UUIDs, which the harness resolves through
  // /entities rather than re-searching by name. If resolution ever refuses an id,
  // fall back to `api insights`, which passes ids straight into the request
  // (dist/router.js:5223) instead of resolving them.
  try {
    const env = await execOperation("recommend", input);
    if (env.status && env.status !== "ok") throw statusError("recommend", env);
    writeCache(cacheName, {
      harness: { version: await version(), surface: "exec recommend" },
      input,
      fetchedAt: new Date().toISOString(),
      correlationId: env.execution?.correlation_id ?? null,
      response: env,
    });
    return { ...env, results: insightResults(env) };
  } catch (err) {
    if (err.code !== "QLOO_INPUT" && err.code !== "QLOO_NEEDS_INPUT") throw err;
    const json = await qlooInsights(list, targetType, { limit, cacheName });
    return { status: "ok", surface: "api insights", fallbackFrom: err.code, results: insightResults(json) };
  }
}

function addDays(iso, n) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function inferStepDays(series) {
  // Dates repeat across entities in a batch, so dedupe before measuring gaps;
  // otherwise every cross-entity repeat reads as a zero-day step.
  const dates = [...new Set(series.flatMap((s) => (s.points ?? []).map((p) => p.date)).filter(Boolean))].sort();
  if (dates.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
  gaps.sort((a, b) => a - b);
  const median = gaps[gaps.length >> 1];
  return Number.isFinite(median) && median > 0 ? median : null;
}

// One request, one file, keyed by the request itself. The series pull is the
// whole budget of a keyed run — roughly eighteen hundred requests for a book this
// size — and the harness has no cursor, so a run that dies on request 1,600 would
// otherwise have to pay for all 1,600 again. A page already on disk is replayed
// instead of re-asked; `QLOO_REFRESH=1` ignores the page cache and re-pulls.
export const seriesPageName = (input) => `page-${createHash("sha1").update(JSON.stringify(input)).digest("hex").slice(0, 16)}.json`;

function readSeriesPage(input) {
  if (process.env.QLOO_REFRESH === "1") return null;
  const file = resolve(QLOO_DIR, seriesPageName(input));
  if (!existsSync(file)) return null;
  try {
    const cached = JSON.parse(readFileSync(file, "utf8"));
    return JSON.stringify(cached?.input) === JSON.stringify(input) && Array.isArray(cached?.series) ? cached : null;
  } catch {
    return null;
  }
}

// The page list a series pull would walk at the observed weekly cadence, with the
// same end-anchored window the pager uses. It is a bound for the cost report, not
// a transcript: the real run stops at the first empty page, which is where the
// endpoint's history floor is, so the bound is what a name with a long history
// costs and any shorter history costs less.
export function seriesPlan(entityIds, entityType, { start, end }) {
  const pages = [];
  let cursorEnd = end;
  while (cursorEnd >= start && pages.length < 60) {
    const from = daysBetween(start, cursorEnd) >= TREND_MIN_LOOKBACK_DAYS
      ? start
      : addDays(cursorEnd, -TREND_MIN_LOOKBACK_DAYS);
    pages.push({ entities: entityIds, entity_type: entityType, start_date: from, end_date: cursorEnd, limit: SERIES_MAX_POINTS });
    cursorEnd = addDays(cursorEnd, -(SERIES_MAX_POINTS - 1) * 7);
  }
  return pages;
}

// Weekly trend points for a batch of entities. The workflow has no cursor, and
// its point cap is 20 per call, so the range is walked in windows sized to the
// observed granularity. If the API turns out to return daily points, the window
// shrinks and the range is re-pageed rather than silently truncated.
// The live endpoint anchors its answer to `end_date` and returns the
// `limit` weekly points that END there, and it returns nothing at all for a
// window that opens less than TREND_MIN_LOOKBACK_DAYS before its end. Verified
// against hackathon.api.qloo.com on 2026-10-30: 112–154 day windows all came back
// empty while a 177-day window on the same end date returned 20 points, and
// identical requests repeat identically. So the history is walked by paging the
// END backwards from the oldest point the last page returned — the forward
// windows the parameter names suggest would buy nothing but empty pages.
const TREND_MIN_LOOKBACK_DAYS = 180;

// The oldest weekly point the hackathon endpoint has returned so far, observed
// 2026-10-30 across the first ten trend batches: 2022-07, about 216 consecutive
// weeks for the brands with the deepest history. An earlier reading of a 2025-04
// floor was my own probe's artefact — a window opened less than 180 days before
// its end is refused, and the walk's first pages were all such windows.
export const TREND_HISTORY_FLOOR = "2022-07-11";

export async function qlooSeries(entityIds, entityType, { start, end, cacheName } = {}) {
  if (!entityIds.length || entityIds.length > SERIES_MAX_ENTITIES) {
    throw new HarnessError("QLOO_BATCH", `trends accepts 1–${SERIES_MAX_ENTITIES} entities per call, got ${entityIds.length}`);
  }
  const byEntity = new Map(entityIds.map((id) => [id, []]));
  const calls = [];
  let step = null;

  const anchor = (to) => daysBetween(start, to) >= TREND_MIN_LOOKBACK_DAYS
    ? start
    : addDays(to, -TREND_MIN_LOOKBACK_DAYS);

  const pageAt = async (to) => {
    const from = anchor(to);
    const input = { entities: entityIds, entity_type: entityType, start_date: from, end_date: to, limit: SERIES_MAX_POINTS };
    const replay = readSeriesPage(input);
    if (replay) {
      calls.push({
        input,
        points: replay.series.reduce((n, s) => n + (s.points?.length ?? 0), 0),
        correlationId: replay.correlationId ?? null,
        provenance: replay.provenance ?? null,
        cacheName: seriesPageName(input),
        replayed: true,
      });
      return replay.series;
    }
    const env = await execOperation("trends", input);
    if (env.status && env.status !== "ok") throw statusError("trends", env);
    const series = env.series ?? [];
    calls.push({
      input,
      points: series.reduce((n, s) => n + (s.points?.length ?? 0), 0),
      correlationId: env.execution?.correlation_id ?? null,
      provenance: env.provenance ?? null,
      cacheName: seriesPageName(input),
    });
    writeCache(seriesPageName(input), {
      harness: { version: await version(), surface: "exec trends" },
      input,
      to,
      series,
      correlationId: env.execution?.correlation_id ?? null,
      provenance: env.provenance ?? null,
      fetchedAt: new Date().toISOString(),
    });
    return series;
  };

  const absorb = (series) => {
    for (const s of series) {
      const id = s.entity?.entityId ?? s.entity?.id;
      if (id && byEntity.has(id)) byEntity.get(id).push(...(s.points ?? []));
    }
  };

  let cursorEnd = end;
  while (cursorEnd >= start) {
    if (calls.length >= SERIES_MAX_CALLS) {
      throw new HarnessError("QLOO_PAGING", `series for ${entityIds.join(",")} needs more than ${SERIES_MAX_CALLS} pages — refusing to return a partial series`);
    }
    const series = await pageAt(cursorEnd);
    absorb(series);
    if (step === null) step = inferStepDays(series);
    const dates = series.flatMap((s) => (s.points ?? []).map((p) => p.date)).filter(Boolean).sort();
    // An empty page is the floor of the endpoint's history, not a gap to hop over.
    if (!dates.length) break;
    if (dates[0] <= start) break;
    cursorEnd = addDays(dates[0], -1);
  }

  for (const [id, points] of byEntity) {
    const seen = new Set();
    const merged = points
      .filter((p) => p?.date && !seen.has(p.date) && seen.add(p.date))
      .sort((a, b) => a.date.localeCompare(b.date));
    byEntity.set(id, merged);
  }

  writeCache(cacheName, {
    harness: { version: await version(), surface: "exec trends" },
    entityType,
    entities: entityIds,
    window: { start, end },
    cadenceDays: step,
    calls,
  });
  return { byEntity, calls, cadenceDays: step };
}

// Exactly one trend page, returned in the shape a series pull produces. The
// endpoint anchors to `end_date` and answers with the `limit` weekly points that
// END there, so a single call is already the newest window — and, unlike qlooSeries,
// this does not walk the history backwards once the first page is in hand. The
// freshness attestation needs the newest weeks and nothing else, so it uses this:
// one request per panel revision, never a paging run.
export async function qlooTrendPage(entityIds, entityType, { start, end, cacheName } = {}) {
  if (!entityIds.length || entityIds.length > SERIES_MAX_ENTITIES) {
    throw new HarnessError("QLOO_BATCH", `trends accepts 1–${SERIES_MAX_ENTITIES} entities per call, got ${entityIds.length}`);
  }
  const input = { entities: entityIds, entity_type: entityType, start_date: start, end_date: end, limit: SERIES_MAX_POINTS };
  const byEntity = new Map(entityIds.map((id) => [id, []]));
  const calls = [];

  const replay = readSeriesPage(input);
  let series;
  if (replay) {
    series = replay.series;
    calls.push({
      input,
      points: series.reduce((n, s) => n + (s.points?.length ?? 0), 0),
      correlationId: replay.correlationId ?? null,
      provenance: replay.provenance ?? null,
      cacheName: seriesPageName(input),
      replayed: true,
    });
  } else {
    const env = await execOperation("trends", input);
    if (env.status && env.status !== "ok") throw statusError("trends", env);
    series = env.series ?? [];
    calls.push({
      input,
      points: series.reduce((n, s) => n + (s.points?.length ?? 0), 0),
      correlationId: env.execution?.correlation_id ?? null,
      provenance: env.provenance ?? null,
      cacheName: seriesPageName(input),
    });
    writeCache(seriesPageName(input), {
      harness: { version: await version(), surface: "exec trends" },
      input,
      to: end,
      series,
      correlationId: env.execution?.correlation_id ?? null,
      provenance: env.provenance ?? null,
      fetchedAt: new Date().toISOString(),
    });
  }

  for (const s of series) {
    const id = s.entity?.entityId ?? s.entity?.id;
    if (id && byEntity.has(id)) byEntity.get(id).push(...(s.points ?? []));
  }
  for (const [id, points] of byEntity) {
    const seen = new Set();
    byEntity.set(id, points.filter((p) => p?.date && !seen.has(p.date) && seen.add(p.date))
      .sort((a, b) => a.date.localeCompare(b.date)));
  }
  // A replayed page already has its record on disk; rewriting it would only cost a
  // harness spawn, which is the difference between an instant attestation and one
  // that races the answer's own timeout.
  if (cacheName && !replay) {
    writeCache(cacheName, {
      harness: { version: await version(), surface: "exec trends" },
      entityType,
      entities: entityIds,
      window: { start, end },
      cadenceDays: null,
      calls,
    });
  }
  return { byEntity, calls };
}
