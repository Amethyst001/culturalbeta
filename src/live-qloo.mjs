// Live Qloo tools for the analyst agent. This is the only place a question can
// make the desk spend a Qloo request, so every path is bounded: one live tool per
// answer, a page cap per invocation, and a persisted daily budget that is reserved
// before the first request and refunded down to what was actually spent.
//
// Two tools, because the two defensible live questions are different:
//   live_brand_trends   resolve a brand Qloo may not know, pull its recent weekly
//                       percentile path, and say what moved. Works for any name.
//   live_cultural_beta  re-pull a book name's sector basket and re-run the desk's
//                       own estimator at inference, then print the live number
//                       beside the committed one.
//
// Nothing here fabricates a Qloo response. If the key is absent, the endpoint
// refuses, or the budget is gone, the tool returns an error object and the model
// is instructed to say live Qloo is unavailable.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./env.mjs";
import { qlooSearch, qlooSeries, qlooTrendPage, readCache, searchResults, seriesPlan } from "./qloo.mjs";
import { blendBasket, tasteSeries } from "./factor.mjs";
import { ols } from "./ols.mjs";

const OUTPUT = process.env.CULTURALBETA_OUTPUT_DIR ? resolve(process.env.CULTURALBETA_OUTPUT_DIR) : resolve(ROOT, "output");
const BUDGET_FILE = resolve(OUTPUT, "live-qloo-budget.json");

export const LIVE = {
  callsPerAnswer: 1,
  maxTrendPages: 96,
  dailyRequests: Number(process.env.AGENT_LIVE_DAILY_CAP || 120),
  brandLookbackDays: 91,
  maxNameChars: 80,
};

const shiftDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const num = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));

let bookOnce = null;
function book() {
  if (!bookOnce) bookOnce = JSON.parse(readFileSync(resolve(ROOT, "config/book.json"), "utf8"));
  return bookOnce;
}

// Windows cmd.exe expands %VAR% and treats " as a quote boundary even inside the
// harness's own quoting, so a resolved brand name may not contain either. The rest
// of the list is refused for the same reason: it is user text on its way to a
// command line that the harness hands to a shell on win32.
const UNSAFE = /["%^!<>|`\r\n]/;

export function validateBrandName(raw) {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { error: "empty brand name" };
  if (name.length > LIVE.maxNameChars) return { error: `brand name longer than ${LIVE.maxNameChars} characters` };
  if (UNSAFE.test(name)) return { error: "brand name contains characters the request layer refuses" };
  if (!/[\p{L}\p{N}]/u.test(name)) return { error: "brand name has no letters or digits" };
  return { name };
}

export function validateTicker(raw) {
  const ticker = String(raw ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) return { error: "not a ticker" };
  return { ticker };
}

const normal = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Search returns candidates in Qloo's order, which is not always the brand asked
// for. An exact normalised match wins, then a prefix, then the first candidate —
// and every candidate is returned so the model can see what the index offered.
export function pickEntity(results, query) {
  const q = normal(query);
  if (!results?.length) return null;
  const exact = results.find((r) => normal(r.name) === q);
  if (exact) return exact;
  const prefix = results.find((r) => normal(r.name).startsWith(q) || q.startsWith(normal(r.name)));
  return prefix ?? results[0];
}

export function liveStatus(env = process.env) {
  const enabled = String(env.AGENT_LIVE_QLOO ?? "") === "1";
  const keyed = Boolean(String(env.QLOO_API_KEY ?? "").trim());
  const why = !enabled ? "AGENT_LIVE_QLOO is not 1 on this deployment"
    : !keyed ? "QLOO_API_KEY is not set for the server process"
    : null;
  return {
    enabled: enabled && keyed,
    why,
    tools: enabled && keyed ? ["live_brand_trends", "live_cultural_beta"] : [],
    limits: { callsPerAnswer: LIVE.callsPerAnswer, maxTrendPages: LIVE.maxTrendPages, dailyRequests: LIVE.dailyRequests },
    note: enabled && keyed
      ? "A question may spend one bounded live Qloo read; everything else it answers comes from the committed panel."
      : "The analyst answers from the committed panel only and cannot spend a Qloo request.",
  };
}

/* ---------- daily budget ---------- */

export function readBudget(file = BUDGET_FILE) {
  const fresh = { date: today(), requests: 0, ops: 0 };
  if (!existsSync(file)) return fresh;
  try {
    const b = JSON.parse(readFileSync(file, "utf8"));
    return b?.date === fresh.date ? { date: b.date, requests: Number(b.requests) || 0, ops: Number(b.ops) || 0 } : fresh;
  } catch {
    return fresh;
  }
}

function writeBudget(b, file = BUDGET_FILE) {
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(b, null, 1));
}

// One process owns the file, so a promise chain is enough to stop two answers
// from reading the same count and both deciding they fit.
let chain = Promise.resolve();
function serial(fn) {
  const p = chain.then(fn, fn);
  chain = p.then(() => undefined, () => undefined);
  return p;
}

export function reserve(n, { file = BUDGET_FILE, cap = LIVE.dailyRequests } = {}) {
  return serial(() => {
    const b = readBudget(file);
    if (b.requests + n > cap) return { ok: false, ...b, cap };
    const next = { ...b, requests: b.requests + n };
    writeBudget(next, file);
    return { ok: true, ...next, cap };
  });
}

