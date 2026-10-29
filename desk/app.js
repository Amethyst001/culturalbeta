/* Cultural Beta desk — dependency-free SPA. Views: desk, holding, taste map, evidence. */
const $ = (s) => document.querySelector(s);
const f2 = (x, d = 2) => x == null ? "—" : (x >= 0 ? "+" : "") + x.toFixed(d);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let DESK = null, SERIES = null, EVIDENCE = null, MARKET = null;
let sortKey = "culturalBeta", sortDir = -1;

const get = async (p) => { const r = await fetch(p); return { ok: r.ok, data: r.ok ? await r.json() : null }; };

async function load() {
  const [d, s, e, m] = await Promise.all([get("/api/desk.json"), get("/api/series.json"), get("/api/evidence.json"), get("/api/market-only.json")]);
  DESK = d.ok ? d.data : null; SERIES = s.ok ? s.data : null; EVIDENCE = e.ok ? e.data : null; MARKET = m.ok ? m.data : null;
  route();
}

/* ---------- small stats helpers (client-side) ---------- */
function resid(y, x) {
  const n = y.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; sxy += x[i] * y[i]; }
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-16) return null;
  const b = (n * sxy - sx * sy) / den;
  const a = (sy - b * sx) / n;
  return y.map((v, i) => v - (a + b * x[i]));
}
function partialSlope(y, x1, x2) {
  const ry = resid(y, x1), rx = resid(x2, x1);
  if (!ry || !rx) return null;
  const my = ry.reduce((a, b) => a + b, 0) / ry.length;
  const mx = rx.reduce((a, b) => a + b, 0) / rx.length;
  let num = 0, den = 0;
  for (let i = 0; i < ry.length; i++) { num += (rx[i] - mx) * (ry[i] - my); den += (rx[i] - mx) ** 2; }
  return { slope: num / den, ry, rx };
}

/* ---------- SVG helpers ---------- */
const W = 820, H = 300, PAD = { l: 48, r: 16, t: 14, b: 28 };
function pathFrom(vals, xs, ys) {
  let d = "", pen = false;
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] == null) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${xs(i).toFixed(1)},${ys(vals[i]).toFixed(1)}`;
    pen = true;
  }
  return d;
}
function gridlines(min, max, y) {
  let g = "";
  for (let k = 0; k <= 4; k++) {
    const v = min + (max - min) * k / 4;
    g += `<line class="gridline" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`;
    g += `<text class="ticklabel" x="${PAD.l - 8}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${v.toFixed(1)}</text>`;
  }
  return g;
}

