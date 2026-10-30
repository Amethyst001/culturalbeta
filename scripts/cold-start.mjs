#!/usr/bin/env node
// Cold-start / warm-latency measurement for the Cultural Beta desk.
//
// Default run spends ZERO Qloo requests: it boots its own desk instances with the
// live gate forced off (AGENT_LIVE_QLOO=0), so neither the boot prime nor /api/ask
// can reach Qloo, and the answers it measures are model-provider round trips and
// cached/local paths only. The live Qloo freshness attestation is exercised ONLY
// under --live, and even then it rides the shared server's page cache (a replay,
// 0 requests) — it never forces a re-pull.
//
// Usage:
//   node scripts/cold-start.mjs            # boot + warm routes + ask latency, no Qloo
//   node scripts/cold-start.mjs --live     # + observe the freshness attestation on a
//                                          #   live-gate deployment (default http://127.0.0.1:8811)
//   --base <url>   shared live-gate server for --live (must have live gate on)
//   --runs <n>     samples per measurement for the median (default 3)
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? dflt : argv[i + 1];
};
const LIVE = argv.includes("--live");
const RUNS = Math.max(1, Number(flag("runs", 3)) || 3);
const BASE = flag("base", "http://127.0.0.1:8811");
const BUDGET_FILE = resolve(ROOT, "output/live-qloo-budget.json");
const DESK_FILE = resolve(ROOT, "output/desk.json");

const readBudget = () => {
  try { return JSON.parse(readFileSync(BUDGET_FILE, "utf8")); } catch { return null; }
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const round1 = (x) => Math.round(x * 10) / 10;

// Time a single GET: full body download, wall clock in ms.
async function timedGet(url) {
  const t = performance.now();
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  return { ms: performance.now() - t, bytes: buf.length, status: res.status };
}

async function medianGet(url) {
  const samples = [];
  let bytes = 0, status = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = await timedGet(url);
    samples.push(r.ms); bytes = r.bytes; status = r.status;
  }
  return { median_ms: round1(median(samples)), samples_ms: samples.map(round1), bytes, status };
}