export function settle({ reserved, spent, ops = 0 }, { file = BUDGET_FILE } = {}) {
  return serial(() => {
    const b = readBudget(file);
    const next = { ...b, requests: Math.max(0, b.requests - reserved + Math.max(0, spent)), ops: b.ops + ops };
    writeBudget(next, file);
    return next;
  });
}

/* ---------- mandatory live freshness attestation ---------- */

// An external review's objection was that one optional live read does not make
// Qloo load-bearing: the model can decline to call a tool, so a claim that the
// panel is current would rest on the committed files alone. This check is
// therefore not a tool — /api/ask runs it itself on every answer and prints what
// it gets, whether or not the model asked. It is one bounded trend page for one
// committed basket entity, drawn from the same daily budget as the live tools and
// cached for the whole book, so five answers in a row spend one request.
//
// It answers one question and nothing else: does Qloo report a percentile change
// newer than the panel's own last revision? The expected honest answer at this
// vintage is "no", and it is printed as a passing attestation, not a failure.
export const FRESHNESS = {
  cacheMinutes: 15,
  failureCacheSeconds: 60,
  maxRequests: 2,
  // Up to three entities per attestation: the names the question cites, else one
  // per sub-sector, so the panel-level claim does not rest on a single basket.
  maxEntities: 3,
  // Grid weeks the probe will step back through looking for points, bounded by the
  // two requests the reservation covers.
  maxAttempts: 2,
  // The window the probe opens, measured back from the newest grid week. It is
  // deep because of how the endpoint answers, not because twenty weeks of history
  // is needed: verified 2026-10-30 on the reference entity, a 180-day window
  // ending 2026-11-02 came back with no points at all while a 527-day window on
  // the same end date returned the twenty weekly points from 2026-06-22 to
  // 2026-11-02. Whichever window it accepts, the endpoint returns the newest
  // twenty weeks and no more, so the page costs one request either way.
  lookbackDays: 527,
  referenceTicker: "DIS",
  timeoutMs: 45000,
  // The trend endpoint answers on a weekly grid and returns nothing for an end_date
  // between the grid points (verified 2026-10-30: end_date 2026-10-30 came back
  // empty, end_date 2026-11-02 — the next grid week — came back with 20 points, the
  // newest of which carried the same percentile forward). So the probe asks for the
  // next grid week after today: the newest week Qloo could possibly have published,
  // which is exactly the week a stale panel would be missing.
  weekGridDay: 1,
};

const iso = (ms) => new Date(ms).toISOString();

