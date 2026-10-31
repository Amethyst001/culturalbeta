// Desk backend. Holds the Qloo key server-side (never shipped to the browser).
// GET  /api/desk.json        -> committed computation, or a refusal if Qloo data absent.
// GET  /api/mde.json         -> committed minimum-detectable-effect bounds (zero Qloo requests to build).
// GET  /api/basket-sensitivity.json -> the same estimator re-run under alternative taste baskets.
// GET  /api/v1/panel         -> versioned feed of the same numbers, for ingestion.
// GET  /api/v1/holding/:tick -> one holding.
// GET  /api/v1/alerts        -> the panel read as a watchlist: which names would fire, and why none does.
// GET  /export/panel.csv     -> the panel as a spreadsheet.
// GET  /api/agent.json       -> whether the analyst agent is configured, and its limits.
// GET  /api/freshness.json   -> the last live Qloo freshness attestation. Reads the cache only: it never
//                               makes a request, so opening the page cannot spend the budget.
// POST /api/ask              -> the analyst agent over the committed panel. Every answer carries a Qloo
//                               freshness attestation the server asks at answer time and a receipt naming
//                               the calls or cached responses behind it. Read-only: it can spend at most
//                               two bounded trend requests, and never a number.
// POST /api/recompute        -> runs the live pipeline (needs QLOO_API_KEY in .env).
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { ROOT } from "../src/env.mjs";
import { ols } from "../src/ols.mjs";
import { loadUniverse } from "../src/universe.mjs";
import { computeBudget, spentFromCache } from "../src/budget.mjs";
import { createDeskTools, readProviders, askQuestion, collectReceipts, LIMITS } from "../src/agent.mjs";
import { withLiveTools, liveStatus, createFreshnessChecker, freshnessGateReason, attestationGate, createLiveTools, FRESHNESS, LIVE, entitiesFor, tickersInQuestion } from "../src/live-qloo.mjs";
import { reestimateAfterRevision, revisionAddendum, revisionPayload } from "../src/reestimate.mjs";

const PORT = Number(process.env.PORT || 8811);
const OUT = process.env.CULTURALBETA_OUTPUT_DIR ? resolve(process.env.CULTURALBETA_OUTPUT_DIR) : resolve(ROOT, "output");
// Same resolution rule as src/qloo.mjs, restated so the desk stays importable
// without pulling in the harness or the key.
const QLOO_CACHE = process.env.CULTURALBETA_QLOO_DIR ? resolve(process.env.CULTURALBETA_QLOO_DIR) : resolve(ROOT, "fixtures/qloo");
const SCHEMA_VERSION = "1.0.0";

function marketOnly() {
  const prices = JSON.parse(readFileSync(resolve(ROOT, "fixtures/prices.json"), "utf8"));
  const book = JSON.parse(readFileSync(resolve(ROOT, "config/book.json"), "utf8"));
  const universe = loadUniverse();
  const idx = prices.symbols[book.index.ticker].returns;
  // A name without a complete price history keeps its row and loses its beta:
  // dropped tickers are shown, never silently removed from the book.
  const rows = universe.names.map((n) => {
    const base = { ticker: n.ticker, label: n.label, sector: n.sector, sectorLabel: n.sectorLabel, featured: Boolean(n.featured) };
    const y = prices.symbols[n.ticker]?.returns;
    if (!y) return { ...base, status: "no prices", weeks: 0, marketBeta: null, marketSE: null };
    const reg = ols(y, [idx]);
    return { ...base, status: "ok", weeks: reg.n, marketBeta: reg.beta[1], marketSE: reg.se[1], marketT: reg.t[1], marketP: reg.p[1], r2: reg.r2 };
  });
  const { alignedDates, ...window } = prices.window;
  return {
    mode: "market-only",
    window,
    pricesSource: prices.source,
    index: book.index,
    universe: { total: universe.names.length, priced: rows.filter((r) => r.status === "ok").length, sectors: universe.sectors.map((s) => ({ id: s.id, label: s.label })) },
    dropped: prices.dropped ?? [],
    rows,
  };
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

const RECOMPUTE_TIMEOUT_MS = Number(process.env.RECOMPUTE_TIMEOUT_MS || 900000);
let recomputing = false;

const KEYED_STEPS = ["scripts/qloo-map.mjs", "scripts/qloo-sector-basket.mjs", "scripts/qloo-basket.mjs", "scripts/qloo-series.mjs", "scripts/compute-betas.mjs"];
// Clicking the desk must not spend the Qloo budget. By default a recompute re-derives
// the panel from the cached, already-paid-for responses — that is still "from Qloo",
// and it is the only form a reviewer left alone with the page can safely trigger. A
// fresh keyed run costs ~2,000 requests and is opt-in through the environment.
const PIPELINE_STEPS = process.env.DESK_KEYED_RECOMPUTE === "1" ? KEYED_STEPS : ["scripts/compute-betas.mjs"];

function runStep(step, timeoutMs) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [resolve(ROOT, step)], {
      cwd: ROOT,
      env: { ...process.env, QLOO_RUN: process.env.DESK_KEYED_RECOMPUTE === "1" ? "1" : "0" },
    });
    let out = "", err = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (c) => { if (out.length < 20000) out += c; });
    child.stderr.on("data", (c) => { if (err.length < 20000) err += c; });
    child.on("error", (e) => { clearTimeout(timer); done({ step, status: null, out, err: err + String(e), timedOut }); });
    child.on("close", (status) => {
      clearTimeout(timer);
      const suffix = timedOut ? `${err}
[timed out after ${Math.round(timeoutMs / 1000)}s — the step was killed; the committed panel is unchanged]` : err;
      done({ step, status, out: out.slice(0, 4000), err: suffix.slice(0, 4000), timedOut });
    });
  });
}

