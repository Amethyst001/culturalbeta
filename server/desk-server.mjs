// Desk backend. Holds the Qloo key server-side (never shipped to the browser).
// GET  /api/desk.json -> committed computation, or a refusal if Qloo data absent.
// POST /api/recompute -> runs the live pipeline (needs QLOO_API_KEY in .env).
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { ROOT } from "../src/env.mjs";
import { ols } from "../src/ols.mjs";

const PORT = Number(process.env.PORT || 8787);

function marketOnly() {
  const prices = JSON.parse(readFileSync(resolve(ROOT, "fixtures/prices.json"), "utf8"));
  const book = JSON.parse(readFileSync(resolve(ROOT, "config/book.json"), "utf8"));
  const idx = prices.symbols[book.index.ticker].returns;
  const rows = book.holdings.map((h) => {
    const reg = ols(prices.symbols[h.ticker].returns, [idx]);
    return { ticker: h.ticker, label: h.label, weeks: reg.n, marketBeta: reg.beta[1], marketSE: reg.se[1], marketT: reg.t[1], marketP: reg.p[1], r2: reg.r2 };
  });
  const { alignedDates, ...window } = prices.window;
  return { mode: "market-only", window, pricesSource: prices.source, index: book.index, rows };
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/api/desk.json") {
    const f = resolve(ROOT, "output/desk.json");
    if (!existsSync(f)) return send(res, 503, JSON.stringify({ error: "QLOO_REQUIRED", message: "No cultural factor without Qloo. Run the fetch scripts with a live key." }));
    return send(res, 200, readFileSync(f));
  }
  if (url.pathname === "/api/market-only.json") {
    return send(res, 200, JSON.stringify(marketOnly()));
  }
  if (url.pathname === "/api/series.json") {
    const f = resolve(ROOT, "output/series.json");
    if (!existsSync(f)) return send(res, 503, JSON.stringify({ error: "QLOO_REQUIRED", message: "No series without Qloo." }));
    return send(res, 200, readFileSync(f));
  }
  if (url.pathname === "/api/evidence.json") {
    const deskF = resolve(ROOT, "output/desk.json");
    if (!existsSync(deskF)) return send(res, 503, JSON.stringify({ error: "QLOO_REQUIRED", message: "No evidence without Qloo." }));
    const desk = JSON.parse(readFileSync(deskF, "utf8"));
    const dir = process.env.CULTURALBETA_QLOO_DIR ? resolve(process.env.CULTURALBETA_QLOO_DIR) : resolve(ROOT, "fixtures/qloo");
    const files = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")).sort() : [];
    return send(res, 200, JSON.stringify({ window: desk.window, factorConstruction: desk.factorConstruction, pricesSource: desk.pricesSource, rows: desk.rows.map((r) => ({ ticker: r.ticker, status: r.status, provenance: r.provenance })), fixtures: files }));
  }
  if (url.pathname === "/api/recompute" && req.method === "POST") {
    const steps = ["scripts/qloo-map.mjs", "scripts/qloo-trending.mjs", "scripts/qloo-affinity.mjs", "scripts/compute-betas.mjs"];
    const log = [];
    for (const s of steps) {
      const r = spawnSync(process.execPath, [resolve(ROOT, s)], { encoding: "utf8", cwd: ROOT, timeout: 120000 });
      log.push({ step: s, status: r.status, out: (r.stdout ?? "").slice(0, 2000), err: (r.stderr ?? "").slice(0, 2000) });
      if (r.status !== 0) break;
    }
    const last = log.at(-1);
    return send(res, last.status === 0 ? 200 : 500, JSON.stringify({ log }));
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

server.listen(PORT, () => console.log(`Cultural beta desk on http://localhost:${PORT}`));
