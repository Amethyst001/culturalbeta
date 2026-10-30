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
import { qlooSearch, qlooSeries, searchResults, seriesPlan } from "./qloo.mjs";
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

  const finish = (result, { spent, pages, replayed }) => {
    state.liveCalls++;
    return { ...result, qloo: { ...(result.qloo ?? {}), requests: spent, pages, replayedPages: replayed, dailyBudget: readBudget(budgetFile) } };
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
      try {
        const json = await search(v.name, { take: 5, type: "brand" });
        spent++;
        const candidates = results(json);
        const hit = pickEntity(candidates, v.name);
        if (!hit) {
          await settle({ reserved: reserveMax, spent, ops: spent }, { file: budgetFile });
          return finish({ query: v.name, resolved: false, candidates: [], note: "Qloo returned no brand entity for this string; the desk cannot price a name it cannot resolve." }, { spent, pages, replayed });
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
        }, { spent, pages, replayed });
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
      try {
        const batches = [];
        for (const [type, ms] of byType) for (let i = 0; i < ms.length; i += 5) batches.push({ type, chunk: ms.slice(i, i + 5) });
        const out = await Promise.all(batches.map((bt) => series(bt.chunk.map((m) => m.id), bt.type, { start, end, cacheName: `live-basket-${row.sector}-${bt.type}.json` })));
        const byId = {};
        const members = [];
        for (let i = 0; i < batches.length; i++) {
          for (const c of out[i].calls) { pages++; if (c.replayed) replayed++; else spent++; }
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
        }, { spent, pages, replayed });
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