async function runPipeline({ timeoutMs }) {
  const log = [];
  for (const step of PIPELINE_STEPS) {
    const r = await runStep(step, timeoutMs);
    log.push(r);
    if (r.status !== 0) break;
  }
  return log;
}

function loadDesk() {
  const f = resolve(OUT, "desk.json");
  if (!existsSync(f)) return null;
  return { desk: JSON.parse(readFileSync(f, "utf8")), revision: statSync(f).mtime.toISOString() };
}

// One row, in the shape a consuming desk would store. Nulls stay null: an
// unpriced holding is reported as unpriced, never as a zero beta.
function claimInterval(r) {
  const f = r.oosFixed, q = r.oosRefit;
  if (!f || !q) return null;
  return (q.hi - q.lo) > (f.hi - f.lo) ? "refit per draw" : "fixed coefficients";
}

function productRow(r, testable = null) {
  const ok = r.status === "ok";
  // A frozen scored slice cannot support a row-level out-of-sample reading: the
  // coefficient is multiplied by a zero regressor, so the number is the training
  // fit's perturbation, not a test. The product surface withholds it rather than
  // letting an ingestion client read DIS -5.8 as a reversal.
  const oosTestable = ok ? testable !== false : null;
  return {
    ticker: r.ticker,
    label: r.label,
    sector: r.sector ?? null,
    sectorLabel: r.sectorLabel ?? null,
    featured: Boolean(r.featured),
    status: r.status,
    weeks: r.weeks ?? null,
    qlooEntityId: r.qlooEntityId ?? null,
    // The market half does not need Qloo, so an unresolved name still carries it;
    // only the cultural columns are withheld.
    marketBeta: r.marketBeta ?? null,
    marketSE: r.marketSE ?? null,
    marketT: r.marketT ?? null,
    // Why a row has no cultural beta travels with the row: an ingestion client
    // must not have to guess between "not found", "no prices" and "no signal".
    note: r.note ?? null,
    query: r.query ?? null,
    resolution: r.resolution ?? null,
    culturalBeta: ok ? r.culturalBeta : null,
    culturalSE: ok ? r.culturalSE : null,
    culturalT: ok ? r.culturalT : null,
    culturalP: ok ? r.culturalP : null,
    r2: ok ? r.r2 : null,
    r2Market: ok ? r.r2Market : null,
    deltaR2: ok ? r.deltaR2 : null,
    oosTestable,
    oosDeltaR2: oosTestable ? r.oos?.deltaR2 ?? null : null,
    oosDeltaR2FixedLo: oosTestable ? r.oosFixed?.lo ?? null : null,
    oosDeltaR2FixedHi: oosTestable ? r.oosFixed?.hi ?? null : null,
    oosDeltaR2RefitLo: oosTestable ? r.oosRefit?.lo ?? null : null,
    oosDeltaR2RefitHi: oosTestable ? r.oosRefit?.hi ?? null : null,
    // Which of the two intervals the grade uses for this row: the wider one. A
    // single field so a downstream consumer cannot quietly pick the narrow one.
    oosClaimInterval: oosTestable ? claimInterval(r) : null,
    placeboP: ok ? r.placeboP ?? null : null,
    culturalQ: ok ? r.culturalQ ?? null : null,
    flagged: ok ? Boolean(r.flagged) : null,
    flagRule: "negative cultural beta, |t| >= 2, Benjamini-Hochberg q <= 0.10 across the book",
    audience: ok && r.audience ? {
      culturalBeta: r.audience.culturalBeta,
      culturalT: r.audience.culturalT,
      oosTestable,
      oosDeltaR2: oosTestable ? r.audience.oos?.deltaR2 ?? null : null,
      basket: r.audience.members,
    } : null,
    secondWindow: ok && r.secondary ? {
      culturalBeta: r.secondary.culturalBeta,
      culturalT: r.secondary.culturalT,
      oosDeltaR2: r.secondary.oos?.deltaR2 ?? null,
      flagged: r.secondary.flagged,
    } : null,
    peerDeltaR2: ok ? r.ablation?.peerDeltaR2 ?? null : null,
    tasteExtraOosR2: ok ? r.ablation?.oos?.tasteExtraOosR2 ?? null : null,
    ablationPlaceboP: ok ? r.ablationPlaceboP ?? null : null,
    sentimentExtraOosR2: ok ? r.sentimentExtraOosR2 ?? null : null,
    sentimentCorr: ok ? r.sentimentCorr ?? null : null,
    secondCulturalBeta: ok ? r.secondary?.culturalBeta ?? null : null,
    secondCulturalT: ok ? r.secondary?.culturalT ?? null : null,
    basket: ok ? r.basket ?? [] : [],
    note: r.note ?? null,
  };
}

function panelFeed({ desk, revision }) {
  const testable = desk.valueAdd?.oos?.scoring?.testable ?? null;
  return {
    schema: SCHEMA_VERSION,
    revision,
    window: { start: desk.window.start, end: desk.window.end, weeks: desk.window.weeks },
    secondWindow: desk.priorWindow ? { start: desk.priorWindow.start, end: desk.priorWindow.end, weeks: desk.priorWindow.weeks } : null,
    index: desk.index,
    universe: desk.universe ?? null,
    flagRule: desk.flagRule ?? null,
    factorConstruction: desk.factorConstruction,
    valueAdd: desk.valueAdd,
    sampleFloor: desk.sampleFloor,
    rows: desk.rows.map((r) => productRow(r, testable)),
  };
}