// The weekly grid the trend endpoint answers on (Mondays, observed across every
// committed page in fixtures/qloo): the next grid date on or after `day`.
export function nextTrendWeek(day, gridDay = FRESHNESS.weekGridDay) {
  const d = new Date(`${String(day).slice(0, 10)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + (gridDay - d.getUTCDay() + 7) % 7);
  return d.toISOString().slice(0, 10);
}

// Why the check did not run, as a machine code the UI maps to prose. Never a date.
export function freshnessGateReason(env = process.env) {
  if (String(env.AGENT_LIVE_QLOO ?? "") !== "1") return "live_gate_off";
  if (!String(env.QLOO_API_KEY ?? "").trim()) return "qloo_key_missing";
  return null;
}

// Every attested entity is read out of the panel, never invented: a weighted member
// of that row's own basket, whose id and creative type Qloo returned and whose
// weekly levels the desk already priced against. Brands are preferred because they
// carry the deepest history in the trend endpoint.
export function basketEntity(row) {
  const usable = (row?.basket ?? []).filter((m) => m.id && m.type);
  if (!usable.length) return null;
  const w = (m) => (Number.isFinite(m.weight) ? m.weight : 0);
  const member = [...usable].sort((a, b) => (a.type === "brand" ? 0 : 1) - (b.type === "brand" ? 0 : 1) || w(b) - w(a))[0];
  return { ticker: row.ticker, sector: row.sector ?? null, id: member.id, name: member.name, type: member.type, weight: num(w(member), 4) };
}

export function referenceEntity(desk) {
  const rows = desk?.rows ?? [];
  const named = rows.find((r) => String(r.ticker).toUpperCase() === FRESHNESS.referenceTicker && basketEntity(r));
  return basketEntity(named ?? rows.find((r) => basketEntity(r))) ?? null;
}

// A ticker named in the question, so the attestation can be asked about the name the
// answer is about instead of a fixed basket member. Only whole-word tickers and full
// labels count: a substring match would attest the wrong company on a stray "ELF".
export function tickersInQuestion(question, desk) {
  const text = String(question ?? "");
  if (!text) return [];
  const out = [];
  for (const row of desk?.rows ?? []) {
    const ticker = String(row.ticker ?? "").toUpperCase();
    const label = String(row.label ?? "");
    const byTicker = ticker.length >= 2 && new RegExp(`(^|[^A-Za-z0-9])${ticker}([^A-Za-z0-9]|$)`).test(text);
    const byLabel = label.length >= 4 && new RegExp(`(^|[^A-Za-z0-9])${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`, "i").test(text);
    if ((byTicker || byLabel) && !out.includes(ticker)) out.push(ticker);
  }
  return out.slice(0, FRESHNESS.maxEntities);
}

// Up to three attested entities per answer. When the question names names, those
// rows are attested; otherwise one row per sub-sector, so the panel-level claim
// rests on three baskets rather than one. The order is deterministic: rows in the
// order the panel lists them, so two runs attest the same three names.
export function entitiesFor(desk, tickers = []) {
  const rows = desk?.rows ?? [];
  const picked = [];
  const take = (row) => {
    const e = basketEntity(row);
    if (!e || picked.some((p) => p.id === e.id)) return false;
    picked.push(e);
    return true;
  };
  for (const t of tickers) {
    const row = rows.find((r) => String(r.ticker).toUpperCase() === String(t).toUpperCase());
    if (row && picked.length < FRESHNESS.maxEntities) take(row);
  }
  if (picked.length) return picked;
  // The reference row always leads, so a desk with no sector labels still attests
  // the same name it always did; the rest are one row per sector it does not repeat.
  const ref = referenceEntity(desk);
  const refRow = ref ? rows.find((r) => String(r.ticker).toUpperCase() === String(ref.ticker).toUpperCase()) : null;
  if (refRow) take(refRow);
  const sectors = [...new Set(rows.map((r) => r.sector ?? "unknown"))];
  for (const sector of sectors) {
    if (picked.length >= FRESHNESS.maxEntities) break;
    if (picked.some((p) => (p.sector ?? "unknown") === sector)) continue;
    for (const row of rows.filter((r) => (r.sector ?? "unknown") === sector)) if (take(row)) break;
  }
  return picked;
}

// The desk's own carry-forward reading: a week is a revision when the value differs
// from the previous week Qloo reported for that entity. tasteSeries is the same
// rule the estimator uses, so the attestation cannot drift from the panel's.
export function qlooFreshnessReading({ points, panelLastRevision = null, panelWindowEnd = null, cfg = book().tasteSignal }) {
  const moves = [...tasteSeries({ points }, cfg)];
  const revisions = moves.filter(([, r]) => Number.isFinite(r) && Math.abs(r) > 0).sort((a, b) => a[0].localeCompare(b[0]));
  const weeks = [...new Set((points ?? []).map((p) => p?.date).filter(Boolean))].sort();
  const latestWeek = weeks.at(-1) ?? null;
  const latestRevision = revisions.at(-1)?.[0] ?? null;
  const newerRevision = Boolean(latestRevision && panelLastRevision && latestRevision > panelLastRevision);
  const beyondWindow = Boolean(latestWeek && panelWindowEnd && latestWeek > panelWindowEnd);
  return {
    weeksPulled: weeks.length,
    range: weeks.length ? { first: weeks[0], last: weeks.at(-1) } : null,
    latestWeek,
    latestRevision,
    revisionCount: revisions.length,
    newerThanPanel: newerRevision,
    reportsWeeksBeyondPanel: beyondWindow,
    verdict: newerRevision ? "qloo_has_a_newer_revision" : beyondWindow ? "newer_weeks_no_change" : "nothing_newer_than_panel_tail",
  };
}

function freshnessSentence(ref, reading, panel, when) {
  const tail = `the panel tail (last revision ${panel.lastRevision ?? "—"}, window end ${panel.windowEnd ?? "—"})`;
  if (reading.verdict === "qloo_has_a_newer_revision") {
    return `Qloo was asked ${when} about ${ref.name} (${ref.type}), an entity in the ${ref.ticker} basket: its percentile changed again on ${reading.latestRevision}, which is newer than the panel's last revision ${panel.lastRevision}. The held-out slice frozen at that date is stale against this.`;
  }
  if (reading.verdict === "newer_weeks_no_change") {
    return `Qloo was asked ${when} about ${ref.name} (${ref.type}), an entity in the ${ref.ticker} basket: it now reports weeks through ${reading.latestWeek}, past the panel window end ${panel.windowEnd}, but no value differs from the week before it in the ${reading.weeksPulled} pulled. Newer weeks, no newer signal.`;
  }
  return `Qloo was asked ${when} about ${ref.name} (${ref.type}), an entity in the ${ref.ticker} basket: its newest weekly point is ${reading.latestWeek ?? "absent"} and ${reading.latestRevision ? `the last week its percentile moved is ${reading.latestRevision}` : `no percentile moved in the ${reading.weeksPulled} weeks pulled`} — nothing newer than ${tail}.`;
}

// One page per entity: this attests that the feed is still frozen for the names the
// answer is about — the names it cited when it cited any, otherwise one per
// sub-sector — and never claims a date it did not receive.
function freshnessScope(entities) {
  const n = entities?.length ?? 0;
  const sectors = new Set((entities ?? []).map((e) => e.entity?.sector).filter(Boolean)).size;
  if (n > 1) {
    return `${n} entities${sectors ? ` across ${sectors} sub-sectors` : ""}, one trend page each — the names the question cited when it cited any, otherwise one per sub-sector. Not a re-pull of the book's baskets. A "nothing newer" reading is the expected state at this vintage and is printed as a passing attestation.`;
  }
  return "One reference entity and one trend page, not a re-pull of the book's baskets. A \"nothing newer\" reading is the expected state at this vintage and is printed as a passing attestation.";
}

function pointsFor(byEntity, id) {
  if (!byEntity) return [];
  return byEntity instanceof Map ? byEntity.get(id) ?? [] : byEntity[id] ?? [];
}

function withTimeout(promise, ms, code) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), ms);
  });
  timer.unref?.();
  // The harness child keeps running past a timeout, so its request may still land
  // at Qloo after the answer has been served without it: the budget is refunded to
  // zero spent because this process cannot confirm what the orphaned call cost.
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