async function askOnce(base, question) {
  const t = performance.now();
  const res = await fetch(`${base}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const j = await res.json().catch(() => ({}));
  return {
    wall_ms: round1(performance.now() - t),
    status: res.status,
    server_ms: j.ms ?? null,
    cached: j.cached ?? null,
    provider: j.provider ?? null,
    rounds: j.rounds ?? null,
    tool_calls: j.toolCalls ?? null,
    answer_chars: (j.answer || "").length,
    freshness: j.freshness ? {
      checked: j.freshness.checked ?? false,
      why: j.freshness.why ?? null,
      requests: j.freshness.requests ?? null,
      pages: j.freshness.pages ?? null,
      fromCachedPage: j.freshness.fromCachedPage ?? null,
      fromCache: j.freshness.fromCache ?? null,
      requestedAt: j.freshness.requestedAt ?? null,
      respondedAt: j.freshness.respondedAt ?? null,
      verdict: j.freshness.verdict ?? null,
    } : null,
    error: j.error ?? null,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Boot one desk instance on an OS-assigned ephemeral port (PORT=0) with the live
// gate forced off, so nothing it does can reach Qloo. PORT=0 makes the listen
// callback log the real port, which sidesteps Windows allowing overlapping binds on
// a fixed port — we always know exactly which instance is ours and can kill only it.
function bootInstance() {
  return new Promise((done, fail) => {
    const t0 = performance.now();
    const child = spawn(process.execPath, [resolve(ROOT, "server/desk-server.mjs")], {
      cwd: ROOT,
      env: { ...process.env, PORT: "0", AGENT_LIVE_QLOO: "0" },
    });
    let buf = "", port = null, tListen = null, settled = false;
    const onData = (c) => {
      buf += c;
      if (tListen === null) {
        const m = buf.match(/Cultural beta desk on http:\/\/localhost:(\d+)/);
        if (m) { port = Number(m[1]); tListen = performance.now(); }
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (c) => { buf += c; });
    child.on("error", fail);
    done({
      child,
      port,
      t0,
      getPort: () => port,
      getTListen: () => tListen,
      waitPort: (timeoutMs = 8000) => new Promise((res, rej) => {
        const start = performance.now();
        const tick = () => {
          if (port) return res(port);
          if (performance.now() - start > timeoutMs) return rej(new Error("boot: no listen log line"));
          setTimeout(tick, 20);
        };
        tick();
      }),
      kill: () => { try { child.kill("SIGKILL"); } catch {} },
    });
  });
}

async function measureBoot() {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const inst = await bootInstance();
    const t0 = inst.t0;
    const port = await inst.waitPort();
    const tListen = inst.getTListen();
    // Poll the real cold endpoint: the first /api/desk.json byte is served only after
    // the listen callback's synchronous loadAgentTools (JSON.parse of desk.json +
    // tool build) releases the single thread, so this measures the boot-blocking cost.
    let tFirst = null;
    const pollStart = performance.now();
    while (tFirst === null && performance.now() - pollStart < 15000) {
      try {
        const r = await timedGet(`http://127.0.0.1:${port}/api/desk.json`);
        if (r.status === 200) tFirst = performance.now();
      } catch { await sleep(20); }
    }
    // Warm first-response: desk.json is now resident, so this is the raw stream cost.
    const warm = [];
    for (let k = 0; k < RUNS; k++) warm.push((await timedGet(`http://127.0.0.1:${port}/api/desk.json`)).ms);
    runs.push({
      module_load_ms: round1(tListen - t0),
      boot_block_ms: round1(tFirst - tListen),
      cold_first_byte_ms: round1(tFirst - t0),
      warm_first_response_ms: round1(median(warm)),
    });
    inst.kill();
    await sleep(200);
  }
  // Isolated desk.json read+parse cost that loadAgentTools and the panel routes pay.
  const parse = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await new Promise((done) => {
      const p = spawn(process.execPath, ["-e",
        `const{readFileSync}=require("fs");const f=${JSON.stringify(DESK_FILE)};` +
        `const s=readFileSync(f,"utf8");const t=process.hrtime.bigint();JSON.parse(s);` +
        `console.log(Number(process.hrtime.bigint()-t)/1e6);`], { cwd: ROOT });
      let o = ""; p.stdout.on("data", (c) => { o += c; }); p.on("close", () => done(o.trim()));
    });
    parse.push(round1(Number(r)));
  }
  return {
    note: "boot measured against own ephemeral-port instances with AGENT_LIVE_QLOO=0 (no Qloo touched). module_load = spawn to listen log. boot_block = the listen callback's synchronous desk.json parse + tool build that gates the first request. cold_first_byte = spawn to first /api/desk.json byte.",
    runs,
    median: {
      module_load_ms: median(runs.map((r) => r.module_load_ms)),
      boot_block_ms: median(runs.map((r) => r.boot_block_ms)),
      cold_first_byte_ms: median(runs.map((r) => r.cold_first_byte_ms)),
      warm_first_response_ms: median(runs.map((r) => r.warm_first_response_ms)),
      desk_json_parse_ms: median(parse),
    },
    desk_json_bytes: existsSync(DESK_FILE) ? readFileSync(DESK_FILE).length : null,
  };
}

const PAGE_LOAD_ROUTES = [
  "/api/desk.json", "/api/series.json", "/api/evidence.json", "/api/market-only.json",
  "/api/budget.json", "/api/agent.json", "/api/freshness.json",
];
const EXTRA_ROUTES = ["/api/v1/alerts", "/api/v1/panel", "/export/panel.csv"];
const STATIC_ROUTES = ["/", "/app.css", "/app.js"];