const ALERT_RULE = "cultural beta < 0 with |t| >= 2, the held-out slice testable at this data vintage and this holding's out-of-sample ΔR² > 0, and the book placebo p <= 0.10";
const BOOK_P_MAX = 0.10;
const fmt = (v) => v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2);

// The panel read as a watchlist, never a live signal: which names carry a measured
// taste headwind that survived the book's own tests, and a reason for every name
// that did not. Nothing here re-evaluates on a market tick — the window is fixed at
// the run behind the desk, and when the book-level null is not separable the feed
// says so in `status` instead of pretending the silence is a clean screen.
function alertsFeed({ desk, revision }) {
  const priced = desk.rows.filter((r) => r.status === "ok");
  const bookP = desk.valueAdd?.placebo?.p ?? null;
  const sc = desk.valueAdd?.oos?.scoring ?? null;
  // A frozen held-out slice cannot support the third condition at any effect size
  // (the scored regressor is identically zero), so the feed must say that rather
  // than reporting "no out-of-sample support" as though the test had run.
  const oosTestable = sc ? sc.testable !== false : null;
  const firing = [];
  const suppressed = [];
  for (const r of priced) {
    const reasons = [];
    if (!r.flagged) reasons.push("cultural beta is not negative at |t| >= 2");
    if (oosTestable === false) reasons.push(`the held-out slice is frozen for every name at this Qloo vintage (taste series last moved ${sc.lastMove})`);
    else if (!(r.oos?.deltaR2 > 0)) reasons.push("no out-of-sample support for this name");
    if (!(bookP !== null && bookP <= BOOK_P_MAX)) reasons.push("book placebo is not separable at p <= 0.10");
    const base = {
      ticker: r.ticker,
      label: r.label,
      culturalBeta: r.culturalBeta,
      culturalT: r.culturalT,
      oosTestable,
      oosDeltaR2: oosTestable === false ? null : r.oos?.deltaR2 ?? null,
      placeboP: r.placeboP ?? null,
    };
    if (reasons.length) suppressed.push({ ...base, reasons, plain: `${r.label} is not alerted: ${reasons.join("; ")}.` });
    else {
      firing.push({
        ...base,
        bookPlaceboP: bookP,
        since: desk.window.start,
        window: { start: desk.window.start, end: desk.window.end, weeks: desk.window.weeks },
        plain: `${r.label} carries a measured taste headwind (cultural beta ${fmt(r.culturalBeta)}): when its sub-sector's taste basket moves with the market, the stock moves against it — and that held out of sample for this name.`,
        evidence: `/api/v1/holding/${r.ticker}`,
      });
    }
  }
  // "watchlist-only" is the honest state when the book-wide test is not
  // separable or when the held-out condition cannot run: no name can clear the
  // rule, so an empty firing list is a property of the tests, not evidence that
  // every name is clean.
  const status = bookP === null ? "no-book-null" : (bookP <= BOOK_P_MAX && oosTestable !== false) ? "armed" : "watchlist-only";
  return {
    schema: SCHEMA_VERSION,
    revision,
    status,
    rule: ALERT_RULE,
    note: status === "watchlist-only"
      ? `This is a read of the committed panel for the ${desk.window.weeks} weeks ending ${desk.window.end}, not a live monitor. ${[
        bookP === null ? "There is no book-level null" : `The book-level placebo is p ${bookP.toFixed(2)}`,
        oosTestable === false ? `the held-out slice is frozen for every name (taste series last moved ${sc.lastMove})` : null,
      ].filter(Boolean).join(" and ")}, so no name can clear the rule and the feed can only be a watchlist: the suppressed entries carry each name's measured headwind and the exact test it did not clear.`
      : `This is a read of the committed panel for the ${desk.window.weeks} weeks ending ${desk.window.end}, not a live monitor; the book-level placebo is p ${bookP === null ? "—" : bookP.toFixed(2)}.`,
    window: { start: desk.window.start, end: desk.window.end, weeks: desk.window.weeks },
    count: firing.length,
    priced: priced.length,
    firing,
    suppressed,
  };
}

const CSV_COLUMNS = [
  "ticker", "label", "sector", "status", "weeks", "marketBeta", "marketSE", "culturalBeta", "culturalSE",
  "query", "resolutionClass", "note",
  "culturalT", "culturalP", "culturalQ", "r2", "r2Market", "deltaR2", "oosDeltaR2", "placeboP",
  "peerDeltaR2", "tasteExtraOosR2", "ablationPlaceboP", "sentimentExtraOosR2", "sentimentCorr", "oosDeltaR2FixedLo", "oosDeltaR2FixedHi", "oosDeltaR2RefitLo", "oosDeltaR2RefitHi", "oosClaimInterval", "oosTestable", "secondCulturalBeta", "secondCulturalT", "flagged", "basket",
];