function lineChart(dates, a, b, nameA, nameB) {
  const norm = (arr) => { const i0 = arr.findIndex((v) => v != null); if (i0 < 0) return arr; let idx = 100, out = arr.map(() => null); for (let i = i0; i < arr.length; i++) { if (arr[i] == null) continue; idx *= 1 + arr[i]; out[i] = idx; } return out; };
  const A = norm(a), B = norm(b);
  const all = [...A, ...B].filter((v) => v != null);
  const min = Math.min(...all) * 0.96, max = Math.max(...all) * 1.04;
  const x = (i) => PAD.l + (i / (dates.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v) => H - PAD.b - ((v - min) / (max - min)) * (H - PAD.t - PAD.b);
  const xl = [0, Math.floor(dates.length / 3), Math.floor(2 * dates.length / 3), dates.length - 1]
    .map((i) => `<text class="ticklabel" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${dates[i].slice(0, 7)}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Indexed price return versus indexed taste momentum">
    ${gridlines(min, max, y)}
    <line class="axis" x1="${PAD.l}" x2="${W - PAD.r}" y1="${H - PAD.b}" y2="${H - PAD.b}"/>
    ${xl}
    <path d="${pathFrom(A, x, y)}" fill="none" stroke="var(--ink)" stroke-width="1.8"/>
    <path d="${pathFrom(B, x, y)}" fill="none" stroke="var(--accent)" stroke-width="1.8"/>
  </svg>
  <div class="legend">
    <span><i class="sw" style="background:var(--ink)"></i>${nameA} — cumulative price return, indexed to 100</span>
    <span><i class="sw" style="background:var(--accent)"></i>${nameB} — cumulative taste momentum, indexed to 100</span>
  </div>`;
}

function scatter(ry, rx, slope, tick) {
  const pad2 = { l: 52, r: 18, t: 18, b: 34 };
  const minx = Math.min(...rx) * 1.1, maxx = Math.max(...rx) * 1.1;
  const miny = Math.min(...ry) * 1.1, maxy = Math.max(...ry) * 1.1;
  const x = (v) => pad2.l + ((v - minx) / (maxx - minx)) * (W - pad2.l - pad2.r);
  const y = (v) => H - pad2.b - ((v - miny) / (maxy - miny)) * (H - pad2.t - pad2.b);
  const pts = ry.map((v, i) => `<circle cx="${x(rx[i]).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.6" fill="var(--ink)" opacity=".55"/>`).join("");
  const x0 = minx, x1 = maxx;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Residualised return against residualised taste basket">
    <line class="axis" x1="${pad2.l}" x2="${W - pad2.r}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>
    <line class="axis" x1="${x(0).toFixed(1)}" x2="${x(0).toFixed(1)}" y1="${pad2.t}" y2="${H - pad2.b}"/>
    <line x1="${x(x0).toFixed(1)}" y1="${y(slope * x0).toFixed(1)}" x2="${x(x1).toFixed(1)}" y2="${y(slope * x1).toFixed(1)}" stroke="var(--accent)" stroke-width="1.6" stroke-dasharray="5 4"/>
    ${pts}
    <text class="anno" x="${W - pad2.r}" y="${pad2.t + 12}" text-anchor="end">slope = cultural beta ${f2(slope)}</text>
    <text class="ticklabel" x="${W / 2}" y="${H - 6}" text-anchor="middle">taste basket return, residualised on SPY</text>
    <text class="ticklabel" x="12" y="${H / 2}" transform="rotate(-90 12 ${H / 2})" text-anchor="middle">${tick} return, residualised on SPY</text>
  </svg>`;
}

function quadrant(rows) {
  const pad2 = { l: 56, r: 24, t: 22, b: 40 };
  const xs = rows.map((r) => r.marketBeta), ys = rows.map((r) => r.culturalBeta);
  const maxx = Math.max(0.5, ...xs) * 1.15, minx = 0;
  const maxAbsY = Math.max(0.1, ...ys.map(Math.abs)) * 1.3;
  const x = (v) => pad2.l + ((v - minx) / (maxx - minx)) * (W - pad2.l - pad2.r);
  const y = (v) => H - pad2.b - ((v + maxAbsY) / (2 * maxAbsY)) * (H - pad2.t - pad2.b);
  const dots = (() => {
    const placed = [];
    return rows.slice().sort((a, b) => b.culturalBeta - a.culturalBeta).map((r) => {
      const cx = x(r.marketBeta), cy = y(r.culturalBeta);
      let ly = cy + 4;
      for (const p of placed) {
        if (Math.abs(p.cx - cx) < 90 && Math.abs(p.ly - ly) < 14) ly = p.ly + 14;
      }
      placed.push({ cx, ly });
      return `<g>
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="7" fill="${r.culturalBeta < 0 ? "var(--accent)" : "var(--good)"}" opacity=".9"/>
      <text class="anno" x="${(cx + 11).toFixed(1)}" y="${ly.toFixed(1)}">${r.ticker}</text>
    </g>`;
    }).join("");
  })();
  const quad = (qx, qy, text, anchor) => `<text class="ticklabel" x="${qx}" y="${qy}" text-anchor="${anchor}" opacity=".75">${text}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Market beta versus cultural beta">
    <line class="axis" x1="${x(0)}" x2="${x(maxx)}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>
    <line class="axis" x1="${x(0).toFixed(1)}" x2="${x(0).toFixed(1)}" y1="${pad2.t}" y2="${H - pad2.b}"/>
    ${quad(x(maxx) - 8, pad2.t + 12, "high market beta · with taste", "end")}
    ${quad(x(maxx) - 8, H - pad2.b - 8, "high market beta · against taste", "end")}
    ${quad(pad2.l + 8, pad2.t + 12, "low market beta · with taste", "start")}
    ${quad(pad2.l + 8, H - pad2.b - 8, "low market beta · against taste", "start")}
    ${dots}
    <text class="ticklabel" x="${W / 2}" y="${H - 6}" text-anchor="middle">market beta →</text>
    <text class="ticklabel" x="14" y="${H / 2}" transform="rotate(-90 14 ${H / 2})" text-anchor="middle">cultural beta →</text>
  </svg>`;
}

/* ---------- shared fragments ---------- */
function metaBlock(rowsOk) {
  const w = DESK.window;
  return `<div class="meta">
    <span class="pill">${w.weeks} weeks · ${w.start} → ${w.end}</span>
    <div class="state ok">${rowsOk}/${DESK.rows.length} holdings priced · live Qloo</div>
  </div>`;
}
function strip() {
  const ok = DESK.rows.filter((r) => r.status === "ok");
  const flagged = ok.filter((r) => r.flagged).length;
  return `<div class="strip">
    <div class="stat"><b>${DESK.rows.length}</b><span>holdings</span></div>
    <div class="stat"><b>${DESK.window.weeks}</b><span>aligned weeks</span></div>
    <div class="stat"><b>${flagged}</b><span>taste-risk flags</span></div>
    <div class="stat"><b>/v2/trending</b><span>factor source · Qloo</span></div>
  </div>`;
}
function refusePanel() {
  return `<div class="desk-empty">
    <h2>No Qloo. No factor.</h2>
    <p>This desk will not print a cultural beta it cannot trace to a live Qloo response.
    The taste column is not decoration, and it will never fall back to zero.</p>
    <p>Add <code>QLOO_API_KEY</code> to <code>.env</code> and press <b>Refresh from Qloo</b>.
    The price half below is real and committed; only the taste half is refused.</p>
  </div>`;
}

function refuseView() {
  if (!MARKET) return refusePanel();
  const w = MARKET.window;
  const rows = MARKET.rows.map((r) => `<tr>
    <td><span class="tick">${r.ticker}</span><span class="name">${esc(r.label)}</span></td>
    <td class="num">${f2(r.marketBeta)}<span class="se">± ${r.marketSE.toFixed(2)}</span></td>
    <td class="num">${f2(r.marketT, 1)}</td>
    <td class="num">${r.r2.toFixed(2)}</td>
    <td><span class="withheld">withheld</span></td>
  </tr>`).join("");
  return `<div class="desk-empty refuse">
    <div>
      <h2>No Qloo. No factor.</h2>
      <p>This desk will not print a cultural beta it cannot trace to a live Qloo response.
      The taste column is not decoration, and it will never fall back to zero.</p>
      <p>Add <code>QLOO_API_KEY</code> to <code>.env</code> and press <b>Refresh from Qloo</b>.
      The price half below is real and committed; only the taste half is refused.</p>
    </div>
    <dl class="ledger">
      <dt>Live</dt><dd>${w.weeks} weekly returns × ${MARKET.rows.length} names<br>${w.start} → ${w.end}<br>Yahoo Finance · committed fixture</dd>
      <dt>Withheld</dt><dd>taste series · cultural betas<br>taste-risk flags</dd>
      <dt>Source</dt><dd>Qloo /v2/trending<br>Qloo /v2/insights</dd>
    </dl>
  </div>
  <div class="meta-row">
    <span class="pill">${w.weeks} weeks · ${w.start} → ${w.end}</span>
    <span class="state ok">price half · Yahoo weekly bars vs ${esc(MARKET.index.ticker)}</span>
  </div>
  <div class="tw">
  <table>
    <thead><tr><th>Holding</th><th>Market beta (± s.e.)</th><th>t-stat</th><th>r²</th><th>Cultural beta</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </div>
  <p class="muted" style="margin-top:12px;font-size:12.5px">Market beta is a one-regressor fit of weekly return on ${esc(MARKET.index.label || MARKET.index.ticker)}.
  It needs no Qloo data, so it is shown; the cultural column is withheld until a live Qloo run fills it.</p>`;
}

/* ---------- views ---------- */
function deskView() {
  const rows = [...DESK.rows].sort((a, b) => {
    const av = a[sortKey] ?? -Infinity, bv = b[sortKey] ?? -Infinity;
    return (av - bv) * sortDir || a.ticker.localeCompare(b.ticker);
  });
  const arrow = (k) => `<span class="arrow">${k === sortKey ? (sortDir > 0 ? "▲" : "▼") : ""}</span>`;
  const maxAbs = Math.max(1, ...rows.filter((r) => r.status === "ok").map((r) => Math.abs(r.culturalBeta)));
  const body = rows.map((r) => {
    if (r.status !== "ok") {
      return `<tr>
        <td><span class="tick">${r.ticker}</span><span class="name">${esc(r.label)}</span></td>
        <td class="num">—</td><td class="num">—</td><td class="num">—</td>
        <td><span class="signal ins">insufficient signal</span></td>
        <td><a class="tracelink" href="#/evidence">trace</a></td></tr>`;
    }
    const b = r.culturalBeta, pct = Math.abs(b) / maxAbs * 50;
    return `<tr class="link" data-h="${r.ticker}">
      <td><span class="tick">${r.ticker}</span><span class="name">${esc(r.label)}</span></td>
      <td class="num">${f2(r.marketBeta)}<span class="se">± ${r.marketSE.toFixed(2)}</span></td>
      <td class="num ${b < 0 ? "neg" : ""}">
        <div class="bar"><i class="${b >= 0 ? "pos" : "negs"}" style="width:${pct}%"></i></div>
        ${f2(b)}<span class="se">± ${r.culturalSE.toFixed(2)}</span></td>
      <td class="num">${f2(r.culturalT, 1)}</td>
      <td>${r.flagged ? '<span class="signal risk">⚑ taste risk</span>' : '<span class="signal none">—</span>'}</td>
      <td><a class="tracelink" href="#/evidence">trace</a></td></tr>`;
  }).join("");
  return `<div class="head">
      <div>
        <h1>Taste is a<br><span class="thin">risk factor.</span></h1>
        <p class="sub">Market beta prices how a stock moves with the index. Cultural beta prices how much
        of that movement is exposure to taste — built from Qloo weekly trend data and reported next to the market number.</p>
      </div>
      ${metaBlock(DESK.rows.filter((r) => r.status === "ok").length)}
    </div>
    ${strip()}
    <div class="tw">
    <table>
      <thead><tr>
        <th class="sort" data-k="ticker">Holding ${arrow("ticker")}</th>
        <th class="sort" data-k="marketBeta">Market beta ${arrow("marketBeta")}</th>
        <th class="sort" data-k="culturalBeta">Cultural beta (± s.e.) ${arrow("culturalBeta")}</th>
        <th class="sort" data-k="culturalT">t-stat ${arrow("culturalT")}</th>
        <th>Signal</th><th></th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    </div>
    <p class="muted" style="margin-top:12px;font-size:12.5px">Click a holding for its full reading. Taste risk = negative cultural beta with |t| ≥ 2.</p>`;
}

function holdingView(tick) {
  const r = DESK.rows.find((x) => x.ticker === tick);
  if (!r) return `<p>Unknown holding.</p>`;
  const back = `<a class="back" href="#/">← back to the desk</a>`;
  if (r.status !== "ok") {
    return `${back}<h1>${tick}</h1><p class="lede">${esc(r.label)} has too few Qloo weekly points to price taste.
      It stays on the desk, flagged, with no cultural beta — the sample floor, shown rather than hidden.</p>`;
  }
  const s = SERIES?.[tick];
  const chart1 = s ? lineChart(s.dates, s.returns, s.taste, tick, "taste basket") : "<p>series unavailable</p>";
  let chart2 = "";
  if (s) {
    const ps = partialSlope(s.returns, s.index, s.basket);
    if (ps) chart2 = scatter(ps.ry, ps.rx, ps.slope, tick);
  }
  const weights = r.basketWeights.map((w) => `<div>${w.ticker}</div>
    <div class="track"><div class="fill" style="width:${(w.weight * 100).toFixed(0)}%"></div></div>
    <div>${(w.weight * 100).toFixed(1)}%</div>`).join("");
  return `${back}
  <div class="head">
    <div>
      <h1>${tick} <span class="thin">— ${esc(r.label)}</span></h1>
      <p class="sub">${r.flagged
        ? "Moves with the market and against taste. The index explains most of it; the taste factor pushes the other way."
        : "Moves with the market; its taste loading is measured, and its sign is what the desk charges for."}</p>
    </div>
    ${metaBlock(DESK.rows.filter((x) => x.status === "ok").length)}
  </div>
  <div class="big">
    <div class="stat"><b>${f2(r.marketBeta)}</b><small>market beta ± ${r.marketSE.toFixed(2)}</small></div>
    <div class="stat"><b style="color:${r.culturalBeta < 0 ? "var(--accent)" : "var(--good)"}">${f2(r.culturalBeta)}</b><small>cultural beta ± ${r.culturalSE.toFixed(2)}</small></div>
    <div class="stat"><b>${f2(r.culturalT, 1)}</b><small>t-stat · p ${r.culturalP < 0.001 ? "<.001" : r.culturalP.toFixed(3)}</small></div>
    <div class="stat"><b>${r.r2.toFixed(2)}</b><small>r² · ${r.weeks} weeks</small></div>
  </div>
  <div class="cards">
    <div class="card"><h3>Price and taste, 106 weeks — both indexed to 100</h3>${chart1}</div>
    <div class="card"><h3>Taste basket — shared-audience weights (Qloo affinity)</h3>
      <div class="wh">${weights}</div>
      <p class="muted" style="font-size:12px;margin-top:14px">Leave-one-out: ${tick} is never in its own basket. Weights are normalised affinity scores from Qloo /v2/insights.</p>
    </div>
    <div class="card" style="grid-column:1/-1"><h3>Why the slope is the cultural beta</h3>${chart2}
      <p class="muted" style="font-size:12px">Both axes are residualised on SPY, so the slope is the partial coefficient — Frisch–Waugh–Lovell; identical to the regression in the desk.</p>
    </div>
  </div>`;
}

function mapView() {
  const ok = DESK.rows.filter((r) => r.status === "ok");
  const negative = ok.filter((r) => r.culturalBeta < 0).map((r) => r.ticker);
  return `
  <div class="head">
    <div><h1>Taste <span class="thin">map.</span></h1>
      <p class="sub">Every holding placed by how it moves with the market (x) and with taste (y).
      The interesting corner is bottom-right: it takes market risk, and taste is working against it.</p></div>
    ${metaBlock(ok.length)}
  </div>
  <div class="cards">
    <div class="card" style="grid-column:1/-1"><h3>The book, priced two ways</h3>${quadrant(ok)}</div>
  </div>
  <p class="lede">${negative.length
    ? `${negative.join(", ")} ${negative.length === 1 ? "carries" : "carry"} a negative cultural beta — taste is a headwind, not a tailwind, for ${negative.length === 1 ? "it" : "them"}.`
    : "Every priced name currently loads positively on taste."}</p>`;
}

function evidenceView() {
  const rows = EVIDENCE.rows.map((r) => r.status === "ok"
    ? `<tr><td><b>${r.ticker}</b></td>
        <td>${esc(r.provenance.qlooRequest?.entity || "—")}</td>
        <td>GET ${esc(r.provenance.qlooRequest?.path || "")}</td>
        <td>${esc((r.provenance.qlooRequest?.window || []).join(" → "))}</td>
        <td>${esc(r.provenance.trending)}<br>${esc(r.provenance.affinity)}</td></tr>`
    : `<tr><td><b>${r.ticker}</b></td><td colspan="4" class="muted">insufficient signal — no beta printed</td></tr>`).join("");
  const urls = Object.entries(EVIDENCE.pricesSource?.requestUrls || {})
    .map(([s, u]) => `<div class="prow"><b>${s}</b><span>${esc(u)}</span></div>`).join("");
  return `
  <div class="head">
    <div><h1>Evidence <span class="thin">desk.</span></h1>
      <p class="sub">Every number on the desk, and the request it came from. The Qloo API does not return
      request ids, so provenance is the exact request plus the cached raw response — held locally, never committed.</p></div>
    ${metaBlock(EVIDENCE.rows.filter((r) => r.status === "ok").length)}
  </div>
  <div class="cards">
    <div class="card" style="grid-column:1/-1"><h3>Qloo requests behind the cultural betas</h3>
      <div class="tw"><table><thead><tr><th>Holding</th><th>Qloo entity</th><th>Endpoint</th><th>Window</th><th>Cached response</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    </div>
    <div class="card"><h3>Price evidence</h3>
      <div class="ev">${urls}</div>
      <p class="muted" style="font-size:12px;margin-top:10px">Committed in fixtures/prices.json. 106 aligned weekly returns per name, window ${EVIDENCE.window.start} → ${EVIDENCE.window.end}.</p>
    </div>
    <div class="card"><h3>Factor construction</h3>
      <p style="font-size:13.5px">${esc(EVIDENCE.factorConstruction)}</p>
      <p class="muted" style="font-size:12px">Null route: with Qloo responses emptied the desk refuses to print — enforced by tests/nullroute.test.mjs. Sample floor: a holding with fewer than 100 weekly points keeps its row and loses its beta.</p>
    </div>
  </div>`;
}

/* ---------- router ---------- */
function route() {
  const h = location.hash || "#/";
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on",
    (h === "#/" && a.dataset.tab === "desk") || (h.startsWith("#/map") && a.dataset.tab === "map") || (h.startsWith("#/evidence") && a.dataset.tab === "evidence")));
  const v = $("#view");
  if (!DESK) { v.innerHTML = refuseView(); wire(); return; }
  if (h.startsWith("#/holding/")) v.innerHTML = holdingView(decodeURIComponent(h.split("/")[2] || ""));
  else if (h.startsWith("#/map")) v.innerHTML = mapView();
  else if (h.startsWith("#/evidence")) v.innerHTML = evidenceView();
  else v.innerHTML = deskView();
  wire();
}

function wire() {
  document.querySelectorAll("th.sort").forEach((th) => th.onclick = () => {
    const k = th.dataset.k;
    if (k === sortKey) sortDir *= -1; else { sortKey = k; sortDir = k === "ticker" ? 1 : -1; }
    route();
  });
  document.querySelectorAll("tr.link").forEach((tr) => tr.onclick = (e) => {
    if (e.target.closest("a")) return;
    location.hash = `#/holding/${tr.dataset.h}`;
  });
}

window.addEventListener("hashchange", route);
$("#recompute").onclick = async () => {
  const btn = $("#recompute"); btn.disabled = true; btn.textContent = "Working…";
  try {
    const r = await fetch("/api/recompute", { method: "POST" });
    const j = await r.json();
    if (r.ok) { $("#note-live").textContent = "Desk refreshed from a live Qloo run just now."; await load(); }
    else { DESK = null; SERIES = null; EVIDENCE = null;
      const m = await get("/api/market-only.json"); if (m.ok) MARKET = m.data;
      route();
      $("#note-live").textContent = "Live run refused: " + (((j.log?.at(-1)?.err || "") + "").split("\n")[0].slice(0, 140)); }
  } catch (e) { $("#note-live").textContent = "Live run failed: " + e.message; }
  btn.disabled = false; btn.textContent = "Refresh from Qloo";
};

load();