async function probeEntity(ref, { gridEnd, requestedAt, seriesFn, panel, clock }) {
  // The newest grid week first; if it answers with no points at all, one step back
  // to the week before it. Two attempts per entity, because that is what is reserved.
  let attempts = [];
  let spent = 0;
  let ops = 0;
  let points = [];
  let failed = null;
  for (let i = 0; i < FRESHNESS.maxAttempts; i++) {
    const end = shiftDays(gridEnd, -7 * i);
    const start = shiftDays(end, -FRESHNESS.lookbackDays);
    const cacheName = `fresh-${ref.id}-${end}.json`;
    let one;
    try {
      one = await withTimeout(seriesFn([ref.id], ref.type, { start, end, cacheName }), FRESHNESS.timeoutMs, "freshness_timeout");
    } catch (e) {
      // The attempt that threw is refunded to zero spent: its harness child may
      // still land at Qloo after this answer is served, and this process cannot
      // confirm what the orphaned call cost.
      failed = e;
      break;
    }
    const calls = one.calls ?? [];
    spent += calls.filter((c) => !c.replayed).length;
    ops += calls.length;
    attempts.push({ end, start, cacheName, calls });
    points = pointsFor(one.byEntity, ref.id);
    if (points.length) break;
  }
  const last = attempts.at(-1) ?? null;
  const window = last ? { start: last.start, end: last.end } : { start: shiftDays(gridEnd, -FRESHNESS.lookbackDays), end: gridEnd };
  const calls = attempts.flatMap((a) => a.calls);
  const provenance = {
    entity: ref,
    operation: "exec trends",
    window,
    requestedAt,
    respondedAt: iso(clock()),
    requests: spent,
    ops,
    pages: calls.length,
    // A replayed page is a real Qloo response, but it was fetched earlier, so the
    // attestation says when: the page cache must never read as a live ask.
    fromCachedPage: spent === 0 && calls.length > 0,
    correlationIds: calls.map((c) => c.correlationId).filter(Boolean),
    files: [...new Set([last?.cacheName, ...calls.map((c) => c.cacheName)].filter(Boolean))],
  };
  if (provenance.fromCachedPage) {
    const page = readCache(calls[0].cacheName);
    provenance.cachedResponseFetchedAt = page?.fetchedAt ?? null;
  }
  if (failed) {
    const known = ["freshness_timeout", "budget_exhausted", "no_reference_entity"];
    return { ...provenance, checked: false, why: known.includes(failed.code) ? failed.code : "harness_error", harnessCode: known.includes(failed.code) ? null : String(failed.code ?? "").slice(0, 60) || null };
  }
  if (!points.length) return { ...provenance, checked: false, why: "no_trend_points" };
  const reading = qlooFreshnessReading({ points, panelLastRevision: panel.lastRevision, panelWindowEnd: panel.windowEnd });
  const when = `${provenance.respondedAt.slice(11, 16)}Z${provenance.fromCachedPage ? ` (response fetched ${String(provenance.cachedResponseFetchedAt ?? "earlier").slice(11, 16)}Z, replayed from the page cache)` : ""}`;
  return {
    ...provenance,
    checked: true,
    ...reading,
    panel,
    plain: freshnessSentence(ref, reading, panel, when),
  };
}

function multiSentence(entities, panel, when, primary) {
  const read = entities.filter((e) => e.checked);
  if (read.length <= 1) return read[0]?.plain ?? primary?.plain ?? "";
  const sectors = new Set(read.map((e) => e.entity?.sector).filter(Boolean)).size;
  const parts = read.map((e) => `${e.entity?.name ?? e.entity?.id} (${e.entity?.type ?? "entity"}, ${e.entity?.ticker} basket) newest week ${e.latestWeek ?? "absent"}, ${e.verdict === "qloo_has_a_newer_revision" ? `changed on ${e.latestRevision}` : e.verdict === "newer_weeks_no_change" ? "no change from the week before it" : "nothing newer than the panel tail"}`);
  const missed = entities.filter((e) => !e.checked).map((e) => `${e.entity?.name ?? e.entity?.id} (${e.entity?.ticker} basket): ${e.why ?? "no reading"}`);
  const verdict = read.some((e) => e.verdict === "qloo_has_a_newer_revision")
    ? `At least one entity has moved since the panel's last revision ${panel.lastRevision ?? "—"}; the held-out slice frozen at that date is stale against it.`
    : `None has moved since the panel's last revision ${panel.lastRevision ?? "—"}: newer weeks, no newer signal at this vintage.`;
  return `Qloo was asked ${when} about ${read.length} entities${sectors ? ` across ${sectors} sub-sectors` : ""} — ${parts.join("; ")}. ${verdict}${missed.length ? ` Not read: ${missed.join("; ")}.` : ""}`;
}

