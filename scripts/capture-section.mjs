// Capture one element at full width by scrolling it into view over CDP.
// usage: node scripts/capture-section.mjs --url http://localhost:8801 --hash "#/evidence" --selector '[aria-label="Ablation"]' --out review/ablation.png
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const URL_BASE = arg("url", "http://localhost:8801");
const HASH = arg("hash", "#/evidence");
const SELECTOR = arg("selector", '[aria-label="Ablation"]');
const OUT = resolve(arg("out", "review/section.png"));
const PAD = Number(arg("pad", "90"));
const WIDTH = Number(arg("width", "1440"));
const HEIGHT = Number(arg("height", "1100"));
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(resolve(tmpdir(), "cb-shot-"));
const child = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
try {
  const browserWs = await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error("no DevTools endpoint in 15s")), 15000);
    let buf = "";
    child.stderr.on("data", (c) => {
      buf += c;
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) { clearTimeout(timer); ok(m[1]); }
    });
  });
  const { port } = new URL(browserWs);
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.addEventListener("open", ok); ws.addEventListener("error", fail); });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const { ok, fail } = pending.get(msg.id); pending.delete(msg.id); msg.error ? fail(new Error(msg.error.message)) : ok(msg.result); }
  });
  const send = (method, params = {}) => new Promise((ok, fail) => { const i = ++id; pending.set(i, { ok, fail }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${URL_BASE}/${HASH}` });
  // A heavy route (the evidence page reads nine JSON files and builds a dozen
  // tables) is not ready at a fixed 1.6 s; wait for the selector instead of for the
  // clock, so a slow render becomes a longer wait rather than a "missing" error.
  let found = false;
  for (let i = 0; i < 40 && !found; i++) {
    await sleep(400);
    const probe = await send("Runtime.evaluate", {
      expression: `!!document.querySelector(${JSON.stringify(SELECTOR)})`,
      returnByValue: true,
    });
    found = probe.result?.value === true;
  }
  if (!found) throw new Error(`selector ${SELECTOR} not found on ${HASH}`);
  await send("Runtime.evaluate", {
    expression: `(() => { const el = document.querySelector(${JSON.stringify(SELECTOR)}); el.scrollIntoView({ block: "start" }); window.scrollBy(0, -${PAD}); })()`,
  });
  await sleep(400);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, Buffer.from(shot.data, "base64"));
  console.log(`Saved ${OUT}`);
  ws.close();
} finally {
  child.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
