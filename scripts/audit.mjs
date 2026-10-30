// Automated UI + functionality audit. Drives a real headless Chrome over CDP,
// checks layout, copy, accessibility basics, routing and the no-fake-number
// guard at desktop and phone widths, and saves screenshots as evidence.
// One pass asks the analyst a question for real, because the freshness attestation
// and the per-answer Qloo receipt are only provable underneath an answer.
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

const AUDIT_JS = (EXPECT, ASKQ) => String.raw`(async () => {
  const EXPECT = ${JSON.stringify(EXPECT)};
  const ASKQ = ${JSON.stringify(ASKQ)};
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
  const wk = String(EXPECT.weeks ?? "");
  add("window-label", !wk || new RegExp(wk + " weeks").test(view.innerText), (view.innerText.match(/\d+ weeks[^·\n]*/) || ["missing"])[0]);
  const holdingsTable = view.querySelector('table[data-audit="holdings"]');
  const rows = holdingsTable ? holdingsTable.querySelectorAll("tbody tr").length : 0;
  add("book-size", rows === 0 || (rows >= Math.floor(EXPECT.total * 0.7) && rows <= EXPECT.total), rows + " rows of " + EXPECT.total + " names");
  const chips = [...view.querySelectorAll(".filters .fchip")];
  const isBookRoute = location.hash === "" || location.hash === "#/" || location.hash.startsWith("#/holding/");
  add("sector-filter", !isBookRoute || rows === 0 || (chips.length >= 3 && !!view.querySelector(".fchip.on")), chips.length + " sector chips");
  const urlCells = [...view.querySelectorAll("td.url")];
  add("cached-response-wraps", urlCells.every((td) => td.scrollWidth <= td.clientWidth + 1),
    urlCells.map((td) => td.scrollWidth + "/" + td.clientWidth).join(" "));
  add("tabs-present", [...document.querySelectorAll(".tabs a")].filter((a) => !a.hidden).length >= 2 && !!document.querySelector(".tabs a.on"),
    [...document.querySelectorAll(".tabs a")].filter((a) => !a.hidden).length + " visible tabs");
  add("no-placeholder-copy", !/lorem ipsum|TODO|FIXME|placeholder|TEST-/i.test(view.innerText), "placeholder sweep");
  const onDesk = location.hash === "" || location.hash === "#/" || location.hash.startsWith("#/holding/");
  if (onDesk) add("value-add-slot", /ΔR²/.test(view.innerText), "ΔR² slot present");
  if (location.hash.startsWith("#/holding/")) {
    const wh = [...view.querySelectorAll(".wh")];
    const stubRows = [...view.querySelectorAll(".wm")].filter((n) => /Stub /i.test(n.innerText)).length;
    add("holding-basket-legible", wh.length === 0 || (stubRows === 0 && (!!view.querySelector(".wm-empty") || view.querySelectorAll(".wm").length > 0)),
      wh.length + " basket blocks · " + stubRows + " stub rows · " + view.querySelectorAll(".wm-empty").length + " labelled state");
    // a single name's OOS number must carry both ranges and name the wider one
    const ht = view.innerText;
    add("holding-two-intervals", !/Out of sample/.test(ht) || (/fixed coefficients 90% CI/.test(ht) && /refit per draw 90% CI/.test(ht) && /Claim carries on the/.test(ht)),
      /fixed coefficients 90% CI/.test(ht) ? "both intervals, claim line present" : "no interval block");
  }

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
  // live state: the desk leads with a verdict sentence and chips; the two
  // robustness tests live on the evidence view, where a sceptic is already zoomed in.
  if (mode === "live" && (location.hash === "" || location.hash === "#/")) {
    const line = view.querySelector('[data-audit="verdict-line"]');
    const text = line?.innerText.trim() || "";
    add("verdict-line", text.length > 60 && /taste|r²|flag/i.test(text), text ? text.length + " chars" : "missing");
    const chipEls = [...view.querySelectorAll(".chips .chip")];
    const grade = chipEls[0]?.innerText.trim() || "";
    add("verdict-chips", chipEls.length >= 5 && /^(HOLDS|MARGINAL|FAILS|NO SIGNAL|NO SIGNAL \(IN-SAMPLE\)|IN-SAMPLE ONLY)$/.test(grade.toUpperCase()),
      chipEls.length + " chips, grade " + grade);
    const noteChip = chipEls.map((c) => c.innerText.trim()).find((t) => /^(HOLDS|NO SIGNAL( \(IN-SAMPLE\))?|IN-SAMPLE ONLY|FAILS|MARGINAL|UNTESTABLE) =/.test(t)) || "";
    add("verdict-note", /^(HOLDS|NO SIGNAL( \(IN-SAMPLE\))?|IN-SAMPLE ONLY|FAILS|MARGINAL|UNTESTABLE) =/.test(noteChip.toUpperCase()), noteChip ? noteChip.slice(0, 48) + "…" : "grade note missing");
    // A frozen scored slice cannot grade a held-out test, so the grade word itself must say in-sample.
    if (chipEls.some((c) => /held-out slice frozen/i.test(c.innerText.trim()))) {
      add("grade-in-sample", /IN-SAMPLE/.test(grade.toUpperCase()), grade);
      // The freeze decides how every number on the page reads, so it must be on
      // this page and not only behind a link: the landing itself has to carry it.
      const basis = view.querySelector('[data-audit="basis"]')?.innerText.trim() || "";
      add("basis-on-landing", /scored weeks/i.test(basis) && /in sample|in-sample/i.test(basis) && /of \d+ weeks/i.test(basis),
        basis ? basis.slice(0, 60) + "…" : "missing");
    }
    // a name the factor could not reach must say why it was not reached, and how
    // hard the resolver looked — an unexplained gap reads as a broken pipeline
    const unrRows = [...view.querySelectorAll('[data-audit="holdings"] tbody tr')].filter((tr) => /no Qloo entity/i.test(tr.innerText));
    if (unrRows.length) {
      // The wording may change; what must not change is the evidence: a cause, the
      // number of queries tried, how many candidates came back, and the strings.
      const ok = unrRows.every((tr) => /· \d+ quer(y|ies), \d+ candidates? · tried: ./i.test(tr.innerText));
      add("unresolved-states-why", ok, unrRows.length + " unresolved rows");
    }
    // the state tag must come from what computed the panel, not a hardcoded claim
    const tag = view.querySelector(".side .state")?.innerText.trim() || "";
    const want = EXPECT.stub ? /stub harness/i : /qloo-sourced/i;
    add("state-tag-derived", want.test(tag), tag || "missing");
    // the badge must not imply the pull is current: it names the source, and when
    // the scored slice is inside the frozen tail it names the last revision date
    if (!EXPECT.stub) add("state-tag-no-freshness-claim", !/\blive\b/i.test(tag), tag || "missing");
  }
  if (location.hash.startsWith("#/read")) {
    const prose = view.querySelector(".prose");
    const text = prose ? prose.innerText : "";
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    add("read-plain-language", words >= 250 && /market beta/i.test(text) && /cultural beta/i.test(text), words + " words");
    add("read-no-raw-markup", !/\\beta|\^2/.test(text), "no raw markup");
    add("read-falsifiers", /What would prove this wrong/i.test(text) && /No flag survives the book/i.test(text) && /Taste adds nothing over the sector/i.test(text) && /peer control wins in both windows/i.test(text) && /It does not replicate/i.test(text),
      "four falsifiers named");
    add("read-claim-level", /book-level/i.test(text) && /point-estimate precision/i.test(text), "claim bounded to the book");
    add("read-negative-valuation", /falsification memo/i.test(text) && /buy-side quant|factor researcher/i.test(text), "negative case priced honestly");
    add("read-two-nulls", /two different questions/i.test(text) && /scored against the peer models/i.test(text), "market null and ablation null told apart");
    add("read-sentiment-exclusion", /just be consumer confidence/i.test(text) && /University of Michigan/i.test(text), "sentiment exclusion named on the read page");
    add("read-run-cost-numeric", /costs to run/i.test(text) && /[\d,]{4,} requests/.test(text) && /costs 0/.test(text),
      "the Qloo cost of a run printed as numbers, control arm at zero");
  }
  if (location.hash.startsWith("#/ask")) {
    const form = view.querySelector("#ask-form");
    const input = form ? form.querySelector("input") : null;
    const chips = view.querySelectorAll(".qchip").length;
    const notice = view.querySelector(".notice");
    add("ask-route-input", !!input && input.getAttribute("maxlength") === "400", input ? "input present" : "missing");
    // The interface must say what it cannot do before it says anything else.
    add("ask-read-only-claim", /read-only/i.test(view.innerText) && /(no Qloo spend|one live Qloo read per answer)/i.test(view.innerText), "read-only claim present");
    // A configured deployment shows the form; an unconfigured one must show the refusal, not a dead button.
    add("ask-form-or-refusal", (!!input && !input.disabled) || !!notice, notice ? "refusal notice" : "enabled form");
    add("ask-suggestions", chips >= 3 || !!notice, chips + " suggestion chips");
    add("ask-no-answer-before-question", !view.querySelector('[data-audit="agent-answer"]'), "no answer rendered cold");

    // Freshness attestation: the desk must show one without a question ever being
    // asked, and it must never show a date the server did not get from Qloo.
    const chip = view.querySelector('[data-audit="freshness"]');
    const chipText = chip ? chip.innerText.replace(/\s+/g, " ").trim() : "";
    add("ask-freshness-attestation", !!chip || !!notice, chipText.slice(0, 150) || "no attestation rendered");
    const unchecked = !!chip && /freshness not checked/i.test(chipText);
    add("ask-unchecked-attestation-carries-no-date", !unchecked || !/20\d\d-\d\d-\d\d/.test(chipText),
      unchecked ? "reason shown, no date: " + chipText.slice(0, 100) : "attestation is checked");
    // Its date has to be the server's date, read back from the cache-only endpoint
    // that never spends a request.
    let FJ = null;
    try { const fr = await fetch("/api/freshness.json"); if (fr.ok) FJ = await fr.json(); } catch {}
    add("ask-freshness-endpoint-present", !!FJ || !!notice, FJ ? "checked=" + FJ.checked + (FJ.why ? " why=" + FJ.why : "") : "no /api/freshness.json");
    if (chip && FJ && FJ.checked && !unchecked) {
      add("ask-freshness-date-matches-the-server", !FJ.latestWeek || chipText.includes(String(FJ.latestWeek)),
        "chip " + (chipText.match(/newest week (\S+)/) || ["—"])[0] + " vs server " + (FJ.latestWeek ?? "—"));
      add("ask-freshness-backed-by-a-real-call", (FJ.correlationIds || []).length > 0 || (FJ.fromCachedPage && !!FJ.cachedResponseFetchedAt),
        "correlation " + (FJ.correlationIds || []).length + " · replayed " + !!FJ.fromCachedPage + " · " + (FJ.requests ?? 0) + " request(s)");
      add("ask-freshness-scoped-to-one-page", (FJ.requests ?? 0) <= (EXPECT.maxRequests ?? 2), (FJ.requests ?? 0) + " Qloo requests behind it");
    }

    // Then ask a question for real, so the receipt below the answer exists on screen
    // and not only in a payload nobody looked at.
    if (ASKQ && input && !input.disabled) {
      input.value = ASKQ;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      const until = Date.now() + 90000;
      while (Date.now() < until && !view.querySelector('[data-audit="agent-answer"]') && !view.querySelector(".ask-err")) await new Promise((r) => setTimeout(r, 400));
    }
    // The bare #/ask route asks nothing: its form is graded above. Only a route that
    // actually submits a question can be asked whether an answer arrived.
    const answered = !!view.querySelector('[data-audit="agent-answer"]');
    const refused = !!view.querySelector(".ask-err") || !!notice;
    // The bare #/ask route asks nothing: its form is graded above. Only a route that
    // actually submits a question can be asked whether an answer arrived.
    if (ASKQ) add("ask-answer-arrives", answered || refused, answered ? "answered" : refused ? (view.querySelector(".ask-err")?.innerText.trim().slice(0, 90) ?? "refused") : "no answer and no refusal");
    const rcBlock = view.querySelector('[data-audit="receipts"]');
    const rows = rcBlock ? [...rcBlock.querySelectorAll(".rc")] : [];
    const headOf = (n) => (n.querySelector("b")?.innerText.trim() || "");
    const rowText = (n) => n.innerText.replace(/\s+/g, " ").trim();
    const codesOf = (n) => [...n.querySelectorAll("code")].map((c) => c.innerText.trim());
    add("ask-receipt-block", answered ? rows.length >= 2 : !rcBlock, rows.length ? rows.map(headOf).join(", ") + " (" + rcBlock.querySelector(".rc-head")?.innerText.trim() + ")" : "no receipt block");
    const panelRow = rows.find((n) => headOf(n) === "panel");
    add("ask-receipt-names-the-panel-and-revision", answered ? !!panelRow && /output\/desk\.json/.test(rowText(panelRow)) && /revision 20\d\d/.test(rowText(panelRow)) : true,
      panelRow ? rowText(panelRow).slice(0, 150) : "no panel entry");
    const freshRow = rows.find((n) => headOf(n) === "freshness");
    add("ask-receipt-carries-the-attestation", answered ? !!freshRow : true, freshRow ? rowText(freshRow).slice(0, 160) : "no freshness entry");
    if (freshRow && FJ && FJ.checked) {
      add("ask-receipt-correlation-id-is-the-servers", (codesOf(freshRow).some((c) => (FJ.correlationIds || []).includes(c))) || FJ.fromCachedPage,
        codesOf(freshRow).join(" ").slice(0, 120) || "no correlation id in the receipt");
      add("ask-receipt-names-response-files", freshRow.querySelectorAll("code").length >= 1 && /page-|fresh-|series|\.json/.test(rowText(freshRow)),
        codesOf(freshRow).filter((c) => /\.json/.test(c)).join(" ").slice(0, 120) || "no file named");
    }
    const evidenceRows = rows.filter((n) => /^live ·|^committed/.test(headOf(n)));
    const traceRows = view.querySelectorAll(".trace .tr").length;
    add("ask-receipt-not-invented", answered ? evidenceRows.length <= traceRows : true,
      evidenceRows.length + " call entries against " + traceRows + " trace rows");
    add("ask-receipt-each-call-names-a-response", evidenceRows.every((n) => codesOf(n).some((c) => /\.json/.test(c))),
      evidenceRows.map((n) => headOf(n) + ":" + (codesOf(n).some((c) => /\.json/.test(c)) ? "file" : "NO FILE")).join(", ") || "none");
    add("ask-receipt-no-credential", rows.every((n) => !/api[_ -]?key|bearer|access[_ -]?token|secret|sk-[a-z0-9]/i.test(rowText(n))),
      rows.length + " entries swept for credential-shaped text");
    const traceEl = view.querySelector(".trace");
    const rcSpanEl = rcBlock?.querySelector(".rc span") || null;
    const rcBeforeTrace = !rcBlock || !traceEl || (rcBlock.compareDocumentPosition(traceEl) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    add("ask-receipt-in-the-desks-language", !rcBlock || !rcSpanEl ? !answered : (
      !/[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(rcBlock.innerText)
      && /mono/i.test(getComputedStyle(rcSpanEl).fontFamily) && rcBeforeTrace),
      rcSpanEl ? getComputedStyle(rcSpanEl).fontFamily.split(",")[0] + " · receipt sits above the trace: " + rcBeforeTrace : "no block");
    if (answered) add("answered-no-horizontal-overflow", document.documentElement.scrollWidth <= vw + 1,
      "scrollWidth " + document.documentElement.scrollWidth + " / viewport " + vw + " with the receipt open");
    if (rcBlock) add("answered-receipt-rows-readable", rows.every((n) => n.scrollWidth <= n.clientWidth + 1),
      rows.map((n) => n.scrollWidth + "/" + n.clientWidth).join(" "));
  }
  if (mode === "live" && location.hash.startsWith("#/map")) {
    const dots = view.querySelectorAll(".card svg circle").length;
    add("map-one-dot-per-sector", dots >= 3 && dots <= 15, dots + " sub-sector dots");
    // labels are de-collided in SVG space; measure their painted boxes
    const labels = [...view.querySelectorAll(".card svg text.anno")].map((t) => t.getBoundingClientRect());
    const clash = [];
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j];
      if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) clash.push(i + "/" + j);
    }
    add("map-labels-separated", labels.length > 0 && clash.length === 0, labels.length + " labels, " + (clash.length ? "clash " + clash.join(",") : "no overlap"));
  }
  if (mode === "live" && location.hash.startsWith("#/evidence")) {
    const rob = view.querySelector("[aria-label=Robustness]");
    const tests = [...(rob ? rob.querySelectorAll(".rb-test") : [])];
    const vals = tests.map((t) => t.querySelector(".rb-v")?.innerText.trim() || "");
    add("robustness-band", (tests.length === 4 || tests.length === 2) && vals.every((v) => v && v !== "—" && v !== "p —"),
      tests.length + " tests: " + vals.join(" · "));
    const wins = [...(rob ? rob.querySelectorAll(".rb-window") : [])];
    add("window-labels", wins.length === tests.length / 2, wins.length + " window labels");
    // the ablation arm: taste against a same-sector peer control; the in-sample
    // peer gain lives in the CSV so the band cannot read as free positive evidence
    const ab = [...view.querySelectorAll("[aria-label=Ablation] .rb-grid .rb-test")];
    const abv = ab.map((t) => t.querySelector(".rb-v")?.innerText.trim() || "");
    add("ablation-band", ab.length === 2 && abv.every((v) => v && v !== "—"),
      ab.length + " cells: " + abv.join(" · "));
    const abSe = [...view.querySelectorAll("[aria-label=Ablation] .rb-se")].map((n) => n.innerText.trim());
    const abCi = abSe.filter((t) => /90% CI/.test(t) && /pts/.test(t));
    add("ablation-intervals", abCi.length >= 2 && abCi.some((t) => /refit/i.test(t)),
      abCi.length + " interval lines, refit labelled: " + abCi.some((t) => /refit/i.test(t)));
    add("ablation-no-insample-cell", !/Sector peers, over market/i.test(view.innerText), "in-sample cell not in the band");
    const evText = view.innerText;
    add("ablation-interval-rule", /Claim carries on the/.test(evText) && /wider of the two/.test(evText), "wider-interval rule printed at the number");
    add("peer-control-no-qloo", /no Qloo data at all/.test(evText) && /uses no Qloo data/.test(evText), "peer control stated as Qloo-free");
    const secTested = /different regime/i.test(evText) && /not an identical-conditions/i.test(evText);
    const secUntestable = /untestable/i.test(evText) && /cannot be priced/i.test(evText) && /before any keyed run/i.test(evText);
    add("second-window-regime", secTested || secUntestable, secUntestable ? "second window reported as untestable, pre-registration stated" : "second window labelled as a different regime");
    add("ablation-rotation-null", /rotation null: p/.test(evText), "ablation carries its own rotation null");
    const sen = view.querySelector("[aria-label='Consumer sentiment']");
    const senText = sen ? sen.innerText : "";
    add("sentiment-exclusion", /Could this just be consumer confidence/i.test(senText) && /UMCSENT/.test(senText) && /monthly/i.test(senText) && /90% CI/.test(senText),
      sen ? "sentiment exclusion printed with source, cadence and interval" : "sentiment block missing");
    add("sentiment-chip-honest", !(/crosses zero/.test(senText) && /survives the control/i.test(senText)),
      "chip does not claim survival when its interval crosses zero");
    add("alerts-route", /\/api\/v1\/alerts/.test(view.innerText), "alerts feed listed in the product surface");
    const cost = view.querySelector("[aria-label='Run cost']");
    const costVals = [...(cost ? cost.querySelectorAll(".rb-v") : [])].map((v) => v.innerText.trim());
    add("cost-band-numbers", !!cost && costVals.length === 5 && /[\d,]{4,} requests/.test(costVals[0]) && costVals[1] === "0 requests",
      costVals.join(" · ") || "cost band missing");
    add("cost-band-both-nulls", !!cost && /p 0\./.test(costVals[2]) && /p 0\./.test(costVals[3]) && /p 0\./.test(costVals[4]),
      "rotation " + (costVals[2] || "-") + " / permutation " + (costVals[3] || "-") + " / peer " + (costVals[4] || "-"));
    // the pooled reading added after review: one slope per sub-sector, labelled
    // post-hoc, and reported even where it agrees with the null
    const pooledEl = view.querySelector("[aria-label='Pooled panel']");
    const pooledRows = pooledEl ? pooledEl.querySelectorAll("table tbody tr").length : 0;
    const pooledText = pooledEl ? pooledEl.innerText : "";
    add("pooled-panel", pooledRows >= 8 && /post-hoc/i.test(pooledText) && /clustered by week/i.test(pooledText) && /p 0\./.test(pooledText),
      pooledRows + " sub-sector rows, post-hoc label " + /post-hoc/i.test(pooledText));
    add("pooled-multiplicity", /Bonferroni/i.test(pooledText), "multiplicity across sub-sector tests printed");
    add("pooled-estimand-scoped", /different estimand/i.test(pooledText) && /cannot confirm or refute a claim about an individual name/i.test(pooledText),
      "pooled reading scoped as a sub-sector estimand, not a per-name test");
    add("pooled-name-market", /keeps its own market loading/i.test(pooledText) && /name × market interaction/i.test(pooledText),
      "common-slope restriction removed in a second arm");
    add("revision-cut-sensitivity", /cut is checkable/.test(evText) && /same verdict either way/.test(evText), "revision cut carries its own re-run");
    add("permutation-null", /date permutation/i.test(evText), "date-permutation null printed beside the rotation null");
    // a week-by-week shuffle dissolves the refresh cadence; the block version keeps it
    add("permutation-blocks", /blocks of \d+ consecutive weeks/i.test(evText) && /refresh cadence/i.test(evText),
      "cadence-respecting permutation printed beside the week-by-week one");
    // a positive claim must clear every null; the rule is max-of-p, not IUT
    add("nulls-every-null", /has to clear every null/i.test(evText) && /max-of-p rule/i.test(evText) && /never used on its own/i.test(evText),
      "claim requires every null, and the rule is named as max-of-p");
    // the dispersion test: the one test that could turn the null into a hit
    const dispEl = view.querySelector("[aria-label='Dispersion']");
    const dispText = dispEl ? dispEl.innerText : "";
    add("dispersion-test", !!dispEl && /spread across names/i.test(dispText) && /independently/i.test(dispText) && /lower tail|smaller than noise|no larger than noise/i.test(dispText),
      dispEl ? "variance vs noise vs independent-rotation null" : "dispersion band missing");
    add("dispersion-power", !!dispEl && /planted cross-sectional sd/i.test(dispText) && /80% power/i.test(dispText) && /not a kill/i.test(dispText),
      dispEl ? "power calibration printed and the reading scoped to it" : "dispersion power calibration missing");
    // a non-detection is only informative if the test could have caught a spread that size
    add("dispersion-power-observed", !!dispEl && /spread the size this book shows/i.test(dispText) && /uninformative/i.test(dispText),
      dispEl ? "power at the observed spread printed, non-detection scoped to it" : "observed-spread power missing");
    add("dispersion-power-pre-specified", !!dispEl && /pre-specified grid/i.test(dispText) && /80% power/i.test(dispText),
      dispEl ? "power bar fixed before the run, not read off the observed spread" : "pre-specified power bar missing");
    // the three variance numbers disagree; the null must say which benchmark is wrong
    add("dispersion-benchmark-reconciled", !!dispEl && /which one is wrong/i.test(dispText) && /shared calendar/i.test(dispText),
      dispEl ? "miscalibrated benchmark identified from inside the null" : "benchmark gap left unexplained");
    // the held-out slice is a carry-forward at this vintage; the number must say so
    add("frozen-heldout", /frozen for every name/i.test(evText) && /no test/i.test(evText) && /multipl[iy]/i.test(evText),
      "held-out slice marked untestable with the reason, not reported as a negative");
    add("grade-summary", !!view.querySelector('[data-audit="grade-summary"]') && /held-out slice frozen/i.test(view.querySelector('[data-audit="grade-summary"]').innerText),
      "grade and its frozen-slice qualifier printed before the table");
    add("vintage-card", !!view.querySelector('[data-audit="vintage"]') && /last changes on|last revision/i.test(view.querySelector('[data-audit="vintage"]')?.innerText || "") && /carry-forward/i.test(view.querySelector('[data-audit="vintage"]')?.innerText || ""),
      "data vintage card names the last revision and the carry-forward");
    add("qloo-vs-peer", /correlation between/i.test(evText) && /peer basket/i.test(evText) && /moves every week|every week/i.test(evText),
      "what Qloo adds over the no-Qloo peer basket is stated, not inferred");
  }
  if (vw <= 600 && onDesk) {
    const tr = view.querySelector("tbody tr.link");
    const sig = tr?.querySelector(".c-sig")?.getBoundingClientRect();
    const ta = tr?.querySelector(".ta")?.getBoundingClientRect();
    add("mobile-signal-line", !sig || !ta || Math.abs(sig.top - ta.top) < 3,
      sig && ta ? "signal top " + Math.round(sig.top) + " · trace top " + Math.round(ta.top) : "no row");
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
  // the receipt and the attestation are the smallest text on the desk, so they are
  // measured against the same bar rather than assumed to inherit it
  for (const [id, sel] of [["provenance-body-contrast", ".receipts .rc span"], ["provenance-head-contrast", ".receipts .rc b"], ["provenance-chip-contrast", ".fresh-v"]]) {
    const el = view.querySelector(sel);
    if (!el) continue;
    const cs2 = getComputedStyle(el);
    let bgEl2 = el, bg2 = "rgba(0, 0, 0, 0)";
    while (bgEl2 && (bg2 === "rgba(0, 0, 0, 0)" || bg2 === "transparent")) { bg2 = getComputedStyle(bgEl2).backgroundColor; bgEl2 = bgEl2.parentElement; }
    const cr2 = ratio(cs2.color, bg2);
    add(id, cr2 >= 4.5, sel + " " + cr2.toFixed(2) + ":1 at " + cs2.fontSize + " " + cs2.color + " on " + bg2);
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
  { hash: "#/read", name: "read" },
  { hash: "#/ask", name: "ask" },
  // The receipt block only exists under an answer, so one pass asks a question for
  // real and audits the answer the way a reviewer would read it.
  { hash: "#/ask", name: "ask-answered", ask: "Why is Disney not flagged?" },
];
const VIEWPORTS = [
  { width: 1440, height: 1100, name: "desktop" },
  { width: 768, height: 1024, name: "tablet", mobile: true },
  { width: 390, height: 844, name: "phone", mobile: true },
];

let EXPECT = { rows: 0, total: 0, stub: false, weeks: 0, maxRequests: 2 };
try {
  const meta = await (await fetch(`${URL_BASE}/api/market-only.json`)).json();
  let stub = false, weeks = 0, maxRequests = 2;
  try { const d = await (await fetch(`${URL_BASE}/api/desk.json`)).json(); stub = d.source?.kind === "stub harness"; weeks = d.window?.weeks ?? 0; } catch {}
  try { const a = await (await fetch(`${URL_BASE}/api/agent.json`)).json(); maxRequests = a.freshness?.maxRequests ?? 2; } catch {}
  EXPECT = { rows: meta.rows?.length ?? 0, total: meta.universe?.total ?? meta.rows?.length ?? 0, stub, weeks, maxRequests };
} catch { /* server down: the page checks report the failure */ }

const { child, browserWs, profile } = await startChrome();
const results = [];
let navCount = 0;
try {
  const { cdp, ws } = await connectPage(browserWs);
  for (const vp of VIEWPORTS) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: Boolean(vp.mobile) });
    for (const route of ROUTES) {
      // A unique query makes every route a real document load. Navigating between
      // hash routes alone reuses the SPA's state, so a later route would be graded
      // against DOM and in-memory answers left by an earlier one.
      const nonce = `${vp.name}-${route.name}-${++navCount}`;
      await cdp.send("Page.navigate", { url: `${URL_BASE}/?r=${nonce}${route.hash}` });
      // Wait for the desk's own ready flag rather than a fixed sleep: the panel is
      // nine files and a slow link must not be graded as a missing headline.
      const waitReady = async () => {
        const readyUntil = Date.now() + 30000;
        while (Date.now() < readyUntil) {
          const st = await cdp.send("Runtime.evaluate", { expression: "document.body?.dataset.ready === '1'", returnByValue: true });
          if (st.result?.value === true) return true;
          await sleep(250);
        }
        return false;
      };
      if (!(await waitReady())) {
        // One connection reset on a small shared host is a flake, not a finding: load
        // the document once more and grade the second attempt. A page that never
        // becomes ready twice still fails every check it should.
        await cdp.send("Page.navigate", { url: `${URL_BASE}/?retry=${nonce}${route.hash}` });
        await waitReady();
      }
      const res = await cdp.send("Runtime.evaluate", { expression: AUDIT_JS(EXPECT, route.ask ?? ""), awaitPromise: true, returnByValue: true });
      const value = res.result?.value ?? { checks: [{ id: "evaluate", ok: false, detail: res.exceptionDetails?.text || "no value" }] };
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
      const file = resolve(shotDir, `${vp.name}-${route.name}.png`);
      writeFileSync(file, Buffer.from(shot.data, "base64"));
      if (route.name === "desk" || route.name === "evidence" || route.name === "ask-answered") {
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
