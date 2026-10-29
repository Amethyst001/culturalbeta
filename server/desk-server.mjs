// Desk backend. Holds the Qloo key server-side (never shipped to the browser).
// GET  /api/desk.json -> committed computation, or a refusal if Qloo data absent.
// POST /api/recompute -> runs the live pipeline (needs QLOO_API_KEY in .env).
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { ROOT } from "../src/env.mjs";

const PORT = Number(process.env.PORT || 8787);

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
  const file = url.pathname === "/" ? "desk/index.html" : `desk${url.pathname}`;
  const f = resolve(ROOT, file);
  if (f.startsWith(resolve(ROOT, "desk")) && existsSync(f)) {
    const type = f.endsWith(".html") ? "text/html" : f.endsWith(".css") ? "text/css" : "text/javascript";
    return send(res, 200, readFileSync(f), type);
  }
  send(res, 404, "not found", "text/plain");
});

server.listen(PORT, () => console.log(`Cultural beta desk on http://localhost:${PORT}`));