async function measureRoutes(base) {
  const one = async (p) => ({ route: p, ...(await medianGet(`${base}${p}`)) });
  const pageLoad = [];
  for (const p of PAGE_LOAD_ROUTES) pageLoad.push(await one(p));
  const extra = [];
  for (const p of EXTRA_ROUTES) extra.push(await one(p));
  const stat = [];
  for (const p of STATIC_ROUTES) stat.push(await one(p));
  const all = [...pageLoad, ...extra, ...stat];
  const slowest3 = [...all].sort((a, b) => b.median_ms - a.median_ms).slice(0, 3)
    .map((r) => ({ route: r.route, median_ms: r.median_ms, bytes: r.bytes }));
  // The desk page fetches PAGE_LOAD_ROUTES concurrently in one Promise.all, so the
  // API portion of the critical path is the slowest of them, not their sum.
  const plMax = Math.max(...pageLoad.map((r) => r.median_ms));
  const plSum = pageLoad.reduce((a, r) => a + r.median_ms, 0);
  return {
    note: "warm latency, own gate-off instance, local loopback. page-load routes are fetched in one Promise.all, so the critical path is the max of them, not the sum.",
    page_load_routes: pageLoad,
    extra_routes: extra,
    static_routes: stat,
    slowest_three: slowest3,
    page_load_critical_path_ms: round1(plMax),
    page_load_sum_if_serial_ms: round1(plSum),
    static_bytes_total: stat.reduce((a, r) => a + r.bytes, 0),
  };
}

async function measureAsk(base) {
  // Panel-internal questions: on a gate-off instance no live tool exists, so the
  // only cost is the model round trip. Same question twice shows the answer cache.
  const qA = "Which holdings in the book are flagged with a negative cultural beta that cleared the book-level placebo test?";
  const qB = "What is the cultural beta of the Disney holding DIS?";
  const qC = "What is the out-of-sample delta R-squared for Netflix NFLX?";
  const a1 = await askOnce(base, qA);       // uncached
  const a2 = await askOnce(base, qA);       // cached repeat (cache-hit path skips the rate limiter)
  await sleep(2200);                         // uncached asks are rate-limited to a 2s min gap
  const b1 = await askOnce(base, qB);        // uncached
  await sleep(2200);
  const c1 = await askOnce(base, qC);        // uncached, different again
  const b2 = await askOnce(base, qB);        // cached repeat
  const firsts = [a1, b1, c1].filter((r) => r.status === 200 && r.cached === false).map((r) => r.wall_ms);
  const repeats = [a2, b2].filter((r) => r.status === 200 && r.cached === true).map((r) => r.wall_ms);
  return {
    note: "measured on the gate-off instance: NO Qloo request is spent; the wall time is the model-provider round trip. A repeat of the same question is an answer-cache hit.",
    samples: {
      qA_first: a1, qA_repeat: a2, qB_first: b1, qB_repeat: b2, qC_first: c1,
    },
    first_answer_ms: { median: round1(median(firsts)), samples: firsts },
    repeat_answer_ms: { median: round1(median(repeats)), samples: repeats },
    cache_saving_ms: round1(median(firsts) - median(repeats)),
  };
}