export async function runFreshnessCheck({ desk, refs = null, series = null, qloo = {}, budgetFile = BUDGET_FILE, cap = LIVE.dailyRequests, clock = () => Date.now() } = {}) {
  const blocked = freshnessGateReason();
  const at = iso(clock());
  if (blocked) return { checked: false, why: blocked, at };
  const chosen = (Array.isArray(refs) && refs.length ? refs : entitiesFor(desk)).slice(0, FRESHNESS.maxEntities);
  const primary = chosen[0] ?? referenceEntity(desk);
  if (!primary) return { checked: false, why: "no_reference_entity", at };
  const panel = { lastRevision: desk?.valueAdd?.oos?.scoring?.lastMove ?? null, windowEnd: desk?.window?.end ?? null };
  const basket = series?.[primary.ticker];
  const basketMoves = Array.isArray(basket?.basket) && Array.isArray(basket?.dates)
    ? basket.dates.filter((d, i) => Math.abs(basket.basket[i] ?? 0) > 0).sort()
    : [];
  const panelBasketLastMove = basketMoves.at(-1) ?? null;

  // One reservation for the whole set, settled down to what it actually spent.
  const reserved = chosen.length * FRESHNESS.maxRequests;
  const budget = await reserve(reserved, { file: budgetFile, cap });
  if (!budget.ok) {
    return { checked: false, why: "budget_exhausted", used: budget.requests, cap: budget.cap, at, entity: primary, panel };
  }
  // The newest weekly grid point Qloo could be answering for, not today's date:
  // between grid days the endpoint returns an empty page, which would read as
  // "Qloo has nothing" when it really means "ask me on the grid".
  const gridEnd = nextTrendWeek(new Date(clock()).toISOString().slice(0, 10));
  const requestedAt = iso(clock());
  const seriesFn = qloo.series ?? qlooTrendPage;
  const entities = await Promise.all(chosen.map((ref) => probeEntity(ref, { gridEnd, requestedAt, seriesFn, panel, clock })));
  const spent = entities.reduce((a, e) => a + (e.requests ?? 0), 0);
  const ops = entities.reduce((a, e) => a + (e.ops ?? 0), 0);
  await settle({ reserved, spent, ops }, { file: budgetFile });

  const head = entities.find((e) => e.entity?.id === primary.id) ?? entities[0];
  const read = entities.filter((e) => e.checked);
  if (!read.length) {
    const first = entities.find((e) => e.why) ?? entities[0];
    return { ...first, checked: false, entities, requests: spent, panel, at: iso(clock()), scope: freshnessScope(entities) };
  }
  const lead = read[0];
  const when = `${String(lead.respondedAt ?? "").slice(11, 16)}Z${lead.fromCachedPage ? ` (response fetched ${String(lead.cachedResponseFetchedAt ?? "earlier").slice(11, 16)}Z, replayed from the page cache)` : ""}`;
  const verdict = read.some((e) => e.verdict === "qloo_has_a_newer_revision")
    ? "qloo_has_a_newer_revision"
    : read.every((e) => e.verdict === "newer_weeks_no_change") ? "newer_weeks_no_change" : "nothing_newer_than_panel_tail";
  return {
    ...head,
    checked: true,
    verdict,
    latestWeek: read.map((e) => e.latestWeek).filter(Boolean).sort().at(-1) ?? null,
    entities,
    requests: spent,
    pages: entities.reduce((a, e) => a + (e.pages ?? 0), 0),
    fromCachedPage: spent === 0 && entities.some((e) => e.pages > 0),
    correlationIds: entities.flatMap((e) => e.correlationIds ?? []),
    files: [...new Set(entities.flatMap((e) => e.files ?? []))],
    panel,
    panelBasketLastMove,
    plain: multiSentence(entities, panel, when, head),
    scope: freshnessScope(entities),
    at: iso(clock()),
  };
}