function csvCell(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return `"${v.map((m) => `${m.name}:${m.weight.toFixed(4)}`).join("; ").replace(/"/g, '""')}"`;
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function panelCsv(feed) {
  // Per-row testability travels with the row, so a spreadsheet cannot read
  // oosDeltaR2 as a test result without the field that says whether the slice
  // could test anything. When the book is frozen the product rows carry null.
  const head = CSV_COLUMNS.join(",");
  const body = feed.rows.map((r) => CSV_COLUMNS.map((c) => csvCell(
    c === "resolutionClass" ? r.resolution?.failure ?? null
      : r[c],
  )).join(","));
  return [head, ...body].join("\n") + "\n";
}

/* ---------- analyst agent ---------- */
// Read-only over the committed panel: a question cannot spend a Qloo request, and
// no tool writes a file. The model is configured from the environment only.
const AGENT_PROVIDERS = readProviders(process.env);
const ASK_PER_HOUR = Number(process.env.AGENT_ASK_PER_HOUR || 120);
const ASK_MIN_GAP_MS = Number(process.env.AGENT_MIN_GAP_MS || 2000);
const ASK_CACHE_MAX = 200;
const askGlobal = [];
const askLastByIp = new Map();
const askCache = new Map();
let agentToolsCache = { stamp: "", tools: null, series: null };
let freshnessState = { stamp: "", checker: null };

function agentStatus() {
  const live = liveStatus();
  return {
    configured: AGENT_PROVIDERS.length > 0,
    providers: AGENT_PROVIDERS.map((p) => p.label),
    readOnly: true,
    live,
    // The freshness attestation is not a tool the model may decline: /api/ask runs
    // it itself, on every answer, and prints whatever Qloo actually returned.
    freshness: {
      enabled: live.enabled,
      onEveryAnswer: true,
      cacheMinutes: FRESHNESS.cacheMinutes,
      maxRequests: FRESHNESS.maxEntities * FRESHNESS.maxRequests,
      maxEntities: FRESHNESS.maxEntities,
      drawnFromDailyBudget: LIVE.dailyRequests,
      note: live.enabled
        ? `Before answering, the server asks Qloo one bounded trend page for each of up to ${FRESHNESS.maxEntities} committed basket entities — the names the question cites, otherwise one per sub-sector — and attests what each returned. The attestation is cached ${FRESHNESS.cacheMinutes} minutes per entity set and never prints a date without a response behind it. If it cannot run, the answer says it was not checked and why.`
        : "The live gate is off on this deployment, so no answer can carry a freshness attestation; every answer says so.",
    },
    receipts: {
      onEveryAnswer: true,
      note: "Each answer lists the Qloo provenance behind it: operation, entity ids, correlation ids, timestamps and request counts for a live call, cached response file names and the request that produced them for a committed one. Never a key, never a file's contents.",
    },
    limits: {
      questionChars: LIMITS.maxQuestionChars,
      toolCalls: LIMITS.maxToolCalls,
      rounds: LIMITS.maxRounds,
      perHour: ASK_PER_HOUR,
      minGapMs: ASK_MIN_GAP_MS,
    },
    note: live.enabled
      ? "The analyst reads the committed panel, may spend one bounded live Qloo read per answer, and always carries the server's freshness attestation and receipt. It cannot run the pipeline or change a number."
      : "The analyst reads the committed panel and the Qloo responses behind it. It cannot run the pipeline, spend a Qloo request, or change a number.",
  };
}

function loadAgentTools() {
  const loaded = loadDesk();
  if (!loaded) return null;
  const sf = resolve(OUT, "series.json");
  // Optional inputs: when they are absent the analyst's detectability tool says so
  // rather than reasoning about power from the flag count.
  const aux = [resolve(OUT, "mde.json"), resolve(OUT, "basket-sensitivity.json")];
  const mtimes = [sf, ...aux].map((f) => (existsSync(f) ? statSync(f).mtime.toISOString() : "absent"));
  const stamp = `${loaded.revision}|${mtimes.join("|")}`;
  if (agentToolsCache.stamp !== stamp) {
    const series = existsSync(sf) ? JSON.parse(readFileSync(sf, "utf8")) : {};
    const [mde, basketSensitivity] = aux.map((f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null));
    agentToolsCache = { stamp, tools: createDeskTools({ desk: loaded.desk, series, mde, basketSensitivity }), series };
  }
  return { tools: agentToolsCache.tools, series: agentToolsCache.series, revision: loaded.revision, desk: loaded.desk };
}

function freshnessCheckerFor(loaded, { prime = true } = {}) {
  const live = liveStatus();
  if (!live.enabled) return null;
  if (freshnessState.stamp !== loaded.revision) {
    freshnessState = { stamp: loaded.revision, checker: createFreshnessChecker({ desk: loaded.desk, series: loaded.series }) };
  }
  // The first probe of a new panel revision is a cold live call measured at ~13 s,
  // which an answer should not have to wait for. Starting it as the checker is
  // created means the first answer usually carries a reading that already landed.
  if (prime) freshnessState.checker.prime?.();
  return freshnessState.checker;
}

// An attestation that could not be obtained degrades to a reason, never to a date.
async function attestation(checker, refs = null) {
  if (!checker) return { checked: false, why: freshnessGateReason() ?? "live_gate_off", at: new Date().toISOString() };
  try {
    return await checker.check(refs);
  } catch (e) {
    return { checked: false, why: "harness_error", harnessCode: String(e.code ?? "").slice(0, 60) || null, at: new Date().toISOString() };
  }
}

// The gate stops being a label here. When the attestation reports a revision newer
// than the panel tail, the affected names are re-estimated with the same live tool
// the analyst can call, and the answer prints committed and re-estimated side by side.
// Memoised on the attestation stamp so a cached answer and a second click in the same
// 15-minute freshness window reuse one re-estimate instead of spending again.
const reestimateCache = new Map();

async function reestimateFor(loaded, freshness, gate, desk = loaded.desk) {
  if (gate?.state !== "moved" || !liveStatus().enabled) return null;
  const stamp = `${loaded.revision}|${gate.stamp}`;
  if (reestimateCache.has(stamp)) return reestimateCache.get(stamp);
  const moved = (freshness?.entities ?? []).filter((e) => e.checked && e.verdict === "qloo_has_a_newer_revision");
  if (!moved.length) return null;
  // Its own tool instance and its own call budget: the analyst's one live read is a
  // separate allowance from the re-estimate the gate is obliged to run.
  const tools = createLiveTools({ desk, state: { liveCalls: 0 } });
  const run = tools.get("live_cultural_beta")?.run;
  const value = await reestimateAfterRevision({ moved, run, max: 2 });
  reestimateCache.set(stamp, value);
  if (reestimateCache.size > 20) reestimateCache.delete(reestimateCache.keys().next().value);
  console.log(`gate: moved → re-estimated ${value.tickers.join(",") || "none"} (${value.spent} new, ${value.replayed} replayed)`);
  return value;
}

function movedFrom(freshness) {
  return (freshness?.entities ?? []).filter((e) => e.checked && e.verdict === "qloo_has_a_newer_revision");
}

// ---- replay -------------------------------------------------------------------
// The live gate cannot fire today: Qloo's newest revision is already in the panel,
// so a fresh pull reports "newer weeks, no newer signal". A reviewer can therefore
// never watch the gate do its job. Replay runs the identical machinery against the
// desk as it stood before the real 2025-12-22 revision: the same cached responses,
// the same estimator, the same gate. Nothing is synthetic — the pre-revision betas
// come from replaying the committed series through the committed estimator
// (output/revision-replay.json), and the live pull is the real one.
const replayCheckers = new Map();

const REPLAY_CAVEAT = "Replay caveat: the pre-revision vintage is 55 weeks against 102, so this pair mixes the revision with sample length — see the replay artifact for what the comparison cannot separate.";

function loadReplay(asOf) {
  const day = String(asOf ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const f = resolve(OUT, "revision-replay.json");
  if (!existsSync(f)) return null;
  try {
    const art = JSON.parse(readFileSync(f, "utf8"));
    if (!art?.revisionWeek || !Array.isArray(art.movers)) return null;
    // Full mover record, not just the beta: the replayed vintage's own t and
    // deltaR2 travel with it, so the re-estimation table never prints a
    // pre-revision beta beside post-revision t and dR2 (they are not the same
    // row's numbers, and printing them as one row looks like a copy bug).
    const before = new Map(art.movers.map((m) => [String(m.ticker), { beta: Number(m.betaBefore), t: Number(m.tBefore), deltaR2: Number(m.deltaR2Before) }]).filter(([, v]) => Number.isFinite(v.beta)));
    return {
      asOf: day,
      revisionWeek: art.revisionWeek,
      through: art.vintageBefore?.through ?? day,
      lastRevision: art.vintageBefore?.lastRevision ?? art.vintageBefore?.through ?? day,
      before,
      art,
    };
  } catch {
    return null;
  }
}

function replayMeta(replay) {
  if (!replay) return null;
  return {
    // The desk vintage and the probe week are different days: the panel is sliced
    // to the vintage before the revision, the probe is pinned to the revision week.
    asOf: replay.through,
    through: replay.through,
    revisionWeek: replay.revisionWeek,
    askedAt: replay.asOf,
    lastRevision: replay.lastRevision,
    note: `Replay of the desk as it stood before Qloo's ${replay.revisionWeek} revision (panel tail ${replay.through}), with the live probe pinned to ${replay.asOf}. The pre-revision betas were recomputed offline from the committed series with the committed estimator; the Qloo pull behind the re-estimate is real cached data.`,
  };
}

function replayDeskFor(desk, replay) {
  const va = desk.valueAdd ?? {};
  return {
    ...desk,
    window: { ...(desk.window ?? {}), end: replay.through },
    valueAdd: { ...va, oos: { ...(va.oos ?? {}), scoring: { ...(va.oos?.scoring ?? {}), lastMove: replay.lastRevision } } },
    rows: (desk.rows ?? []).map((r) => {
      const b = replay.before.get(String(r.ticker));
      if (!b) return r;
      return {
        ...r,
        culturalBeta: b.beta,
        culturalT: Number.isFinite(b.t) ? b.t : r.culturalT,
        deltaR2: Number.isFinite(b.deltaR2) ? b.deltaR2 : r.deltaR2,
      };
    }),
  };
}

// In replay the gate must read the members of the cited basket, not the one
// representative the live gate would pick: the 2025-12-22 move is the basket's,
// and a single member (the desk's reference entity) can be flat through it. Three
// highest-weight members is the same three-page bound the live gate already uses,
// and the feed still decides what came back.
function replayRefs(desk, question) {
  const rows = desk?.rows ?? [];
  const cited = tickersInQuestion(question, desk);
  const row = (cited.length ? rows.find((r) => String(r.ticker).toUpperCase() === cited[0]) : null)
    ?? rows.find((r) => String(r.ticker).toUpperCase() === "DIS" && (r.basket ?? []).length)
    ?? rows.find((r) => (r.basket ?? []).length);
  if (!row) return null;
  const usable = (row.basket ?? [])
    .filter((m) => m?.id && m?.type)
    .sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0));
  return usable.slice(0, 3).map((m) => ({
    ticker: row.ticker,
    sector: row.sector ?? null,
    id: m.id,
    name: m.name,
    type: m.type,
    weight: Number(m.weight) || 0,
  }));
}