async function measureLive(base) {
  // Only run against a live-gate deployment. The attestation rides the page cache,
  // so a warm shared server spends 0 requests; if its page cache were cold this
  // would spend a bounded live read. Never force it.
  const before = readBudget();
  const peekBody = await fetch(`${base}/api/freshness.json`).then((r) => r.json());
  const q = "Summarise the book-level result: is the cultural taste factor separable from the market, and what is the book placebo p?";
  const answer = await askOnce(base, q);
  const repeat = await askOnce(base, q);
  await sleep(100);
  const after = readBudget();
  const f = answer.freshness || {};
  const probe_ms = f.requestedAt && f.respondedAt
    ? round1(Date.parse(f.respondedAt) - Date.parse(f.requestedAt)) : null;
  return {
    base,
    budget_before: before,
    budget_after: after,
    budget_delta_requests: after && before ? after.requests - before.requests : null,
    budget_delta_ops: after && before ? after.ops - before.ops : null,
    page_load_freshness_peek: {
      checked: peekBody.checked, fromCache: peekBody.fromCache,
      requests: peekBody.requests ?? null, fromCachedPage: peekBody.fromCachedPage ?? null,
    },
    answer, repeat,
    attestation: {
      kind: (f.requests && f.requests > 0) ? "live_read" : (f.fromCachedPage ? "page_cache_replay" : (f.fromCache ? "checker_memory_replay" : "not_checked")),
      requests_spent: f.requests ?? null,
      pages: f.pages ?? null,
      fromCachedPage: f.fromCachedPage ?? null,
      fromCache: f.fromCache ?? null,
      probe_wall_ms: probe_ms,
      verdict: f.verdict ?? null,
    },
  };
}

async function main() {
  const out = {
    generatedAt: new Date().toISOString(),
    mode: LIVE ? "default + live" : "default (cached/local only, no Qloo request)",
    qloo_request_policy: LIVE
      ? "default paths use a gate-off instance (0 Qloo); --live additionally rides the shared server's page cache (expected 0 requests). Delta reported from output/live-qloo-budget.json."
      : "no Qloo request spent: boot/routes/ask run against a gate-off instance (AGENT_LIVE_QLOO=0). The live freshness attestation was NOT exercised; pass --live to observe it.",
    budget_at_start: readBudget(),
  };

  out.boot = await measureBoot();

  // One warm instance for the route + ask sweeps, then shut it down.
  const inst = await bootInstance();
  const port = await inst.waitPort();
  const base = `http://127.0.0.1:${port}`;
  out.instance = { base, note: "own ephemeral-port instance, live gate off" };
  out.warm_routes = await measureRoutes(base);
  out.ask = await measureAsk(base);
  inst.kill();

  // Item 4: /api/ask runs the freshness probe and the model call concurrently
  // (server/desk-server.mjs starts attestation() before awaiting askQuestion).
  const modelMs = median(out.ask.first_answer_ms.samples);
  out.concurrency = {
    concurrent_in_ask: true,
    evidence: "server/desk-server.mjs POST /api/ask: const freshP = attestation(checker) runs before `await askQuestion(...)`, then `await freshP`. Probe and model overlap.",
    model_first_answer_ms: round1(modelMs),
  };
  if (LIVE) {
    out.live = await measureLive(BASE);
    const p = out.live.attestation.probe_wall_ms;
    if (p != null) {
      out.concurrency.probe_replay_ms = p;
      out.concurrency.concurrent_wait_ms = round1(Math.max(modelMs, p));
      out.concurrency.sequential_wait_ms = round1(modelMs + p);
      out.concurrency.saved_by_concurrency_ms = round1(Math.min(modelMs, p));
    }
  } else {
    out.concurrency.probe_replay_ms = null;
    out.concurrency.if_sequential_note =
      "Not re-measured (no --live). From committed evidence: a warm page-cache replay takes ~6.6s (output/live-qloo-budget attestation requestedAt/respondedAt, dominated by the harness version subprocess) and a cold first read ~13-26s with a 45s timeout cap (src/live-qloo.mjs FRESHNESS.timeoutMs, desk-8812.log). Concurrency hides min(model, probe) per non-cached answer; running them sequentially would add the full probe to every answer and push a cold first answer toward model+probe.";
  }

  out.budget_at_end = readBudget();
  out.qloo_budget_delta_requests = (out.budget_at_end && out.budget_at_start)
    ? out.budget_at_end.requests - out.budget_at_start.requests : null;
  out.qloo_budget_delta_ops = (out.budget_at_end && out.budget_at_start)
    ? out.budget_at_end.ops - out.budget_at_start.ops : null;
  console.log(JSON.stringify(out, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