// One checker per panel revision with one cache slot per entity set: the panel-wide
// set and each set a question names are cached separately, so two answers about the
// same names share a reading and two answers about different names do not overwrite
// each other. A failure is held for a minute rather than fifteen, and never retried
// inside an answer.
export function createFreshnessChecker(options = {}) {
  const clock = options.clock ?? (() => Date.now());
  const minutes = options.cacheMinutes ?? FRESHNESS.cacheMinutes;
  const holdMs = (value) => (value.checked ? minutes : FRESHNESS.failureCacheSeconds / 60) * 60000;
  const entries = new Map();
  const inflight = new Map();
  const keyOf = (refs) => (refs?.length ? refs.map((r) => r.id).sort().join(",") : "panel");
  const run = (refs) => {
    const key = keyOf(refs);
    const p = runFreshnessCheck({ ...options, refs: refs ?? null, clock });
    inflight.set(key, p);
    return p.then(
      (value) => { if (inflight.get(key) === p) inflight.delete(key); entries.set(key, { at: clock(), value }); return value; },
      (e) => { if (inflight.get(key) === p) inflight.delete(key); throw e; },
    );
  };
  const fresh = (key) => {
    const entry = entries.get(key);
    if (!entry || clock() - entry.at >= holdMs(entry.value)) return null;
    return { ...entry.value, fromCache: true, cachedSeconds: Math.round((clock() - entry.at) / 1000) };
  };
  return {
    async check(refs = null) {
      const key = keyOf(refs);
      const cached = fresh(key);
      if (cached) return cached;
      // One probe at a time per set: an answer that arrives while a probe is still
      // in the air joins it rather than spending a second request on the same set.
      const value = await (inflight.get(key) ?? run(refs));
      return { ...value, fromCache: false };
    },
    // The first probe of a new trend week is a cold live call — measured at 26 s on
    // 2026-10-30, longer than an answer may wait. Starting it when the panel is
    // loaded means the first answer usually carries a reading that already landed;
    // when it has not, that answer says it was not checked in time instead of
    // inventing one, and the next one within the week replays the page from disk.
    // Gated by the same flag as the check, so a deployment without the live gate
    // never spends anything here.
    prime() {
      if (freshnessGateReason()) return null;
      if (fresh("panel")) return null;
      return inflight.get("panel") ?? run(null).catch(() => null);
    },
    // What an answer already established for the panel-wide set. It never makes a
    // request: a page load must not be able to spend the Qloo budget.
    peek() {
      const blocked = freshnessGateReason();
      if (blocked) return { checked: false, why: blocked, live: false };
      const entry = entries.get("panel");
      if (!entry) return { checked: false, why: "not_checked_yet", live: true };
      return { ...entry.value, fromCache: true, stale: clock() - entry.at >= holdMs(entry.value), ageSeconds: Math.round((clock() - entry.at) / 1000) };
    },
  };
}

/* ---------- pure math reused for the live read ---------- */