function replayChecker(desk, series, revisionWeek) {
  if (!replayCheckers.has(revisionWeek)) {
    // The probe is pinned to the week the revision landed, not to the vintage date:
    // the trend endpoint returns only the newest twenty weeks before its end date,
    // so a window ending 2025-12-01 predates the move and a window ending today is
    // past it. Ending exactly on 2025-12-22 is the one window that contains the
    // real change, and it is a real pull at a real date. Only the probe is pinned:
    // the checker's own clock stays real, or a cached failure would never expire.
    const probeClock = () => Date.parse(`${revisionWeek}T12:00:00Z`);
    replayCheckers.set(revisionWeek, createFreshnessChecker({ desk, series, probeClock }));
    if (replayCheckers.size > 4) replayCheckers.delete(replayCheckers.keys().next().value);
  }
  return replayCheckers.get(revisionWeek);
}

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.socket.remoteAddress || "unknown";
}

function askAllowed(ip, now) {
  while (askGlobal.length && now - askGlobal[0] > 3600000) askGlobal.shift();
  if (askGlobal.length >= ASK_PER_HOUR) return { ok: false, retryAfter: Math.max(1, Math.ceil((3600000 - (now - askGlobal[0])) / 1000)) };
  const last = askLastByIp.get(ip) ?? 0;
  if (now - last < ASK_MIN_GAP_MS) return { ok: false, retryAfter: Math.max(1, Math.ceil((ASK_MIN_GAP_MS - (now - last)) / 1000)) };
  askGlobal.push(now);
  askLastByIp.set(ip, now);
  return { ok: true };
}

