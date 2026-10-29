// Automated UI + functionality audit. Drives a real headless Chrome over CDP,
// checks layout, copy, accessibility basics, routing and the no-fake-number
// guard at desktop and phone widths, and saves screenshots as evidence.
//
// usage: node scripts/audit.mjs [--url http://localhost:8788] [--out review]
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { ROOT } from "../src/env.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const URL_BASE = arg("url", "http://localhost:8788");
const OUT = resolve(ROOT, arg("out", "review"));
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const shotDir = resolve(OUT, `shots-${stamp}`);
mkdirSync(shotDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startChrome() {
  const profile = mkdtempSync(resolve(tmpdir(), "cb-audit-"));
  const child = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error("chrome did not report a DevTools endpoint in 15s")), 15000);
    let buf = "";
    child.stderr.on("data", (c) => {
      buf += c;
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) { clearTimeout(timer); ok({ child, browserWs: m[1], profile }); }
    });
    child.on("exit", (code) => fail(new Error(`chrome exited early (${code})`)));
  });
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { ok, fail } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
        return;
      }
      if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") this.errors.push(msg.params.entry.text);
      if (msg.method === "Runtime.exceptionThrown") this.errors.push(msg.params.exceptionDetails?.exception?.description || "exception");
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }));
  }
}

async function connectPage(browserWs) {
  const { port } = new URL(browserWs);
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.addEventListener("open", ok); ws.addEventListener("error", fail); });
  const cdp = new CDP(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: "window.__auditErrs=[];addEventListener('error',e=>window.__auditErrs.push(String(e.message)));addEventListener('unhandledrejection',e=>window.__auditErrs.push('unhandled: '+String(e.reason)));",
  });
  return { cdp, ws };
}

const AUDIT_JS = String.raw`(async () => {
  await document.fonts.ready;
  await new Promise(r => setTimeout(r, 500));
  const out = [];
  const add = (id, ok, detail) => out.push({ id, ok: !!ok, detail: String(detail ?? "").slice(0, 220) });
  const vw = window.innerWidth, vh = window.innerHeight;
  const view = document.querySelector("#view") || document.body;

  add("no-horizontal-overflow", document.documentElement.scrollWidth <= vw + 1, "scrollWidth " + document.documentElement.scrollWidth + " / viewport " + vw);
  const h1 = view.querySelector("h1, h2");
  const h1f = h1 ? getComputedStyle(h1) : null;
  add("type-hierarchy", h1f && h1f.fontFamily.includes("Georgia") && parseFloat(h1f.fontSize) >= (vw < 600 ? 28 : 38),
    h1f ? h1f.fontFamily + " " + h1f.fontSize : "no headline");
  const errs = (window.__auditErrs || []).slice();
  window.__auditErrs = [];
  add("page-errors", errs.length === 0, errs.join(" | ") || "none");
  add("headline-present", !!view.querySelector("h1, h2"), (view.querySelector("h1, h2") || {}).textContent?.trim().slice(0, 48));
  add("window-label", /106 weeks/.test(view.innerText), (view.innerText.match(/\d+ weeks[^·\n]*/) || ["missing"])[0]);
  const holdingsTable = view.querySelector('table[data-audit="holdings"]');
  const rows = holdingsTable ? holdingsTable.querySelectorAll("tbody tr").length : 0;
  add("seven-holdings", rows === 0 || rows === 7, rows + " rows");
  add("tabs-present", [...document.querySelectorAll(".tabs a")].filter((a) => !a.hidden).length >= 2 && !!document.querySelector(".tabs a.on"),
    [...document.querySelectorAll(".tabs a")].filter((a) => !a.hidden).length + " visible tabs");
  add("no-placeholder-copy", !/lorem ipsum|TODO|FIXME|placeholder|TEST-/i.test(view.innerText), "placeholder sweep");
  const onDesk = location.hash === "" || location.hash === "#/" || location.hash.startsWith("#/holding/");
  if (onDesk) add("value-add-slot", /ΔR²/.test(view.innerText), "ΔR² slot present");

  // the cold state must not hide its refusal inside a hero block
  const notice = view.querySelector(".notice");
  const mode = document.body.dataset.mode;
  if (mode === "cold" && (location.hash === "" || location.hash === "#/")) {
    const h = notice ? notice.getBoundingClientRect().height : 0;
    add("no-refusal-hero", !notice || h <= 130, notice ? "notice height " + Math.round(h) + "px" : "no notice");
    const cult = [...view.querySelectorAll('td[data-c="cultural"]')];
    add("cold-cultural-withheld", cult.length > 0 && cult.every((td) => /withheld/i.test(td.innerText) && !/\d\.\d/.test(td.innerText)),
      cult.length ? cult.length + " cells" : "no cultural cells");
    // every cultural cell in the refusal state must say withheld, never a number
    const tw = view.querySelector(".tw");
    const twText = tw ? tw.innerText : "";
    const fakeZero = /(^|\s)[+-]?0\.00(\s|$)/.test(twText);
    add("no-fabricated-zero", !fakeZero, fakeZero ? "0.00 present" : "no zero beta");
    // the cold desk must name the robustness work that the keyed run will print
    add("cold-explains-robustness", /out[- ]of[- ]sample/i.test(view.innerText) && /placebo/i.test(view.innerText),
      "out-of-sample + placebo named");
    add("impact-block", !!view.querySelector(".use"), view.querySelector(".use") ? "how-it-is-used present" : "missing");
  }
  // live state: both robustness tests must render with a value, not a dash
  if (mode === "live" && (location.hash === "" || location.hash === "#/")) {
    const tests = [...view.querySelectorAll(".rb-test")];
    const vals = tests.map((t) => t.querySelector(".rb-v")?.innerText.trim() || "");
    add("robustness-band", tests.length === 2 && vals.every((v) => v && v !== "—" && v !== "p —"),
      tests.length + " tests: " + vals.join(" · "));
  }

  // contrast of secondary text against its background
  const lum = (c) => { const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const muted = view.querySelector(".muted, .name, .ticklabel");
  if (muted) {
    const cs = getComputedStyle(muted);
    let bgEl = muted, bg = "rgba(0, 0, 0, 0)";
    while (bgEl && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) { bg = getComputedStyle(bgEl).backgroundColor; bgEl = bgEl.parentElement; }
    const cr = ratio(cs.color, bg);
    add("contrast-secondary", cr >= 4.5, cr.toFixed(2) + ":1 " + cs.color + " on " + bg);
  }

  // tap targets (phone only matters, measured anyway)
  const small = [...view.querySelectorAll("a, button")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.height < 28;
  });
  add("tap-targets", small.length === 0, small.map((e) => (e.textContent.trim().slice(0, 14) || e.className) + ":" + Math.round(e.getBoundingClientRect().height) + "px").join(", "));

  // table semantics
  const table = view.querySelector("table");
  if (table) {
    const th = table.querySelectorAll("thead th").length;
    const firstRowCells = table.querySelectorAll("tbody tr")[0]?.children.length ?? 0;
    add("table-headers-match", th === firstRowCells, th + " th vs " + firstRowCells + " cells");
    add("numeric-alignment", [...table.querySelectorAll("tbody td.num")].every((td) => getComputedStyle(td).textAlign === "right"), "right-aligned numerals");
  }
  return { checks: out, vw, vh, scrollWidth: document.documentElement.scrollWidth, text: view.innerText.slice(0, 400) };
})()`;

