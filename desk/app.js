/* Cultural Beta desk — dependency-free SPA. Views: desk, holding, taste map, evidence. */
const $ = (s) => document.querySelector(s);
const f2 = (x, d = 2) => x == null ? "—" : (x >= 0 ? "+" : "") + x.toFixed(d);
const pts = (x) => x == null ? "—" : (x >= 0 ? "+" : "") + (x * 100).toFixed(Math.abs(x * 100) < 1 ? 2 : 1) + " pts";
const pval = (p) => p == null ? "—" : p < 0.001 ? "< 0.001" : p.toFixed(3);
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
  const ptsHtml = ry.map((v, i) => `<circle cx="${x(rx[i]).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.6" fill="var(--ink)" opacity=".55"/>`).join("");
  const x0 = minx, x1 = maxx;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Residualised return against residualised taste basket">
    <line class="axis" x1="${pad2.l}" x2="${W - pad2.r}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>
    <line class="axis" x1="${x(0).toFixed(1)}" x2="${x(0).toFixed(1)}" y1="${pad2.t}" y2="${H - pad2.b}"/>
    <line x1="${x(x0).toFixed(1)}" y1="${y(slope * x0).toFixed(1)}" x2="${x(x1).toFixed(1)}" y2="${y(slope * x1).toFixed(1)}" stroke="var(--accent)" stroke-width="1.6" stroke-dasharray="5 4"/>
    ${ptsHtml}
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
    const pts = rows.map((r) => ({ t: r.ticker, cx: x(r.marketBeta), cy: y(r.culturalBeta), neg: r.culturalBeta < 0 }));
    const dotBoxes = pts.map((p) => ({ x0: p.cx - 9, x1: p.cx + 9, y0: p.cy - 9, y1: p.cy + 9 }));
    const textWidth = (t) => t.length * 6.6 + 4;
    return pts.slice().sort((a, b) => b.cy - a.cy).map((p) => {
      const w = textWidth(p.t);
      const cands = [
        { lx: p.cx + 11, ly: p.cy + 3.5, anchor: "start" },
        { lx: p.cx + 11, ly: p.cy - 8, anchor: "start" },
        { lx: p.cx - 11, ly: p.cy + 3.5, anchor: "end" },
        { lx: p.cx + 11, ly: p.cy + 15, anchor: "start" },
        { lx: p.cx - 11, ly: p.cy + 15, anchor: "end" },
      ];
      let box = null, pick = cands[0];
      for (const c of cands) {
        const x0 = c.anchor === "start" ? c.lx : c.lx - w;
        const b = { x0, x1: x0 + w, y0: c.ly - 9, y1: c.ly + 3 };
        const hitsLabel = placed.some((q) => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0);
        const hitsDot = dotBoxes.some((q) => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0);
        if (!hitsLabel && !hitsDot) { pick = c; box = b; break; }
      }
      if (!box) {
        box = { x0: pick.lx, x1: pick.lx + w, y0: pick.ly - 9, y1: pick.ly + 3 };
      }
      placed.push(box);
      return `<g>
      <circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="7" fill="${p.neg ? "var(--accent)" : "var(--good)"}" opacity=".9"/>
      <text class="anno" x="${pick.lx.toFixed(1)}" y="${pick.ly.toFixed(1)}" text-anchor="${pick.anchor}">${p.t}</text>
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
function windowPill(w) { return `<span class="pill">${w.weeks} weeks · ${w.start} → ${w.end}</span>`; }

function headBlock(title, sub, w, state, tone, action = true) {
  return `<div class="head">
    <div class="lede-col">
      <h1>${title}</h1>
      <p class="sub">${sub}</p>
    </div>
    <div class="side">
      ${windowPill(w)}
      <div class="state ${tone}">${state}</div>
      ${action ? `<button class="btn" id="recompute">Recompute from Qloo</button>` : ""}
    </div>
  </div>`;
}

function strip(stats) {
  return `<div class="strip">${stats.map(([v, l, hl]) =>
    `<div class="stat${hl ? " hl" : ""}"><b>${v}</b><span>${l}</span></div>`).join("")}</div>`;
}

function robustBand(va) {
  if (!va?.oos) return "";
  const oos = va.oos, pl = va.placebo;
  const holds = oos.meanDeltaR2 > 0;
  const sep = !!pl && pl.p <= 0.10;
  return `<section class="robust" aria-label="Robustness">
    <div class="rb-head"><h2>Does it survive?</h2>
      <p class="rb-sub">Two checks a sceptical reader asks for before believing a factor. The rotation verdict is tagged at p ≤ 0.10.</p></div>
    <div class="rb-grid">
      <div class="rb-test">
        <div class="rb-k">Out of sample</div>
        <div class="rb-v ${holds ? "good" : "bad"}">${pts(oos.meanDeltaR2)}</div>
        <div class="rb-tag ${holds ? "good" : "bad"}">${holds ? "holds" : "does not hold"}</div>
        <p>Refit on the first ${oos.trainWeeks} weeks, scored on the last ${oos.testWeeks}. Mean ΔR² over market-only on weeks the fit never saw — allowed to be negative, never clamped.</p>
      </div>
      <div class="rb-test">
        <div class="rb-k">Placebo</div>
        <div class="rb-v ${sep ? "good" : "bad"}">p ${pl ? pval(pl.p) : "—"}</div>
        <div class="rb-tag ${sep ? "good" : "bad"}">${sep ? "beats rotation" : "not separable"}</div>
        <p>${pl ? `${pl.draws} circular rotations of the taste baskets, all holdings shifted together. Real ${pts(pl.real)} vs rotations ${pts(pl.placeboMean)}.` : ""}</p>
      </div>
    </div>
  </section>`;
}

function impactBlock(live) {
  return `<section class="use" aria-label="How the desk is used">
    <div class="use-head"><h2>The reading, and what it is for</h2>
      <p>${live ? "A screen, not a signal service." : "The workflow the keyed run unlocks — steps 2 and 3 need live Qloo data."}</p></div>
    <ol class="use-steps">
      <li><b>Screen</b><span>A PM already models market beta. Cultural beta separates the part of that movement that tracks consumer taste — exposure a fundamentals model leaves unnamed.</span></li>
      <li><b>Read</b><span>A flag marks a name whose taste exposure is negative and distinguishable from zero: a measured headwind, not a forecast.</span></li>
      <li><b>Re-check</b><span>Re-run the same fixed ${live ? "window" : "106-week window"} after a campaign, a brand shock or an earnings cycle, and see whether the measured exposure moved — or whether the quarter was just market.</span></li>
    </ol>
    <p class="use-not"><b>Not</b> sizing, hedging, routing or advice. The desk measures exposure; it does not act on it.</p>
  </section>`;
}

function policyBlock() {
  return `<div class="policy">
    <div>
      <h2>No Qloo. No factor.</h2>
      <p>The desk will not print a cultural beta it cannot trace to a live Qloo response, and it will
      never fall back to zero. Set <code>QLOO_API_KEY</code>, run the pipeline, and every withheld cell
      fills from one live pass: entity search, weekly trending, affinity, then the regression.</p>
      <button class="btn ghost" id="recompute">Recompute from Qloo</button>
      <p class="caption">Without a key the endpoint answers with a refusal, not a zero-filled run.</p>
    </div>
    <dl class="ledger">
      <dt>Live</dt><dd>${MARKET.window.weeks} weekly returns × ${MARKET.rows.length} names<br>${MARKET.window.start} → ${MARKET.window.end}<br>Yahoo Finance · committed fixture</dd>
      <dt>Withheld</dt><dd>taste series · cultural betas<br>taste-risk flags · ΔR² from taste<br>out-of-sample ΔR² · placebo p</dd>
      <dt>Source</dt><dd>Qloo /v2/trending<br>Qloo /v2/insights</dd>
    </dl>
  </div>`;
}

function coldTable() {
  const rows = MARKET.rows.map((r) => `<tr class="link" data-ev="${r.ticker}">
    <td class="c-name" data-l="Holding"><span class="tick">${r.ticker}</span><span class="name">${esc(r.label)}</span></td>
    <td class="num" data-l="Market beta"><span class="val"><span class="v">${f2(r.marketBeta)}</span><span class="se">± ${r.marketSE.toFixed(2)}</span></span></td>
    <td class="num c-cult" data-l="Cultural beta" data-c="cultural"><span class="waitbar" aria-hidden="true"></span><span class="val"><span class="withheld">withheld</span></span></td>
    <td class="c-sig" data-l="Signal"><span class="signal none">—</span></td>
    <td class="ta" data-l="Trace"><a class="tracelink" href="#/evidence/${r.ticker}">trace</a></td>
  </tr>`).join("");
  return `<div class="tw">
    <table class="desk-table" data-audit="holdings">
      <thead><tr>
        <th>Holding</th>
        <th><span class="th">Market beta</span><span class="thsub">± std. error</span></th>
        <th><span class="th">Cultural beta</span><span class="thsub">± std. error</span></th>
        <th><span class="th">Signal</span><span class="thsub">|t| ≥ 2</span></th>
        <th class="th-right"></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function liveTable() {
  const rows = [...DESK.rows].sort((a, b) => {
    const av = a[sortKey] ?? -Infinity, bv = b[sortKey] ?? -Infinity;
    return (av - bv) * sortDir || a.ticker.localeCompare(b.ticker);
  });
  const arrow = (k) => `<span class="arrow">${k === sortKey ? (sortDir > 0 ? "▲" : "▼") : ""}</span>`;
  const maxAbs = Math.max(1, ...rows.filter((r) => r.status === "ok").map((r) => Math.abs(r.culturalBeta)));
  const body = rows.map((r) => {
    if (r.status !== "ok") {
      return `<tr>
        <td class="c-name" data-l="Holding"><span class="tick">${r.ticker}</span><span class="name">${esc(r.label)}</span></td>
        <td class="num" data-l="Market beta"><span class="signal ins">insufficient signal</span></td>
        <td class="num c-cult" data-l="Cultural beta"><span class="signal ins">not printed</span></td>
        <td class="c-sig" data-l="Signal"><span class="signal ins">—</span></td>
        <td class="ta" data-l="Trace"><a class="tracelink" href="#/evidence/${r.ticker}">trace</a></td></tr>`;
    }
    const b = r.culturalBeta, pct = Math.abs(b) / maxAbs * 50;
    return `<tr class="link" data-h="${r.ticker}">
      <td class="c-name" data-l="Holding"><span class="tick">${r.ticker}</span><span class="name">${esc(r.label)}</span></td>
      <td class="num" data-l="Market beta"><span class="val"><span class="v">${f2(r.marketBeta)}</span><span class="se">± ${r.marketSE.toFixed(2)}</span></span></td>
      <td class="num c-cult ${b < 0 ? "neg" : ""}" data-l="Cultural beta">
        <div class="bar"><i class="${b >= 0 ? "pos" : "negs"}" style="width:${pct}%"></i></div>
        <span class="val"><span class="v">${f2(b)}</span><span class="se">± ${r.culturalSE.toFixed(2)}</span></span></td>
      <td class="c-sig" data-l="Signal">${r.flagged ? '<span class="signal risk">● taste risk</span>' : '<span class="signal none">—</span>'}</td>
      <td class="ta" data-l="Trace"><a class="tracelink" href="#/evidence/${r.ticker}">trace</a></td></tr>`;
  }).join("");
  return `<div class="tw">
    <table class="desk-table" data-audit="holdings">
      <thead><tr>
        <th class="sort" data-k="ticker">Holding ${arrow("ticker")}</th>
        <th class="sort" data-k="marketBeta"><span class="th">Market beta</span><span class="thsub">± std. error</span></th>
        <th class="sort" data-k="culturalBeta"><span class="th">Cultural beta ${arrow("culturalBeta")}</span><span class="thsub">± std. error · Qloo</span></th>
        <th><span class="th">Signal</span><span class="thsub">|t| ≥ 2</span></th>
        <th class="th-right"></th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

/* ---------- views ---------- */
function deskView() {
  if (!DESK) {
    if (!MARKET) return `<div class="head"><div class="lede-col"><h1>Taste is a <span class="thin">risk factor.</span></h1>
      <p class="sub">The desk server is not answering. Start it with <code>npm start</code> and reload.</p></div></div>`;
    const w = MARKET.window;
    return `${headBlock("Taste is a <span class=\"thin\">risk factor.</span>",
      "Market beta prices how a stock moves with the index. Cultural beta prices how much of that movement is exposure to taste — built from Qloo weekly trend data and read next to the market number.",
      w, "price half live · taste factor locked", "warn", false)}
    <div class="notice" role="status">
      <span class="dot"></span>
      <span class="notice-text"><b>Cultural factor locked.</b> No Qloo response is connected to this build, so no taste beta is printed.
      The market half below is live for all seven names.</span>
      <a class="notice-link" href="#/evidence">What is withheld →</a>
    </div>
    ${strip([["7", "holdings"], ["106", "aligned weeks"], ["7", "market betas, live"], ["0", "taste betas"]])}
    ${coldTable()}
    <p class="caption">Market beta is a one-regressor fit of weekly return on ${esc(MARKET.index.label)}. It needs no Qloo data,
    so it is shown; the cultural column stays withheld until a live Qloo run fills it.
    That first keyed run also prints ΔR² from taste, the median |t| of the cultural betas,
    an out-of-sample ΔR² fitted on the first 70 weeks and scored on the last 36, and a circular-rotation
    placebo p over 400 draws. The signal column flags a cultural beta that is negative with |t| ≥ 2.</p>
    ${impactBlock(false)}
    ${policyBlock()}`;
  }
  const ok = DESK.rows.filter((r) => r.status === "ok");
  const flagged = ok.filter((r) => r.flagged).length;
  const va = DESK.valueAdd;
  return `${headBlock("Taste is a <span class=\"thin\">risk factor.</span>",
    "Market beta prices how a stock moves with the index. Cultural beta prices how much of that movement is exposure to taste — built from Qloo weekly trend data and read next to the market number.",
    DESK.window, `${ok.length}/${DESK.rows.length} holdings priced · live Qloo`, "ok")}
    ${strip([
      [String(DESK.rows.length), "holdings"],
      [String(DESK.window.weeks), "aligned weeks"],
      [String(flagged), flagged === 1 ? "taste-risk flag" : "taste-risk flags"],
      [pts(va?.meanDeltaR2), "ΔR² from taste", true],
      [va ? va.medianAbsCulturalT.toFixed(2) : "—", "median |t|, cultural"],
    ])}
    ${liveTable()}
    <p class="caption">Flag rule: cultural beta negative with |t| ≥ 2 — a measured headwind, not an instruction.
    Click a holding for its full reading. ${va ? `The taste basket adds ${pts(va.meanDeltaR2)} of in-sample r² on average (market ${va.meanMarketR2.toFixed(3)} → ${va.meanFullR2.toFixed(3)}); the median |t| of the cultural betas is ${va.medianAbsCulturalT.toFixed(2)}, so this is a signal strength, not a guarantee.` : ""}</p>
    ${robustBand(va)}
    ${impactBlock(true)}`;
}

function holdingView(tick) {
  const r = DESK.rows.find((x) => x.ticker === tick);
  if (!r) return `<p>Unknown holding.</p>`;
  const back = `<a class="back" href="#/">← back to the desk</a>`;
  if (r.status !== "ok") {
    return `${back}<h1>${tick}</h1><p class="lede">${esc(r.label)} has too few Qloo weekly points to price taste.
      It stays on the desk, flagged, with no cultural beta — the sample floor, shown rather than hidden.</p>`;
  }
  const sig = Math.abs(r.culturalT) >= 2;
  const verdict = r.flagged
    ? "Flag raised: taste is a significant headwind."
    : sig ? "Significant, and with taste — a tailwind, not a risk flag."
    : "Not significant at |t| ≥ 2. Measured, and not charged.";
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
    <div class="lede-col">
      <h1>${tick} <span class="thin">— ${esc(r.label)}</span></h1>
      <p class="sub">${verdict}</p>
    </div>
    <div class="side">${windowPill(DESK.window)}
      <div class="state ok">${DESK.rows.filter((x) => x.status === "ok").length}/${DESK.rows.length} holdings priced · live Qloo</div>
    </div>
  </div>
  <div class="big">
    <div class="stat"><b>${f2(r.marketBeta)}</b><small>market beta ± ${r.marketSE.toFixed(2)}</small></div>
    <div class="stat"><b style="color:${r.culturalBeta < 0 ? "var(--accent)" : "var(--good)"}">${f2(r.culturalBeta)}</b><small>cultural beta ± ${r.culturalSE.toFixed(2)}</small></div>
    <div class="stat"><b>${f2(r.culturalT, 1)}</b><small>t-stat · p ${r.culturalP < 0.001 ? "<.001" : r.culturalP.toFixed(3)}</small></div>
    <div class="stat"><b>${pts(r.deltaR2)}</b><small>ΔR² over market only</small></div>
    <div class="stat"><b>${r.r2.toFixed(2)}</b><small>r² · ${r.weeks} weeks</small></div>
  </div>
  ${r.oos ? `<p class="rb-line">Out of sample: <b>${pts(r.oos.deltaR2)}</b> ΔR² on the last ${r.oos.testWeeks} weeks, refit on the first ${r.oos.trainWeeks}${r.placeboP != null ? ` · placebo <b>p ${pval(r.placeboP)}</b>` : ""}.
    ${r.oos.deltaR2 < 0 ? "Negative — the basket did not generalise for this name." : "Positive — the basket helped on weeks it was not fitted on."}</p>` : ""}
  <div class="cards">
    <div class="card"><h3>Price and taste, ${r.weeks} weeks — both indexed to 100</h3>${chart1}</div>
    <div class="card"><h3>Taste basket — shared-audience weights (Qloo affinity)</h3>
      <div class="wh">${weights}</div>
      <p class="muted" style="font-size:12px;margin-top:14px">Leave-one-out: ${tick} is never in its own basket. Weights are normalised affinity scores from Qloo /v2/insights.</p>
    </div>
    <div class="card wide"><h3>Why the slope is the cultural beta</h3>${chart2}
      <p class="muted" style="font-size:12px">Both axes are residualised on SPY, so the slope is the partial coefficient — Frisch–Waugh–Lovell; identical to the regression in the desk.</p>
    </div>
  </div>
  <p class="caption">Source: ${esc(r.provenance.trending)} · ${esc(r.provenance.affinity)} · ${esc(r.provenance.prices)}.
  <a href="#/evidence/${tick}">Open the evidence row →</a></p>`;
}

function mapView() {
  const ok = DESK.rows.filter((r) => r.status === "ok");
  const negative = ok.filter((r) => r.culturalBeta < 0).map((r) => r.ticker);
  return `
  <div class="head">
    <div class="lede-col"><h1>Taste <span class="thin">map.</span></h1>
      <p class="sub">Every holding placed by how it moves with the market (x) and with taste (y).
      The interesting corner is bottom-right: it takes market risk, and taste is working against it.</p></div>
    <div class="side">${windowPill(DESK.window)}
      <div class="state ok">${ok.length}/${DESK.rows.length} holdings priced · live Qloo</div>
    </div>
  </div>
  <div class="cards">
    <div class="card wide"><h3>The book, priced two ways</h3>${quadrant(ok)}</div>
  </div>
  <p class="lede">${negative.length
    ? `${negative.join(", ")} ${negative.length === 1 ? "carries" : "carry"} a negative cultural beta — taste is a headwind, not a tailwind, for ${negative.length === 1 ? "it" : "them"}.`
    : "Every priced name currently loads positively on taste."}</p>`;
}

function evidenceRows(rows) {
  return rows.map((r) => r.status === "ok"
    ? `<tr id="ev-${r.ticker}"><td><b>${r.ticker}</b></td>
        <td class="th-left" data-l="Qloo entity">${esc(r.provenance.qlooRequest?.entity || "—")}</td>
        <td class="th-left" data-l="Endpoint">GET ${esc(r.provenance.qlooRequest?.path || "")}</td>
        <td class="th-left" data-l="Window">${esc((r.provenance.qlooRequest?.window || []).join(" → "))}</td>
        <td data-l="Cached response">${esc(r.provenance.trending)}<br>${esc(r.provenance.affinity)}</td></tr>`
    : `<tr id="ev-${r.ticker}"><td><b>${r.ticker}</b></td><td colspan="4" class="muted">insufficient signal — no beta printed</td></tr>`).join("");
}

function limitsCard(w, va) {
  const oos = va?.oos, pl = va?.placebo;
  const oosTxt = oos
    ? `Out of sample, the same two-regressor fit is re-estimated on the first ${oos.trainWeeks} weeks and scored on the last ${oos.testWeeks}, where it added ${pts(oos.meanDeltaR2)} on average. That number is reported as computed, including when it is negative.`
    : "Out of sample, the fit is re-estimated on an early sub-window and scored on the rest; a negative result is reported as negative.";
  const plTxt = pl
    ? `The book's mean ΔR² is re-computed against ${pl.draws} circular rotations of the taste baskets, every holding shifted by the same amount so cross-holding alignment survives. Real ${pts(pl.real)} against a rotation mean of ${pts(pl.placeboMean)}, p = ${pval(pl.p)}. A high p means the factor cannot be told apart from a rotation of itself on this book.`
    : "Rotating the taste series against returns asks whether the real alignment beats a placebo.";
  return `<div class="card wide"><h3>What this desk is, and is not</h3>
    <ul class="limits">
      <li><b>Universe.</b> Seven large-cap US consumer names chosen to span beauty, athletic apparel, restaurants and media — a readable sector spread, not a screen. One index (SPY), one window.</li>
      <li><b>Window.</b> 106 weekly returns ending ${esc(w.end)}, fixed before estimation. No weight, window or threshold was tuned on these returns.</li>
      <li><b>Multiple testing.</b> Seven |t| ≥ 2 tests. If they were independent, the chance of at least one false flag would be about 30% (1 − 0.95⁷); they are not independent. Read the flag as a screen, not a verdict.</li>
      <li><b>ΔR², twice.</b> In-sample, it shows the taste basket adds information inside the fitted window. ${oosTxt}</li>
      <li><b>Placebo.</b> ${plTxt}</li>
      <li><b>No trading.</b> The desk measures exposure. It does not size, weight, route or recommend a position.</li>
    </ul>
  </div>`;
}

function evidenceView(tick) {
  if (!EVIDENCE) {
    if (!MARKET) return `<div class="head"><div class="lede-col"><h1>Evidence <span class="thin">desk.</span></h1>
      <p class="sub">The desk server is not answering. Start it with <code>npm start</code> and reload.</p></div></div>`;
    const urls = Object.entries(MARKET.pricesSource?.requestUrls || {})
      .map(([s, u]) => `<tr${s === tick ? ' class="hl"' : ""}><td><b>${s}</b></td><td class="url" data-l="Request">${esc(u)}</td><td class="num" data-l="Weeks">${MARKET.window.weeks}</td></tr>`).join("");
    return `${headBlock("Evidence <span class=\"thin\">desk.</span>",
      "Every number on the desk, and the request it came from. The price half is live and traceable now; the Qloo requests are listed with what they will supply.",
      MARKET.window, "price half live · taste factor locked", "warn")}
    <div class="cards">
      <div class="card wide"><h3>Price requests — live</h3>
        <div class="tw"><table>
          <thead><tr><th>Symbol</th><th class="th-left">Yahoo Finance request</th><th><span class="th">Weeks</span></th></tr></thead>
          <tbody>${urls}</tbody></table></div>
        <p class="muted" style="font-size:12px;margin-top:10px">Committed in fixtures/prices.json. Weekly bars, ${MARKET.window.start} → ${MARKET.window.end}, aligned to one calendar before any regression runs.</p>
      </div>
      <div class="card wide"><h3>Qloo requests — run when the key is connected</h3>
        <div class="tw"><table>
          <thead><tr><th class="th-left">Endpoint</th><th class="th-left">Supplies</th></tr></thead>
          <tbody>
            <tr><td class="url" data-l="Endpoint">GET /search</td><td class="th-left" data-l="Supplies">entity id for each holding</td></tr>
            <tr><td class="url" data-l="Endpoint">GET /v2/trending</td><td class="th-left" data-l="Supplies">weekly taste momentum · velocity_fold_change</td></tr>
            <tr><td class="url" data-l="Endpoint">GET /v2/insights</td><td class="th-left" data-l="Supplies">shared-audience affinity → basket weights</td></tr>
          </tbody></table></div>
        <p class="muted" style="font-size:12px;margin-top:10px">Raw Qloo responses are cached locally under fixtures/qloo/ and never committed: the hackathon terms keep response data out of public repositories.</p>
      </div>
      ${limitsCard(MARKET.window)}
    </div>`;
  }
  const rows = evidenceRows(EVIDENCE.rows);
  const urls = Object.entries(EVIDENCE.pricesSource?.requestUrls || {})
    .map(([s, u]) => `<div class="prow"><b>${s}</b><span>${esc(u)}</span></div>`).join("");
  return `
  <div class="head">
    <div class="lede-col"><h1>Evidence <span class="thin">desk.</span></h1>
      <p class="sub">Every number on the desk, and the request it came from. The Qloo API does not return
      request ids, so provenance is the exact request plus the cached raw response — held locally, never committed.</p></div>
    <div class="side">${windowPill(EVIDENCE.window)}
      <div class="state ok">${EVIDENCE.rows.filter((r) => r.status === "ok").length}/${EVIDENCE.rows.length} holdings priced · live Qloo</div>
    </div>
  </div>
  <div class="cards">
    <div class="card wide"><h3>Qloo requests behind the cultural betas</h3>
      <div class="tw"><table data-audit="holdings"><thead><tr><th>Holding</th><th class="th-left">Qloo entity</th><th class="th-left">Endpoint</th><th class="th-left">Window</th><th class="th-left">Cached response</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    </div>
    <div class="card"><h3>Price evidence</h3>
      <div class="ev">${urls}</div>
      <p class="muted" style="font-size:12px;margin-top:10px">Committed in fixtures/prices.json. ${EVIDENCE.window.weeks} aligned weekly returns per name, window ${EVIDENCE.window.start} → ${EVIDENCE.window.end}.</p>
    </div>
    <div class="card"><h3>Factor construction</h3>
      <p style="font-size:13.5px">${esc(EVIDENCE.factorConstruction)}</p>
      <p class="muted" style="font-size:12px">Null route: with Qloo responses emptied the desk refuses to print — enforced by tests/nullroute.test.mjs. Sample floor: a holding with fewer than 100 weekly points keeps its row and loses its beta.</p>
    </div>
    ${limitsCard(EVIDENCE.window, EVIDENCE.valueAdd)}
  </div>`;
}

/* ---------- router ---------- */
function setTabs(hash) {
  document.querySelectorAll(".tabs a").forEach((a) => {
    const on = (a.dataset.tab === "desk" && (hash === "#/" || hash.startsWith("#/holding/")))
      || (hash.startsWith("#/map") && a.dataset.tab === "map")
      || (hash.startsWith("#/evidence") && a.dataset.tab === "evidence");
    a.classList.toggle("on", on);
    if (a.dataset.tab === "map") a.hidden = !DESK;
  });
}

function route() {
  let h = location.hash || "#/";
  document.body.dataset.mode = DESK ? "live" : "cold";
  const v = $("#view");
  if (DESK && h.startsWith("#/holding/")) v.innerHTML = holdingView(decodeURIComponent(h.split("/")[2] || ""));
  else if (DESK && h.startsWith("#/map")) v.innerHTML = mapView();
  else if (h.startsWith("#/evidence")) v.innerHTML = evidenceView(DESK ? decodeURIComponent(h.split("/")[2] || "") : "");
  else v.innerHTML = deskView();
  setTabs(h);
  wire(h);
}

function wire(hash) {
  document.querySelectorAll("th.sort").forEach((th) => th.onclick = () => {
    const k = th.dataset.k;
    if (k === sortKey) sortDir *= -1; else { sortKey = k; sortDir = k === "ticker" ? 1 : -1; }
    route();
  });
  document.querySelectorAll("tr.link").forEach((tr) => tr.onclick = (e) => {
    if (e.target.closest("a")) return;
    location.hash = tr.dataset.ev ? `#/evidence/${tr.dataset.ev}` : `#/holding/${tr.dataset.h}`;
  });
  const btn = $("#recompute");
  if (btn) btn.onclick = recompute;
  const target = hash.startsWith("#/evidence/") ? hash.split("/")[2] : "";
  const row = target ? document.getElementById("ev-" + decodeURIComponent(target)) : null;
  if (row) { row.classList.add("hl"); row.scrollIntoView({ block: "center" }); }
}

async function recompute() {
  const btn = $("#recompute");
  if (btn) { btn.disabled = true; btn.textContent = "Working…"; }
  try {
    const r = await fetch("/api/recompute", { method: "POST" });
    const j = await r.json();
    if (r.ok) { await load(); refreshNote("Desk refreshed from a live Qloo run just now."); }
    else {
      DESK = null; SERIES = null; EVIDENCE = null;
      const m = await get("/api/market-only.json"); if (m.ok) MARKET = m.data;
      route();
      const err = ((j.log?.at(-1)?.err || "") + "").split("\n")[0].slice(0, 140);
      refreshNote("Live run refused: " + err);
    }
  } catch (e) { refreshNote("Live run failed: " + e.message); }
  const again = $("#recompute");
  if (again) { again.disabled = false; again.textContent = "Recompute from Qloo"; }
}

function refreshNote(text) {
  const el = $("#note-live"); if (el) el.textContent = text;
}

window.addEventListener("hashchange", route);
load();