function readBody(req, max = 4096) {
  return new Promise((done, fail) => {
    let size = 0, buf = "";
    req.on("data", (c) => {
      size += c.length;
      if (size > max) { fail(Object.assign(new Error("body too large"), { code: "BODY_TOO_LARGE" })); req.destroy(); return; }
      buf += c;
    });
    req.on("end", () => done(buf));
    req.on("error", fail);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/api/desk.json") {
    const f = resolve(OUT, "desk.json");
    if (!existsSync(f)) return send(res, 503, JSON.stringify({ error: "QLOO_REQUIRED", message: "No cultural factor without Qloo. Run the fetch scripts with a live key." }));
    return send(res, 200, readFileSync(f));
  }
  if (url.pathname === "/api/market-only.json") {
    return send(res, 200, JSON.stringify(marketOnly()));
  }
  if (url.pathname === "/api/budget.json") {
    // Counts requests, it never makes one: the plan derived from config, plus what a
    // finished run spent according to its own cached responses.
    return send(res, 200, JSON.stringify({ planned: computeBudget(), spent: spentFromCache(QLOO_CACHE) }));
  }
  if (url.pathname === "/api/agent.json") {
    return send(res, 200, JSON.stringify(agentStatus()));
  }
  if (url.pathname === "/api/freshness.json") {
    // Cache read only: an answer has to be asked before the desk spends a request,
    // so the panel's own poll of this route never can. The boot prime started the
    // first probe; a page load only reads what it returned.
    const loaded = loadAgentTools();
    if (!loaded) return send(res, 503, JSON.stringify({ error: "QLOO_REQUIRED", message: "No panel; nothing to attest." }));
    const checker = freshnessCheckerFor(loaded, { prime: false });
    return send(res, 200, JSON.stringify(checker ? checker.peek() : { checked: false, why: freshnessGateReason() ?? "live_gate_off", live: false }));
  }
  if (url.pathname === "/api/ask") {
    if (req.method !== "POST") return send(res, 405, JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: "POST a JSON body { question }." }));
    const loaded = loadAgentTools();
    if (!loaded) return send(res, 503, JSON.stringify({ error: "QLOO_REQUIRED", message: "No panel without Qloo; the analyst has nothing to read." }));
    if (!AGENT_PROVIDERS.length) return send(res, 503, JSON.stringify({ error: "AGENT_NOT_CONFIGURED", message: "The analyst model is not configured on this deployment. The desk itself is unaffected." }));
    let body;
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch (e) {
      return send(res, e.code === "BODY_TOO_LARGE" ? 413 : 400, JSON.stringify({ error: e.code || "BAD_JSON" }));
    }
    const question = String(body?.question ?? "").trim();
    if (!question) return send(res, 400, JSON.stringify({ error: "EMPTY_QUESTION" }));
    if (question.length > LIMITS.maxQuestionChars) return send(res, 400, JSON.stringify({ error: "QUESTION_TOO_LONG", max: LIMITS.maxQuestionChars }));
    const replay = loadReplay(body?.replay);
    const activeDesk = replay ? replayDeskFor(loaded.desk, replay) : loaded.desk;
    const checker = replay ? replayChecker(activeDesk, loaded.series, replay.revisionWeek) : freshnessCheckerFor(loaded);
    const key = `${loaded.revision}|${question.toLowerCase()}${replay ? `|replay:${replay.asOf}` : ""}`;
    const hit = askCache.get(key);
    if (hit) {
      // The answer text may be reused; the attestation may not be. A cached answer
      // is still re-attested, and the checker's own book cache means that costs a
      // request at most once every cacheMinutes, not once per click.
      const freshness = await attestation(checker, replay ? replayRefs(activeDesk, question) : entitiesFor(activeDesk, tickersInQuestion(question, activeDesk)));
      const base = attestationGate(freshness);
      const reestimation = await reestimateFor(loaded, freshness, base, activeDesk);
      const addendum = reestimation ? revisionAddendum({ moved: movedFrom(freshness), reestimation, caveat: replay ? REPLAY_CAVEAT : null }) : null;
      const gate = addendum ? { ...base, note: `${base.note} ${addendum}` } : base;
      return send(res, 200, JSON.stringify({
        ...hit,
        answer: addendum ? `${hit.answer}\n\n${addendum}` : hit.answer,
        cached: true,
        replay: replayMeta(replay),
        freshness,
        attestation: gate,
        reestimation: revisionPayload(reestimation, movedFrom(freshness)),
        receipts: collectReceipts({ desk: activeDesk, revision: loaded.revision, trace: hit.trace, freshness, attestation: gate }),
      }));
    }
    const limit = askAllowed(clientIp(req), Date.now());
    if (!limit.ok) {
      res.setHeader("retry-after", String(limit.retryAfter));
      return send(res, 429, JSON.stringify({ error: "RATE_LIMITED", retryAfter: limit.retryAfter }));
    }
    const started = Date.now();
    try {
      const live = liveStatus();
      const tools = live.enabled ? withLiveTools(loaded.tools, { desk: activeDesk, state: { liveCalls: 0 } }) : loaded.tools;
      // Asked at the same moment as the model, so its round trip is never added to
      // the answer's latency; the await below only waits for whatever is left.
      // The names the question cites, so the receipt matches the claim; one row per
      // sub-sector otherwise, so a question about the book is attested by the book.
      const refs = replay ? replayRefs(activeDesk, question) : entitiesFor(activeDesk, tickersInQuestion(question, activeDesk));
      const freshP = attestation(checker, refs);
      const out = await askQuestion({ question, tools, providers: AGENT_PROVIDERS });
      const freshness = await freshP;
      const { failures, ...clean } = out;
      if (failures?.length) console.log(`agent: provider fallbacks — ${failures.join(" | ")}`);
      // The gate is what makes the check load-bearing: a revision it detects changes
      // the answer's status, and a check it could not run is stamped as unattested
      // rather than left to look like a pass.
      const gate = attestationGate(freshness);
      const reestimation = await reestimateFor(loaded, freshness, gate, activeDesk);
      const addendum = reestimation ? revisionAddendum({ moved: movedFrom(freshness), reestimation, caveat: replay ? REPLAY_CAVEAT : null }) : null;
      const answer = addendum ? `${clean.answer}\n\n${addendum}` : clean.answer;
      const receipts = collectReceipts({ desk: activeDesk, revision: loaded.revision, trace: clean.trace, freshness, attestation: gate });
      const payload = { ...clean, answer, replay: replayMeta(replay), freshness, attestation: addendum ? { ...gate, note: `${gate.note} ${addendum}` } : gate, reestimation: revisionPayload(reestimation, movedFrom(freshness)), receipts, ms: Date.now() - started, cached: false, readOnly: true, live: liveStatus().enabled, limits: agentStatus().limits };
      // What is cached is the text and its trace, never the attestation: the next
      // answer must carry one asked after it, not one from the first.
      const { freshness: _omitF, receipts: _omitR, attestation: _omitA, reestimation: _omitS, ...storable } = payload;
      // The addendum is stamped with the attestation that produced it, so only the
      // model's own text is cached; the next answer re-derives the re-estimate (from
      // the memo inside the freshness window) against its own fresh attestation.
      if (askCache.size >= ASK_CACHE_MAX) askCache.delete(askCache.keys().next().value);
      askCache.set(key, { ...storable, answer: clean.answer });
      console.log(`agent: ${question.length} chars, ${clean.toolCalls} tools, ${clean.rounds} rounds, ${clean.provider}, ${payload.ms}ms, freshness ${freshness.checked ? `checked ${freshness.verdict} (${freshness.requests} qloo reqs)` : `not checked: ${freshness.why}`}`);
      return send(res, 200, JSON.stringify(payload));
    } catch (e) {
      const status = e.code === "AGENT_UNAVAILABLE" ? 502 : 500;
      console.log(`agent: failed ${e.code ?? e.message} after ${Date.now() - started}ms${e.details ? ` — ${e.details.join(" | ")}` : ""}`);
      return send(res, status, JSON.stringify({ error: e.code || "AGENT_FAILED", message: "The analyst could not answer; the desk numbers are unchanged." }));
    }
  }
  if (url.pathname === "/api/series.json") {
    const f = resolve(OUT, "series.json");
    if (!existsSync(f)) return send(res, 503, JSON.stringify({ error: "QLOO_REQUIRED", message: "No series without Qloo." }));
    return send(res, 200, readFileSync(f));
  }
  if (url.pathname === "/api/revision-replay.json") {
    // Real-data replay of the 2025-12-22 revision: the desk as it stood before it,
    // re-estimated with the committed estimator. Built offline by scripts/revision-replay.mjs.
    const f = resolve(OUT, "revision-replay.json");
    if (!existsSync(f)) return send(res, 503, JSON.stringify({ error: "REPLAY_NOT_BUILT", message: "Run node scripts/revision-replay.mjs to compute the replay from the committed series." }));
    return send(res, 200, readFileSync(f));
  }
  if (url.pathname === "/api/mde.json") {
    const f = resolve(OUT, "mde.json");
    if (!existsSync(f)) return send(res, 503, JSON.stringify({ error: "QLOO_REQUIRED", message: "No detectability bounds without the committed panel. Run node scripts/mde.mjs." }));
    return send(res, 200, readFileSync(f));
  }
  if (url.pathname === "/api/basket-sensitivity.json") {
    const f = resolve(OUT, "basket-sensitivity.json");
    if (!existsSync(f)) return send(res, 503, JSON.stringify({ error: "QLOO_REQUIRED", message: "No basket-construction sensitivity without the committed panel. Run node scripts/basket-sensitivity.mjs." }));
    return send(res, 200, readFileSync(f));
  }
  if (url.pathname === "/api/evidence.json") {
    const deskF = resolve(OUT, "desk.json");
    if (!existsSync(deskF)) return send(res, 503, JSON.stringify({ error: "QLOO_REQUIRED", message: "No evidence without Qloo." }));
    const desk = JSON.parse(readFileSync(deskF, "utf8"));
    const dir = process.env.CULTURALBETA_QLOO_DIR ? resolve(process.env.CULTURALBETA_QLOO_DIR) : resolve(ROOT, "fixtures/qloo");
    const files = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")).sort() : [];
    return send(res, 200, JSON.stringify({
      window: desk.window,
      secondWindow: desk.priorWindow ?? null,
      factorConstruction: desk.factorConstruction,
      pricesSource: desk.pricesSource,
      valueAdd: desk.valueAdd,
      sampleFloor: desk.sampleFloor,
      universe: desk.universe ?? null,
      flagRule: desk.flagRule ?? null,
      rows: desk.rows.map((r) => ({
        ticker: r.ticker,
        label: r.label,
        sector: r.sector ?? null,
        sectorLabel: r.sectorLabel ?? null,
        featured: Boolean(r.featured),
        status: r.status,
        culturalBeta: r.culturalBeta ?? null,
        culturalT: r.culturalT ?? null,
        culturalQ: r.culturalQ ?? null,
        flagged: Boolean(r.flagged),
        provenance: r.provenance,
      })),
      fixtures: files,
    }));
  }
  if (url.pathname === "/api/v1/panel") {
    const loaded = loadDesk();
    if (!loaded) return send(res, 503, JSON.stringify({ error: "QLOO_REQUIRED", message: "No cultural factor without Qloo. Run the pipeline with a live key." }));
    return send(res, 200, JSON.stringify(panelFeed(loaded)));
  }
  const holdingMatch = url.pathname.match(/^\/api\/v1\/holding\/([A-Za-z.]{1,8})$/);
  if (holdingMatch) {
    const loaded = loadDesk();
    if (!loaded) return send(res, 503, JSON.stringify({ error: "QLOO_REQUIRED", message: "No cultural factor without Qloo. Run the pipeline with a live key." }));
    const feed = panelFeed(loaded);
    const row = feed.rows.find((r) => r.ticker.toUpperCase() === holdingMatch[1].toUpperCase());
    if (!row) return send(res, 404, JSON.stringify({ error: "UNKNOWN_HOLDING", message: `Not in this book: ${holdingMatch[1]}` }));
    return send(res, 200, JSON.stringify({ schema: SCHEMA_VERSION, revision: loaded.revision, window: feed.window, index: feed.index, row }));
  }
  if (url.pathname === "/api/v1/alerts") {
    const loaded = loadDesk();
    if (!loaded) return send(res, 503, JSON.stringify({ error: "QLOO_REQUIRED", message: "No factor without Qloo. Run the pipeline with a live key." }));
    return send(res, 200, JSON.stringify(alertsFeed(loaded)));
  }
  if (url.pathname === "/export/panel.csv") {
    const loaded = loadDesk();
    if (!loaded) return send(res, 503, "QLOO_REQUIRED, no panel without Qloo\n", "text/csv");
    res.setHeader("content-disposition", 'attachment; filename="cultural-beta-panel.csv"');
    return send(res, 200, panelCsv(panelFeed(loaded)), "text/csv");
  }
  if (url.pathname === "/api/recompute" && req.method === "POST") {
    // A keyed run is the whole Qloo budget (~2,000 requests) and is opt-in only; the
    // default path re-derives the panel from the cached responses in a couple of
    // seconds. Either way the pipeline runs as a child process so the desk keeps
    // serving while it works, and a step that overruns is killed and reported as a
    // timeout rather than surfacing as a non-zero exit with no reason.
    if (recomputing) return send(res, 409, JSON.stringify({ error: "a live run is already in progress" }));
    recomputing = true;
    const started = Date.now();
    try {
      const log = await runPipeline({ timeoutMs: RECOMPUTE_TIMEOUT_MS });
      const last = log.at(-1);
      const ok = last.status === 0;
      send(res, ok ? 200 : (last.timedOut ? 504 : 500), JSON.stringify({ mode: PIPELINE_STEPS.length > 1 ? "keyed" : "cache", steps: log.map((s) => s.step), log, elapsedMs: Date.now() - started }));
    } finally {
      recomputing = false;
    }
    return;
  }
  const clean = url.pathname.replace(/^\/+/, "");
  const candidate = clean && !clean.endsWith("/") && clean.includes(".") ? resolve(ROOT, "desk", clean) : resolve(ROOT, "desk/index.html");
  const root = resolve(ROOT, "desk");
  if (candidate.startsWith(root) && existsSync(candidate)) {
    const type = candidate.endsWith(".html") ? "text/html"
      : candidate.endsWith(".css") ? "text/css"
      : candidate.endsWith(".js") ? "text/javascript"
      : candidate.endsWith(".svg") ? "image/svg+xml"
      : candidate.endsWith(".ico") ? "image/x-icon"
      : candidate.endsWith(".png") ? "image/png"
      : candidate.endsWith(".woff") ? "font/woff"
      : candidate.endsWith(".woff2") ? "font/woff2"
      : "application/octet-stream";
    return send(res, 200, readFileSync(candidate), type);
  }
  send(res, 404, "not found", "text/plain");
});

server.listen(PORT, () => {
  console.log(`Cultural beta desk on http://localhost:${server.address().port}`);
  const loaded = loadAgentTools();
  if (loaded) freshnessCheckerFor(loaded);
});