const ROUTES = [
  { hash: "#/", name: "desk" },
  { hash: "#/map", name: "map" },
  { hash: "#/evidence", name: "evidence" },
  { hash: "#/holding/ELF", name: "holding" },
];
const VIEWPORTS = [
  { width: 1440, height: 1100, name: "desktop" },
  { width: 768, height: 1024, name: "tablet", mobile: true },
  { width: 390, height: 844, name: "phone", mobile: true },
];

const { child, browserWs, profile } = await startChrome();
const results = [];
try {
  const { cdp, ws } = await connectPage(browserWs);
  for (const vp of VIEWPORTS) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: Boolean(vp.mobile) });
    for (const route of ROUTES) {
      await cdp.send("Page.navigate", { url: `${URL_BASE}/${route.hash}` });
      await sleep(1400);
      const res = await cdp.send("Runtime.evaluate", { expression: AUDIT_JS, awaitPromise: true, returnByValue: true });
      const value = res.result?.value ?? { checks: [{ id: "evaluate", ok: false, detail: res.exceptionDetails?.text || "no value" }] };
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
      const file = resolve(shotDir, `${vp.name}-${route.name}.png`);
      writeFileSync(file, Buffer.from(shot.data, "base64"));
      if (route.name === "desk") {
        const full = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
        writeFileSync(resolve(shotDir, `${vp.name}-${route.name}-full.png`), Buffer.from(full.data, "base64"));
      }
      results.push({ viewport: vp.name, route: route.name, checks: value.checks, screenshot: file.replace(/\\/g, "/"), consoleErrors: cdp.errors.splice(0) });
      console.log(`${vp.name}/${route.name}: ${value.checks.filter((c) => c.ok).length}/${value.checks.length} checks`);
    }
  }
  ws.close();
} finally {
  child.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}

const all = results.flatMap((r) => r.checks.map((c) => ({ ...c, viewport: r.viewport, route: r.route })));
const failed = all.filter((c) => !c.ok);
const pct = Math.round((all.length - failed.length) / all.length * 100);
const lines = [
  `# UI + functionality audit — ${new Date().toISOString()}`,
  "",
  `Target: ${URL_BASE} · viewports: ${VIEWPORTS.map((v) => v.width + "px").join(", ")} · routes: ${ROUTES.map((r) => r.hash).join(" ")}`,
  "",
  `**${all.length - failed.length}/${all.length} checks pass (${pct}%).**`,
  "",
  "## Failures",
  failed.length ? failed.map((c) => `- \`${c.viewport}/${c.route}/${c.id}\` — ${c.detail}`).join("\n") : "- none",
  "",
  "## Checks by route",
  ...results.map((r) => `\n### ${r.viewport} · ${r.route}\n` + r.checks.map((c) => `- ${c.ok ? "PASS" : "FAIL"} \`${c.id}\` — ${c.detail}`).join("\n") + (r.consoleErrors.length ? `\n- console: ${r.consoleErrors.join(" | ")}` : "")),
  "",
  "## Evidence",
  ...results.map((r) => `- ${r.screenshot}`),
];
writeFileSync(resolve(OUT, `audit-${stamp}.md`), lines.join("\n"));
writeFileSync(resolve(OUT, `audit-${stamp}.json`), JSON.stringify({ stamp, target: URL_BASE, results }, null, 1));
console.log(`\n${all.length - failed.length}/${all.length} checks pass. Saved ${resolve(OUT, `audit-${stamp}.md`)}`);
if (failed.length) process.exitCode = 1;