// The desk regresses a name's weekly return on SPY and its sub-sector basket over
// the same calendar. A live read rebuilds that calendar from the committed dates,
// drops only weeks where one of the three inputs is missing, and reports how many
// it dropped instead of filling anything.
export function alignLive({ dates, basket, returnsByDate, spyByDate }) {
  const y = [], spy = [], taste = [], used = [];
  for (const d of dates) {
    const r = returnsByDate.get(d), m = spyByDate.get(d), b = basket.get(d);
    if (![r, m, b].every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    y.push(r); spy.push(m); taste.push(b); used.push(d);
  }
  return { y, spy, taste, used };
}

export function regressLive({ y, spy, taste }) {
  if (y.length < 12) throw new Error(`only ${y.length} aligned weeks — too few for the estimator`);
  const full = ols(y, [spy, taste]);
  const mkt = ols(y, [spy]);
  return {
    weeks: y.length,
    market: { beta: num(full.beta[1], 3), t: num(full.t[1], 2) },
    marketOnly: { beta: num(mkt.beta[1], 3), t: num(mkt.t[1], 2) },
    cultural: { beta: num(full.beta[2], 2), se: num(full.se[2], 2), t: num(full.t[2], 2), p: num(full.p[2], 4) },
    r2: num(full.r2, 4),
    deltaR2: num(full.r2 - mkt.r2, 4),
  };
}

function returnsFromPrices(prices, ticker) {
  const arr = prices?.symbols?.[ticker]?.returns;
  const raw = prices?.window?.alignedDates;
  if (!Array.isArray(arr) || !Array.isArray(raw) || arr.length !== raw.length) return null;
  return new Map(raw.map((d, i) => [d, arr[i]]));
}

/* ---------- tools ---------- */

function budgetError(b) {
  return { error: "live Qloo budget exhausted for today", code: "LIVE_BUDGET_EXHAUSTED", used: b.requests, cap: b.cap, note: "Answer from the committed panel and say the live read is unavailable until tomorrow." };
}

export function createLiveTools({ desk, qloo = {}, state = { liveCalls: 0 }, budgetFile = BUDGET_FILE, cap = LIVE.dailyRequests, pricesFile = resolve(ROOT, "fixtures/prices.json") } = {}) {
  if (!desk || !Array.isArray(desk.rows)) throw new Error("createLiveTools needs the committed desk");
  const search = qloo.search ?? qlooSearch;
  const results = qloo.results ?? searchResults;
  const series = qloo.series ?? qlooSeries;
  const dates = desk.window?.alignedDates ?? [];
  let pricesOnce = null;
  const prices = () => {
    if (pricesOnce === null) {
      const f = pricesFile;
      pricesOnce = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
    }
    return pricesOnce;
  };

  const gate = () => {
    if (state.liveCalls >= LIVE.callsPerAnswer) {
      return { error: "this answer already used its one live Qloo read", code: "LIVE_CALL_CAP" };
    }
  };

  const finish = (result, { spent, pages, replayed, calls = [], entities = [], operation = "exec trends", requestedAt }) => {
    state.liveCalls++;
    return {
      ...result,
      qloo: {
        ...(result.qloo ?? {}),
        requests: spent,
        pages,
        replayedPages: replayed,
        dailyBudget: readBudget(budgetFile),
        // The receipt a reader needs to re-point at one call: what was asked, of
        // which entity, what the harness answered it with, and which file holds it.
        operation,
        entities: [...new Set(entities.filter(Boolean))],
        correlationIds: calls.map((c) => c.correlationId).filter(Boolean),
        files: [...new Set(calls.map((c) => c.cacheName).filter(Boolean))],
        requestedAt: requestedAt ?? null,
      },
    };
  };

  const tools = new Map();

  tools.set("live_brand_trends", {
    def: {
      type: "function",
      function: {
        name: "live_brand_trends",
        description: "Make a live Qloo call: resolve a brand name, then pull its weekly population-percentile path over the last three months and report what moved. Use for a name outside the book, or when asked whether Qloo still knows a brand. Spends one search and up to three trend pages against the daily budget.",
        parameters: { type: "object", properties: { name: { type: "string", description: "Brand name, e.g. 'Lululemon'" } }, required: ["name"] },
      },
    },
    run: async ({ name } = {}) => {
      const blocked = gate();
      if (blocked) return blocked;
      const v = validateBrandName(name);
      if (v.error) return { error: v.error };
      const reserveMax = 1 + 3;
      const b = await reserve(reserveMax, { file: budgetFile, cap });
      if (!b.ok) return budgetError(b);
      let spent = 0, pages = 0, replayed = 0;
      const requestedAt = new Date().toISOString();
      try {
        const json = await search(v.name, { take: 5, type: "brand" });
        spent++;
        const candidates = results(json);
        const hit = pickEntity(candidates, v.name);
        if (!hit) {
          await settle({ reserved: reserveMax, spent, ops: spent }, { file: budgetFile });
          return finish({ query: v.name, resolved: false, candidates: [], note: "Qloo returned no brand entity for this string; the desk cannot price a name it cannot resolve." }, { spent, pages, replayed, requestedAt, operation: "api search" });
        }
        const type = String(hit.type ?? "brand").replace(/^urn:entity:/, "");
        const end = dates.at(-1) ?? today();
        const start = shiftDays(end, -LIVE.brandLookbackDays);
        const res = await series([hit.id], type, { start, end, cacheName: `live-brand-${hit.id}.json` });
        for (const c of res.calls) { pages++; if (c.replayed) replayed++; else spent++; }
        const points = res.byEntity.get(hit.id) ?? [];
        const moves = tasteSeries({ points }, book().tasteSignal);
        const levels = points.filter((p) => typeof p?.[book().tasteSignal.field] === "number");
        const first = levels[0], last = levels.at(-1);
        const weekly = [...moves].sort((a, b) => a[0].localeCompare(b[0]));
        const last13 = weekly.slice(-13);
        const jumps = weekly.filter(([, r]) => Math.abs(r) >= 0.05).map(([d, r]) => ({ date: d, logMove: num(r, 3) }));
        await settle({ reserved: reserveMax, spent, ops: pages + 1 }, { file: budgetFile });
        return finish({
          query: v.name,
          resolved: true,
          entity: { id: hit.id, name: hit.name, type },
          candidates: candidates.slice(0, 5),
          window: { start, end },
          points: points.length,
          firstDate: first?.date ?? null,
          lastDate: last?.date ?? null,
          latestPercentile: num(last?.[book().tasteSignal.field], 2),
          changeOverSpan: first && last ? num(Math.log(last[book().tasteSignal.field] / first[book().tasteSignal.field]), 4) : null,
          last13WeeksLogReturn: last13.length ? num(last13.reduce((a, [, r]) => a + r, 0), 4) : null,
          revisionJumps: jumps,
          inBook: desk.rows.find((r) => normal(r.label) === normal(hit.name))?.ticker ?? null,
          note: "live pull, not the committed panel. A percentile move is Qloo's level change, and a jump of 0.05 or more in one week is the catalogue being rescanned, not the brand moving.",
        }, { spent, pages, replayed, calls: res.calls, entities: [hit.id], operation: "api search + exec trends", requestedAt });
      } catch (e) {
        await settle({ reserved: reserveMax, spent, ops: pages }, { file: budgetFile });
        return { error: `live Qloo read failed: ${e.code ?? e.message}`, code: e.code ?? "LIVE_FAILED", note: "Say the live read is unavailable; answer from the committed panel if it covers the question." };
      }
    },
  });

  tools.set("live_cultural_beta", {
    def: {
      type: "function",
      function: {
        name: "live_cultural_beta",
        description: "Re-pull a book name's sub-sector Qloo basket and re-run the desk's estimator at inference, returning the live cultural beta beside the committed one. Use when asked whether a number is reproducible now, or for a live read of a priced name. Spends trend pages against the daily budget.",
        parameters: { type: "object", properties: { ticker: { type: "string", description: "Ticker in the book, e.g. DIS" } }, required: ["ticker"] },
      },
    },
    run: async ({ ticker } = {}) => {
      const blocked = gate();
      if (blocked) return blocked;
      const v = validateTicker(ticker);
      if (v.error) return { error: v.error };
      const row = desk.rows.find((r) => String(r.ticker).toUpperCase() === v.ticker);
      if (!row) return { error: `not in the book: ${v.ticker}`, hint: "live_brand_trends can look up a name outside the book" };
      if (row.status !== "ok" || !row.basket?.length) return { error: `${v.ticker} is ${row.status}; it has no priced cultural beta to re-run`, note: row.note ?? null };
      const p = prices();
      const yByDate = returnsFromPrices(p, v.ticker);
      const spyByDate = returnsFromPrices(p, book().index.ticker);
      if (!yByDate || !spyByDate) return { error: `no committed weekly prices for ${v.ticker} or the index; the estimator needs both` };

      // The pipeline pulled the basket from the start of the prior window, and the
      // trend endpoint's coverage per entity depends on how far back the request
      // opens: a narrow window came back with the movie and TV members starting in
      // 2025-04, which silently re-weights the basket and moved the beta by 1.7
      // points. Same depth as the pipeline means the live read is comparable by
      // construction, and where the pages are already on disk it replays them.
      const priorStart = desk.priorWindow?.alignedDates?.[0] ?? dates[0];
      const start = shiftDays(priorStart, -7);
      const end = shiftDays(dates.at(-1), 7);
      const byType = new Map();
      for (const m of row.basket) {
        if (!m.id) continue;
        if (!byType.has(m.type)) byType.set(m.type, []);
        byType.get(m.type).push(m);
      }
      // The planner counts pages by its own end-anchored walk; the live walk
      // returned 47 pages for a basket the planner put at 24, because a page
      // carries closer to fifteen points than twenty. Reserve by calendar weeks
      // instead: one page per twelve weeks per batch, which bounds the 47 observed.
      const weeks = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 604800000);
      const batchesPlanned = [...byType.values()].reduce((n, ms) => n + Math.ceil(ms.length / 5), 0);
      const reserveMax = Math.min(LIVE.maxTrendPages, Math.ceil(weeks / 12) * batchesPlanned + 1);
      if (reserveMax > LIVE.maxTrendPages) return { error: `this basket could need up to ${reserveMax} trend pages, above the ${LIVE.maxTrendPages}-page cap for one live read` };
      const b = await reserve(reserveMax, { file: budgetFile, cap });
      if (!b.ok) return budgetError(b);

      let spent = 0, pages = 0, replayed = 0;
      const requestedAt = new Date().toISOString();
      const allCalls = [];
      try {
        const batches = [];
        for (const [type, ms] of byType) for (let i = 0; i < ms.length; i += 5) batches.push({ type, chunk: ms.slice(i, i + 5) });
        const out = await Promise.all(batches.map((bt) => series(bt.chunk.map((m) => m.id), bt.type, { start, end, cacheName: `live-basket-${row.sector}-${bt.type}.json` })));
        const byId = {};
        const members = [];
        for (let i = 0; i < batches.length; i++) {
          for (const c of out[i].calls) { pages++; if (c.replayed) replayed++; else spent++; allCalls.push(c); }
          for (const m of batches[i].chunk) {
            const points = out[i].byEntity.get(m.id) ?? [];
            byId[m.id] = { points };
            members.push({ name: m.name, type: m.type, weight: num(m.weight, 4), weeks: new Set(points.map((x) => x.date)).size });
          }
        }
        const basket = blendBasket(row.basket.filter((m) => m.id), byId, book().tasteSignal);
        const aligned = alignLive({ dates, basket, returnsByDate: yByDate, spyByDate });
        const live = regressLive(aligned);
        await settle({ reserved: reserveMax, spent, ops: pages }, { file: budgetFile });
        return finish({
          ticker: v.ticker,
          sector: row.sectorLabel ?? row.sector,
          window: { start: dates[0], end: dates.at(-1), committedWeeks: dates.length, liveWeeks: live.weeks, droppedWeeks: dates.length - live.weeks },
          live,
          committed: { culturalBeta: num(row.culturalBeta, 2), culturalT: num(row.culturalT, 2), culturalQ: num(row.culturalQ, 3), deltaR2: num(row.deltaR2, 4) },
          change: {
            beta: num(live.cultural.beta - row.culturalBeta, 2),
            t: num(live.cultural.t - row.culturalT, 2),
            deltaR2: num(live.deltaR2 - row.deltaR2, 4),
          },
          basketMembers: members,
          note: "The live number is the desk's estimator re-run at inference over a Qloo pull of the same basket at the pipeline's depth. Pages already on disk are replayed and counted as such; anything not cached is fetched. Benjamini-Hochberg q is book-wide and cannot be re-derived for one name; the committed q is shown for context, and a live |t| above 2 without that correction is not a flag.",
        }, { spent, pages, replayed, calls: allCalls, entities: row.basket.filter((m) => m.id).map((m) => m.id), requestedAt });
      } catch (e) {
        await settle({ reserved: reserveMax, spent, ops: pages }, { file: budgetFile });
        return { error: `live Qloo read failed: ${e.code ?? e.message}`, code: e.code ?? "LIVE_FAILED", note: "Say the live read is unavailable; the committed row is still the reading of record." };
      }
    },
  });

  return tools;
}

// Merge the live tools into the cached panel tools, binding one call budget to
// this answer. The panel tools are shared and stateless; only these two are new.
// A provider fallback re-runs the whole loop, so the bound is resettable: the
// persisted daily budget is what actually stops spending, and the fallback must be
// allowed to make the call the failed attempt never completed.
export function withLiveTools(base, options) {
  const live = createLiveTools(options);
  const state = options.state ?? { liveCalls: 0 };
  const merged = new Map(base);
  for (const [k, v] of live) merged.set(k, v);
  merged.liveReset = () => { state.liveCalls = 0; };
  merged.liveUsed = () => state.liveCalls;
  return merged;
}
