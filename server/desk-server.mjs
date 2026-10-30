// Desk backend. Holds the Qloo key server-side (never shipped to the browser).
// GET  /api/desk.json        -> committed computation, or a refusal if Qloo data absent.
// GET  /api/v1/panel         -> versioned feed of the same numbers, for ingestion.
// GET  /api/v1/holding/:tick -> one holding.
// GET  /api/v1/alerts        -> the panel read as a watchlist: which names would fire, and why none does.
// GET  /export/panel.csv     -> the panel as a spreadsheet.
// GET  /api/agent.json       -> whether the analyst agent is configured, and its limits.
// POST /api/ask              -> the analyst agent over the committed panel (read-only, no Qloo spend).
// POST /api/recompute        -> runs the live pipeline (needs QLOO_API_KEY in .env).
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { ROOT } from "../src/env.mjs";
import { ols } from "../src/ols.mjs";
import { loadUniverse } from "../src/universe.mjs";
import { computeBudget, spentFromCache } from "../src/budget.mjs";
import { createDeskTools, readProviders, askQuestion, LIMITS } from "../src/agent.mjs";
import { withLiveTools, liveStatus } from "../src/live-qloo.mjs";

const PORT = Number(process.env.PORT || 8787);
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

function productRow(r) {
  const ok = r.status === "ok";
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
    oosDeltaR2: ok ? r.oos?.deltaR2 ?? null : null,
    oosDeltaR2FixedLo: ok ? r.oosFixed?.lo ?? null : null,
    oosDeltaR2FixedHi: ok ? r.oosFixed?.hi ?? null : null,
    oosDeltaR2RefitLo: ok ? r.oosRefit?.lo ?? null : null,
    oosDeltaR2RefitHi: ok ? r.oosRefit?.hi ?? null : null,
    // Which of the two intervals the grade uses for this row: the wider one. A
    // single field so a downstream consumer cannot quietly pick the narrow one.
    oosClaimInterval: ok ? claimInterval(r) : null,
    placeboP: ok ? r.placeboP ?? null : null,
    culturalQ: ok ? r.culturalQ ?? null : null,
    flagged: ok ? Boolean(r.flagged) : null,
    flagRule: "negative cultural beta, |t| >= 2, Benjamini-Hochberg q <= 0.10 across the book",
    audience: ok && r.audience ? {
      culturalBeta: r.audience.culturalBeta,
      culturalT: r.audience.culturalT,
      oosDeltaR2: r.audience.oos?.deltaR2 ?? null,
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
    rows: desk.rows.map(productRow),
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
    if (oosTestable === false) reasons.push(`the held-out slice is frozen for every name at this Qloo vintage (last revision ${sc.lastMove})`);
    else if (!(r.oos?.deltaR2 > 0)) reasons.push("no out-of-sample support for this name");
    if (!(bookP !== null && bookP <= BOOK_P_MAX)) reasons.push("book placebo is not separable at p <= 0.10");
    const base = {
      ticker: r.ticker,
      label: r.label,
      culturalBeta: r.culturalBeta,
      culturalT: r.culturalT,
      oosDeltaR2: r.oos?.deltaR2 ?? null,
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
        oosTestable === false ? `the held-out slice is frozen for every name (last Qloo revision ${sc.lastMove})` : null,
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
  // Book-level, repeated per row so a spreadsheet cannot read oosDeltaR2 as a
  // test result without the field that says whether the slice could test anything.
  const testable = feed.valueAdd?.oos?.scoring?.testable ?? null;
  const head = CSV_COLUMNS.join(",");
  const body = feed.rows.map((r) => CSV_COLUMNS.map((c) => csvCell(
    c === "oosTestable" ? testable
      : c === "resolutionClass" ? r.resolution?.failure ?? null
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
let agentToolsCache = { stamp: "", tools: null };

function agentStatus() {
  return {
    configured: AGENT_PROVIDERS.length > 0,
    providers: AGENT_PROVIDERS.map((p) => p.label),
    readOnly: true,
    live: liveStatus(),
    limits: {
      questionChars: LIMITS.maxQuestionChars,
      toolCalls: LIMITS.maxToolCalls,
      rounds: LIMITS.maxRounds,
      perHour: ASK_PER_HOUR,
      minGapMs: ASK_MIN_GAP_MS,
    },
    note: liveStatus().enabled
      ? "The analyst reads the committed panel, and may spend one bounded live Qloo read per answer. It cannot run the pipeline or change a number."
      : "The analyst reads the committed panel and the Qloo responses behind it. It cannot run the pipeline, spend a Qloo request, or change a number.",
  };
}

function loadAgentTools() {
  const loaded = loadDesk();
  if (!loaded) return null;
  const sf = resolve(OUT, "series.json");
  const stamp = `${loaded.revision}|${existsSync(sf) ? statSync(sf).mtime.toISOString() : "no-series"}`;
  if (agentToolsCache.stamp !== stamp) {
    const series = existsSync(sf) ? JSON.parse(readFileSync(sf, "utf8")) : {};
    agentToolsCache = { stamp, tools: createDeskTools({ desk: loaded.desk, series }) };
  }
  return { tools: agentToolsCache.tools, revision: loaded.revision, desk: loaded.desk };
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
    const key = `${loaded.revision}|${question.toLowerCase()}`;
    const hit = askCache.get(key);
    if (hit) return send(res, 200, JSON.stringify({ ...hit, cached: true }));
    const limit = askAllowed(clientIp(req), Date.now());
    if (!limit.ok) {
      res.setHeader("retry-after", String(limit.retryAfter));
      return send(res, 429, JSON.stringify({ error: "RATE_LIMITED", retryAfter: limit.retryAfter }));
    }
    const started = Date.now();
    try {
      const live = liveStatus();
      const tools = live.enabled ? withLiveTools(loaded.tools, { desk: loaded.desk, state: { liveCalls: 0 } }) : loaded.tools;
      const out = await askQuestion({ question, tools, providers: AGENT_PROVIDERS });
      const { failures, ...clean } = out;
      if (failures?.length) console.log(`agent: provider fallbacks — ${failures.join(" | ")}`);
      const payload = { ...clean, ms: Date.now() - started, cached: false, readOnly: true, live: liveStatus().enabled, limits: agentStatus().limits };
      if (askCache.size >= ASK_CACHE_MAX) askCache.delete(askCache.keys().next().value);
      askCache.set(key, payload);
      console.log(`agent: ${question.length} chars, ${clean.toolCalls} tools, ${clean.rounds} rounds, ${clean.provider}, ${payload.ms}ms`);
      return send(res, 200, JSON.stringify(payload));
    } catch (e) {
      const status = e.code === "AGENT_UNAVAILABLE" ? 502 : 500;
      console.log(`agent: failed ${e.code ?? e.message} after ${Date.now() - started}ms`);
      return send(res, status, JSON.stringify({ error: e.code || "AGENT_FAILED", message: "The analyst could not answer; the desk numbers are unchanged." }));
    }
  }
  if (url.pathname === "/api/series.json") {
    const f = resolve(OUT, "series.json");
    if (!existsSync(f)) return send(res, 503, JSON.stringify({ error: "QLOO_REQUIRED", message: "No series without Qloo." }));
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
      : candidate.endsWith(".woff") ? "font/woff"
      : candidate.endsWith(".woff2") ? "font/woff2"
      : "application/octet-stream";
    return send(res, 200, readFileSync(candidate), type);
  }
  send(res, 404, "not found", "text/plain");
});

server.listen(PORT, () => console.log(`Cultural beta desk on http://localhost:${server.address().port}`));
