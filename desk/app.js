/* Cultural Beta desk — dependency-free SPA. Views: desk, holding, taste map, evidence. */
const $ = (s) => document.querySelector(s);
const f2 = (x, d = 2) => x == null ? "—" : (x >= 0 ? "+" : "") + x.toFixed(d);
const pts = (x) => x == null ? "—" : (x >= 0 ? "+" : "") + (x * 100).toFixed(Math.abs(x * 100) < 1 ? 2 : 1) + " pts";
const ptsSigned = (x) => x == null ? "—" : (x >= 0 ? "+" : "-") + Math.abs(x * 100).toFixed(2) + " pts";
const pval = (p) => p == null ? "—" : p < 0.001 ? "< 0.001" : p.toFixed(3);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Every name gets a local logo (desk/logos/<ticker>.png, fetched once by
// scripts/fetch-logos.mjs), with a monogram underneath. If an image is missing or
// blocked the img removes itself and the monogram is what remains, so a row never
// shows a broken-image glyph and the layout never shifts when the image lands.
const monoOf = (s) => String(s ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "··";
// Marks published white-on-transparent vanish on the white tile; they sit on ink.
const DARK_TILE = new Set(["DIS"]);
function logoTile(ticker, label, size = "sm", eager = false) {
  return `<span class="logo-wrap ${size}${DARK_TILE.has(String(ticker).toUpperCase()) ? " dark" : ""}" aria-hidden="true"><span class="logo-mono">${esc(monoOf(ticker || label))}</span><img src="logos/${encodeURIComponent(ticker)}.png" alt="" ${eager ? "" : 'loading="lazy"'} decoding="async" onerror="this.remove()"></span>`;
}

let DESK = null, SERIES = null, EVIDENCE = null, MARKET = null, BUDGET = null, AGENT = null;
let BOOTING = true;
let MDE = null, BASKET = null;
let FRESH = null;
let ASK = { q: "", busy: false, res: null, err: null };
// Replay is a reading mode, not a preference: it lives in module state only, so a
// reload returns to today's desk. ?replay=1 exists so the audit can address it.
const REPLAY_ASOF = "2025-12-01";
const replayInUrl = () => /(?:[?&])replay=1(?:&|$)/.test(location.search) || /(?:[?&])replay=1(?:&|$)/.test(location.hash);
let ASK_REPLAY = replayInUrl();
let sortKey = "culturalQ", sortDir = 1, sectorFilter = "all", bookQuery = "", slashBound = false;

// 101 rows is a scroll, not a lookup. Matching is on the three things a reader would
// type — ticker, company name, sub-sector — and on folded text, so "keurig" and
// "beverages" both find KDP.
const foldText = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function matchesQuery(row, q) {
  const needle = foldText(q).trim();
  if (!needle) return true;
  return [row.ticker, row.label, row.sectorLabel, row.sector].some((v) => foldText(v).includes(needle));
}

// The state tag is derived from what computed the panel, never hardcoded: a
// stub-harness run renders "layout only" so a screenshot of it cannot be read as
// a Qloo result.
const isStub = () => DESK?.source?.kind === "stub harness";
const liveLabel = () => isStub() ? "stub harness · layout only" : "Qloo-sourced";
// The badge must not imply the cultural series is current: it is a paid pull whose
// last move is a property of the data, not of when the page was opened. 2025-12-22
// is the last week the taste series moves; it is not one of the four catalogue
// revision weeks the pipeline cuts (2025-04-07/14, 2025-10-13/20).
const frozenAfter = () => {
  const m = DESK?.valueAdd?.oos?.scoring?.lastMove;
  return m ? ` · taste series last moved ${m}` : "";
};
const liveTone = () => isStub() ? "warn" : "ok";

const get = async (p) => { const r = await fetch(p); return { ok: r.ok, data: r.ok ? await r.json() : null }; };

async function load() {
  const [d, s, e, m, b, a, f, md, bs] = await Promise.all([get("/api/desk.json"), get("/api/series.json"), get("/api/evidence.json"), get("/api/market-only.json"), get("/api/budget.json"), get("/api/agent.json"), get("/api/freshness.json"), get("/api/mde.json"), get("/api/basket-sensitivity.json")]);
  DESK = d.ok ? d.data : null; SERIES = s.ok ? s.data : null; EVIDENCE = e.ok ? e.data : null; MARKET = m.ok ? m.data : null;
  BUDGET = b.ok ? b.data : null; AGENT = a.ok ? a.data : null; FRESH = f.ok ? f.data : null;
  // Two optional analyses: a 503 or a missing file leaves them null and the sections
  // that read them print "not computed" rather than a guess.
  MDE = md.ok ? md.data : null; BASKET = bs.ok ? bs.data : null;
  BOOTING = false;
  route();
  document.body.dataset.ready = "1";
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

// One dot per sub-sector, not per name: a hundred names is a cloud, eleven dots is
// a reading — and each dot is the mean exposure of the names it stands for.
function quadrant(points) {
  const pad2 = { l: 56, r: 24, t: 22, b: 40 };
  const xs = points.map((r) => r.marketBeta), ys = points.map((r) => r.culturalBeta);
  const maxx = Math.max(0.5, ...xs) * 1.15, minx = 0;
  const maxAbsY = Math.max(0.1, ...ys.map(Math.abs)) * 1.3;
  const r = (n) => 6 + Math.sqrt(n) * 2.2;
  const x = (v) => pad2.l + ((v - minx) / (maxx - minx)) * (W - pad2.l - pad2.r);
  const y = (v) => H - pad2.b - ((v + maxAbsY) / (2 * maxAbsY)) * (H - pad2.t - pad2.b);
  const dots = (() => {
    const placed = [];
    const pts = points.map((p) => ({ t: p.ticker, cx: x(p.marketBeta), cy: y(p.culturalBeta), neg: p.culturalBeta < 0, n: p.n, label: p.label, sector: p.id, members: p.members }));
    const dotBoxes = pts.map((p) => ({ x0: p.cx - r(p.n) - 2, x1: p.cx + r(p.n) + 2, y0: p.cy - r(p.n) - 2, y1: p.cy + r(p.n) + 2 }));
    const textWidth = (t) => t.length * 6.6 + 4;
    const boxFor = (c, w) => {
      const x0 = c.anchor === "start" ? c.lx : c.lx - w;
      return { x0, x1: x0 + w, y0: c.ly - 9, y1: c.ly + 3 };
    };
    const hits = (b) => placed.some((q) => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0)
      || dotBoxes.some((q) => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0);
    return pts.slice().sort((a, b) => b.cy - a.cy).map((p) => {
      const w = textWidth(p.t);
      // the offset clears this dot's own radius, otherwise every candidate sits
      // inside its own dot box and the first one is always chosen.
      const off = r(p.n) + 6;
      const base = [
        { lx: p.cx + off, ly: p.cy + 3.5, anchor: "start" },
        { lx: p.cx - off, ly: p.cy + 3.5, anchor: "end" },
        { lx: p.cx + off, ly: p.cy - 10, anchor: "start" },
        { lx: p.cx - off, ly: p.cy - 10, anchor: "end" },
        { lx: p.cx + off, ly: p.cy + 16, anchor: "start" },
        { lx: p.cx - off, ly: p.cy + 16, anchor: "end" },
      ];
      let pick = base[0], box = boxFor(pick, w);
      for (const c of base) {
        const b = boxFor(c, w);
        if (!hits(b)) { pick = c; box = b; break; }
      }
      if (hits(box)) {
        for (const dy of [24, 32, -18, -26, 40, -34, 48, -42]) {
          let found = null;
          for (const side of [1, -1]) {
            const c = { lx: p.cx + side * off, ly: p.cy + 3.5 + dy, anchor: side > 0 ? "start" : "end" };
            const b = boxFor(c, w);
            if (!hits(b)) { found = { c, b }; break; }
          }
          if (found) { pick = found.c; box = found.b; break; }
        }
      }
      placed.push(box);
      // a hairline from the dot to its label: two adjacent dots would otherwise
      // read as one two-line label, and the reader cannot tell which is which
      const tx = pick.anchor === "start" ? pick.lx - 3 : pick.lx + 3;
      const dx = tx - p.cx, dy = (pick.ly - 3) - p.cy;
      const len = Math.hypot(dx, dy) || 1;
      const sx = p.cx + (dx / len) * (r(p.n) + 1), sy = p.cy + (dy / len) * (r(p.n) + 1);
      return `<g class="dot" role="button" tabindex="0" data-sector="${esc(p.sector ?? "")}" aria-label="${esc(p.label)}: market beta ${f2(p.marketBeta)}, cultural beta ${f2(p.culturalBeta)}, ${p.n} names">
      <title>${esc(p.label)} — market ${f2(p.marketBeta)}, cultural ${f2(p.culturalBeta)}, ${p.n} names: ${esc(p.members.join(", "))}</title>
      <line class="leader" x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${(pick.ly - 3).toFixed(1)}"/>
      <circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="${r(p.n).toFixed(1)}" fill="${p.neg ? "var(--accent)" : "var(--good)"}" opacity=".9"/>
      <text class="anno" x="${pick.lx.toFixed(1)}" y="${pick.ly.toFixed(1)}" text-anchor="${pick.anchor}">${esc(p.t)}</text>
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
function windowPill(w) { return `<span class="pill" title="the last completed week with a price bar in the aligned calendar">${w.weeks} weeks · ${w.start} → ${w.end}</span>`; }

// `action` is the panel control, which only exists where a panel can be re-derived.
// `note` is the one fact that must survive the first screen on a phone.
function headBlock(title, sub, w, state, tone, action = true, note = "") {
  return `<div class="head">
    <div class="lede-col">
      <h1>${title}</h1>
      <p class="sub">${sub}</p>
    </div>
    <div class="side">
      ${windowPill(w)}
      <div class="state ${tone}">${state}</div>
      ${action ? `<button class="btn" id="recompute" title="re-derives the panel from the Qloo responses already cached — no new API calls, nothing spent">Re-derive the panel</button>` : ""}
    </div>
    ${note ? `<p class="head-note">${note}</p>` : ""}
  </div>`;
}

function strip(stats) {
  return `<div class="strip">${stats.map(([v, l, hl]) =>
    `<div class="stat${hl ? " hl" : ""}"><b>${v}</b><span>${l}</span></div>`).join("")}</div>`;
}

function rbCells(oos, pl, perm) {
  const sc = oos.scoring;
  // What this cell can see. A basket return is zero in every week Qloo has not
  // revised, so a scored slice that falls after the last series move multiplies the
  // cultural coefficient by zero. That is not a weak test, it is no test, and the
  // cell says so rather than printing a negative and letting it read as evidence.
  const frozen = sc ? sc.testable === false : false;
  const holds = oos.meanDeltaR2 > 0;
  // Every-null rule, i.e. a max-of-p rule: a positive claim has to clear every
  // null, not the friendliest one. It is conservative by construction — with k
  // nulls whose p-values are not independent, the effective level is stricter
  // than any single 0.10 — and the desk states that cost where the rule is used.
  const permP = Math.max(perm?.p ?? -Infinity, perm?.pBlocked ?? -Infinity);
  const sep = (pl?.p ?? Infinity) <= 0.10 && permP <= 0.10;
  const range = (se, ci, label) => `${label}± ${(se * 100).toFixed(2)} pts · 90% CI ${ptsSigned(ci[0])} → ${ptsSigned(ci[1])}${ci[0] <= 0 && ci[1] >= 0 ? " · crosses zero" : ""}`;
  const ci = oos.ci90 ? `<div class="rb-se">${range(oos.se, oos.ci90, "")}</div>` : "";
  const rci = oos.refit ? `<div class="rb-se rb-se-r">${range(oos.refit.se, oos.refit.ci90, "refit per draw: ")}</div>` : "";
  const wider = widerOf(oos);
  const rule = frozen
    ? `<div class="rb-rule"><b>This is not a test of taste.</b> Qloo's taste series last moved in the week ending ${esc(sc.lastMove)}; all ${sc.testWeeks} scored weeks are zero for every one of the ${oos.holdings} names, so the cultural coefficient is multiplied by zero on every scored week. What the number measures is how much adding a regressor moved the market coefficients in the <i>training</i> fit, projected onto the held-out weeks — not a taste effect, and its interval is no confidence interval for one. At any true effect the test's power is its size, which is why the grade below rests on the in-sample book and the nulls.</div>`
    : wider ? `<div class="rb-rule">Graded on the <b>${wider}</b> interval — the wider of the two, and so the one that bounds what this window can exclude. Here that bound is small.</div>` : "";
  return `
      <div class="rb-test">
        <div class="rb-k">Out of sample</div>
        <div class="rb-v ${frozen ? "bad" : holds ? "good" : "bad"}">${frozen ? "no test" : pts(oos.meanDeltaR2)}</div>
        <div class="rb-tag ${frozen ? "bad" : holds ? "good" : "bad"}">${frozen ? `held-out slice frozen — no test · perturbation ${pts(oos.meanDeltaR2)}` : holds ? "positive" : "negative"}</div>
        ${ci}${rci}${rule}
        <p>Refit on the first ${oos.trainWeeks} weeks, scored on the last ${oos.testWeeks}. Mean ΔR² over market-only on weeks the fit never saw — allowed to be negative, never clamped.${frozen ? ` Of those ${sc.testWeeks} weeks, <b>${sc.frozenWeeks} are frozen for every name</b> — the median name's basket moves in ${sc.medianActive} of them, and its last move in the window is ${esc(sc.lastMove ?? "—")}. The final ${sc.frozenAfterWindow} weeks of the window follow that last move with no movement at all, so every scored week multiplies the cultural coefficient by zero.` : ""}${oos.ci90 ? ` First interval: ${oos.draws} circular block-bootstrap draws of the test weeks, ${oos.blockWeeks} weeks a block, coefficients held still. Second: the same split with the fit redone inside each draw (${oos.refit.draws} draws), so coefficient error is included. A refit carries nothing from its training resample into an independent test resample, so that interval centres near zero; where the two disagree, the wider one bounds what the window can and cannot exclude, and that bound is what the grade uses.` : ""}</p>
      </div>
      <div class="rb-test">
        <div class="rb-k">Placebo</div>
        <div class="rb-v ${sep ? "good" : "bad"}">p ${pl ? pval(pl.p) : "—"}</div>
        <div class="rb-tag ${sep ? "good" : "bad"}">${sep ? "clears every null" : "not separable"}</div>
        <p>${pl ? `${pl.draws} circular rotations of the taste baskets, every holding shifted by the same amount so cross-name alignment survives. Real ${pts(pl.real)} vs rotations ${pts(pl.placeboMean)}. The null therefore keeps the book's correlation structure: this is a test against a rotation of the factor, not against random baskets, which is the stricter reading.` : ""}</p>
        ${perm ? `<div class="rb-null">date permutation: p ${pval(perm.p)} · ${perm.draws} shared shuffles of the week order, which keep each basket's own spread and drop only its timing. Real ${pts(perm.real)} vs shuffled ${pts(perm.placeboMean)} — a second, independent null, reported rather than selected between. <b>A positive claim has to clear every null in this set</b>; the friendliest one is never used on its own, because choosing a null after seeing its p is not a test. That makes the rule a <b>max-of-p rule</b>, conservative by construction: with nulls that are correlated, clearing all of them is a stricter bar than clearing any one, and a real effect below the interval's exclusion bound would be graded no signal whatever the nulls said.${perm.pBlocked != null ? ` A week-by-week shuffle also breaks the refresh cadence — a step that lasted weeks becomes isolated spikes, a book the data could not have produced — so the same null is run again on blocks of ${perm.blockWeeks} consecutive weeks: <b>p ${pval(perm.pBlocked)}</b>, shuffled ${pts(perm.blockedMean)}. That is ${perm.pBlocked >= perm.p ? "the stricter of the two, so it is the one the claim has to clear — and it lands further from a signal, not closer" : "the looser of the two here, but the rule uses the stricter one anyway, so nothing is gained by it"}.` : ""} All of these nulls run on the same calendar and the same frozen tail, so they are not three independent tests: read the set as <b>one stringent check</b>, not as p-values that multiply. And because rotation and shuffling both preserve each basket's slow-moving shape, they exclude less about a genuinely weekly taste signal than the p-value alone suggests — a limitation of the endpoint, printed rather than implied.</div>` : ""}
      </div>`;
}

// Which of the two intervals the grade uses: the wider one, because the fixed
// coefficients understate their own error. Stated at the number rather than in the
// method footer, because a reader who has to hunt for the rule has already read the
// number without it.
function widerOf(oos) {
  if (!oos?.ci90 || !oos?.refit?.ci90) return null;
  const fixed = oos.ci90[1] - oos.ci90[0];
  const refit = oos.refit.ci90[1] - oos.refit.ci90[0];
  return refit > fixed ? "refit per draw" : "fixed coefficients";
}

// The ablation arm: taste has to beat a same-sector peer basket, not just the
// market. In-sample nested ΔR² cannot fall, so the headline number is the
// out-of-sample one, and it may be negative.
function ablationBand(va) {
  const ab = va?.ablation;
  if (!ab?.oos) return "";
  const adds = ab.oos.meanTasteExtraR2 > 0;
  const share = Math.round(ab.oos.sharePositive * 100);
  const frozen = ab.scoring ? ab.scoring.testable === false : false;
  const sc = ab.scoring ?? null;
  const ab2 = va?.secondary?.ablation;
  const abp = ab.oos.placebo;
  const qv = va?.ablation?.qlooVsPeer;
  const abpLine = abp
    ? `<div class="rb-null">rotation null: p ${pval(abp.p)} · ${abp.p <= 0.10
      ? "the real baskets beat a rotation of themselves over peers — an alignment result, which is not the same as adding over peers"
      : "a rotation of the same baskets scores as well — no alignment to find over peers"}${abp.skippedDraws ? ` · ${abp.skippedDraws} of ${abp.draws} rotations dropped for leaving a training window with too little movement to fit` : ""} · read this p as <b>uninformative</b>, not borderline: it moves across the 0.10 line when the identification rule is tightened or loosened, so it is not a stable number either way.</div>`
    : "";
  const abWin = ab2?.oos
    ? `<p class="rb-line">Second window (${esc(va.secondary.window.start)} → ${esc(va.secondary.window.end)}): taste over peers <b>${pts(ab2.oos.meanTasteExtraR2)}</b>${ab2.oos.ci90 ? `, 90% CI ${ptsSigned(ab2.oos.ci90[0])} → ${ptsSigned(ab2.oos.ci90[1])}` : ""}, positive on ${Math.round(ab2.oos.sharePositive * 100)}% of ${ab2.holdings} names. The ablation is pre-registered on both windows, so a control that holds in one and not the other is visible rather than summarised away.</p>`
    : "";
  return `<section class="robust full" aria-label="Ablation">
    <div class="rb-head"><h2>Does Qloo add beyond the sector?${isStub() ? `<span class="stubtag">stub harness · magnitudes are layout only</span>` : ""}</h2>
      <p class="rb-sub">The control is a same-sector peer basket — the equal-weight weekly return of the other names in the sub-sector, from the same committed prices, <b>no Qloo data at all</b>. Peers are fitted first; taste has to add on top, out of sample. The two regressors are correlated by construction — the peer basket already carries the sector taste that prices reflect — so a null cell means the sector average carries the channel, not that taste is unpriced. The number is therefore the <b>non-overlapping layer</b> — what Qloo contributes that a vendor-free peer basket cannot — not a bound on a causal total and not a proxy for it. Reading it as a bound would be an error in either direction. Peers' own in-sample gain is in the CSV, not here: in-sample R² cannot fall when a regressor is added, so only the out-of-sample cells make the claim.</p></div>
    <div class="rb-grid stack">
      <div class="rb-test">
        <div class="rb-k">Qloo taste, over peers</div>
        <div class="rb-v ${frozen ? "" : adds ? "good" : "bad"}">${pts(ab.oos.meanTasteExtraR2)}</div>
        <div class="rb-tag ${frozen ? "" : adds ? "good" : "bad"}">${frozen ? "perturbation, not a test" : adds ? "adds beyond the sector" : "no measurable add"}</div>
        ${frozen ? `<div class="rb-rule"><b>This is not a test of taste.</b> The ablation uses the same ${ab.oos.trainWeeks}/${ab.oos.testWeeks} split, and all ${sc.testWeeks} scored weeks are zero for every name — Qloo's taste series last moved in the week ending ${esc(sc.lastMove)}. The number is the difference the training coefficients make on a frozen regressor, not a measured gain over peers.</div>` : ""}
        ${ab.oos.ci90 ? `<div class="rb-se">± ${(ab.oos.se * 100).toFixed(2)} pts · 90% CI ${ptsSigned(ab.oos.ci90[0])} → ${ptsSigned(ab.oos.ci90[1])}${ab.oos.ci90[0] <= 0 && ab.oos.ci90[1] >= 0 ? " · crosses zero" : ""}</div>` : ""}
        ${ab.oos.refit ? `<div class="rb-se rb-se-r">refit per draw: ± ${(ab.oos.refit.se * 100).toFixed(2)} pts · 90% CI ${ptsSigned(ab.oos.refit.ci90[0])} → ${ptsSigned(ab.oos.refit.ci90[1])}${ab.oos.refit.ci90[0] <= 0 && ab.oos.refit.ci90[1] >= 0 ? " · crosses zero" : ""}</div>` : ""}
        ${widerOf(ab.oos) ? `<div class="rb-rule">Claim carries on the <b>${widerOf(ab.oos)}</b> interval, the wider of the two.</div>` : ""}
        ${abpLine}
        <p>Peer-only vs peer + taste, fitted on the first ${ab.oos.trainWeeks} weeks and scored on the last ${ab.oos.testWeeks} — signed, never clamped. Both are circular block bootstraps on the same split; the refit one re-estimates the coefficients inside each draw, centres near zero for the same reason, and contains the point estimate.${frozen ? ` Those ${ab.oos.testWeeks} scored weeks are frozen for every name, so the intervals describe how much the training coefficients wobble — not the precision of a taste effect over peers.` : ""} ${frozen ? `In plain terms: the frozen arm comes out positive on ${share}% of names, which is a property of the training fits rather than evidence that taste adds over a no-cost sector exposure.` : `In plain terms: taste adds out of sample on ${share}% of names over a no-cost sector exposure, and on the other ${100 - share}% the sector alone carries the signal — a positive count, not a positive average.`} If the sector mean already carries the taste its audience shares, a negative additive cell is the <b>expected</b> answer — what the desk then reports is how much the sector absorbs, not a refutation of taste as a construct.</p>
      </div>
      <div class="rb-test">
        <div class="rb-k">${frozen ? "Names positive on the frozen arm" : "Names where taste adds"}</div>
        <div class="rb-v ${frozen ? "" : share >= 50 ? "good" : "bad"}">${share}%</div>
        <div class="rb-tag ${frozen ? "" : share >= 50 ? "good" : "bad"}">${frozen ? "not a taste count" : `of ${ab.holdings} priced`}</div>
        <p>${frozen ? "Share of names where the frozen-tail difference is positive. With a zero regressor on every scored week this is a property of the training fits, not a count of names where taste beat the sector." : "Share of names whose out-of-sample taste gain over the peer control is positive. A coin flip means the sector already held the answer."}</p>
      </div>
    </div>
    ${qv ? `<p class="rb-line">What Qloo contributes is not a copy of the sector. Over the same weeks, the correlation between a name's Qloo taste basket and its no-Qloo peer basket averages <b>${qv.meanCorr.toFixed(2)}</b> (${qv.minCorr.toFixed(2)} to ${qv.maxCorr.toFixed(2)} across names), while the taste basket moves in ${qv.meanActive.toFixed(0)} of ${qv.weeks} weeks and the peer basket moves every week. The two regressors carry different information on different calendars, so this control is not uninformative because the baskets are the same series; the non-overlapping Qloo layer simply does not add out of sample.</p>` : ""}
    ${abWin}
  </section>`;
}

// Both outcomes are designed, not just the good one. Whichever arm the numbers
// land in is marked; the product value that does not depend on the outcome is
// stated once, plainly.
function branchCard(va) {
  const ab = va?.ablation?.oos;
  if (!ab) return "";
  const adds = ab.meanTasteExtraR2 > 0;
  const r = (n) => Math.round(n * 100);
  return `<section class="robust full" aria-label="What it is worth">
    <div class="rb-head"><h2>If the control says no, what is this worth?</h2>
      <p class="rb-sub">A negative ablation is a legitimate outcome, and a prize entry should survive it. The two branches are written here before the keyed run; the one this panel lands in is marked. <a class="rb-link" href="#/read">The same answer in plain English →</a></p></div>
    <div class="rb-grid two">
      <div class="rb-test branch ${adds ? "on" : ""}">
        <div class="rb-k">If taste adds over peers</div>
        <div class="rb-tag ${adds ? "good" : ""}">${adds ? "where this run lands" : "not this run"}</div>
        <p>The desk is an exposure factor. Names are ranked by a measured taste headwind, and the watchlist fires only where the flag survives BH, its own out-of-sample test and the book placebo; where the book-level null cannot support an alert it says "watchlist-only" rather than firing. The basket can be read as a risk overlay on a consumer book. Taste is requested per sub-sector, not per name, so widening the book costs one lookup per new name plus the trend points for the basket it adds — see <a class="rb-link" href="#/read">what the run costs</a>.</p>
      </div>
      <div class="rb-test branch ${adds ? "" : "on"}">
        <div class="rb-k">If it does not</div>
        <div class="rb-tag ${adds ? "" : "bad"}">${adds ? "not this run" : "where this run lands"}</div>
        <p>Then the finding is that a sector peer basket already carries the taste channel: taste adds nothing beyond the sector on ${r(1 - ab.sharePositive)}% of names — a pre-registered negative that a research desk can cite, not a failure to report. What survives is a committed-price panel (equal-weight sub-sector exposures and weekly returns, from prices alone, no vendor) plus the evidence itself that the taste channel did not clear the control — not a standalone peer signal, because that arm is only read in-sample. Every suppressed alert is printed with its reason, so "no signal" stays inspectable.</p>
      </div>
    </div>
  </section>`;
}

function robustBand(va, w) {
  if (!va?.oos) return "";
  const sec = va.secondary;
  return `<section class="robust full" aria-label="Robustness">
    <div class="rb-head"><h2>Does it survive?</h2>
      <p class="rb-sub">Two checks a sceptical reader asks for before believing a factor — run on the primary window, then again on a disjoint window fixed before the keyed run. A positive verdict needs three things at once: a positive out-of-sample ΔR², an interval clear of zero, and <b>both</b> nulls cleared at p ≤ 0.10 — circular rotation, and a date permutation that keeps each basket's spread and drops only its timing. The better of the two p-values is never used on its own. ${va?.oos ? `${va.oos.testWeeks} test weeks is a short window and no provision can buy more power — only a longer window can. Where the sign cannot be separated from chance the desk says <b>NO SIGNAL</b>: the factor was looked for and not detectable here, which is a finding about this window rather than a grade of the product.` : ""}</p></div>
    <div class="rb-window"><span>Primary window</span><span class="rb-span">${w ? `${esc(w.start)} → ${esc(w.end)} · ${w.weeks} weeks` : ""}</span></div>
    <div class="rb-grid">${rbCells(va.oos, va.placebo, va.permutation)}</div>
    ${sec ? `<div class="rb-window"><span>Second window · pre-registered · different regime</span><span class="rb-span">${esc(sec.window.start)} → ${esc(sec.window.end)} · ${sec.window.weeks} weeks</span></div>
    <div class="rb-grid">${rbCells(sec.oos, sec.placebo)}</div>
    <p class="rb-line"><b>${sec.replicates ? "Replicates." : "Does not replicate."}</b> The same estimator, floor, draws and seed, run on the ${sec.window.weeks} weekly returns immediately before the primary window — the window was fixed in the config before the keyed run, never chosen from results. It is not an identical-conditions check: the second window is an earlier market regime, and a cultural factor need not behave the same in both. Replicating across the two is the stronger claim; failing can be a regime difference rather than a refutation, and the desk prints the miss either way.</p>` : ""}
  </section>`;
}

// The obvious rival to a "cultural" factor is a consumer-confidence proxy. This
// block is the exclusion: taste must add over SPY *and* a published sentiment
// index, and the basket's correlation with that index is printed beside it.
function sentimentBand(va) {
  const se = va?.sentiment;
  if (!se?.oos) return "";
  const c = se.oos.ci90;
  const crosses = c && c[0] <= 0 && c[1] >= 0;
  const adds = se.oos.meanTasteExtraR2 > 0;
  const share = Math.round(se.oos.sharePositive * 100);
  const frozen = se.scoring ? se.scoring.testable === false : false;
  // The chip reports the sign of the point estimate, not a verdict: if the
  // interval crosses zero the word "survives" would be a claim the spread denies.
  const seTag = frozen ? "perturbation, not a test" : adds ? (crosses ? "positive · crosses zero" : "survives the control") : (crosses ? "no measurable add" : "explained by sentiment");
  return `<section class="robust full" aria-label="Consumer sentiment">
    <div class="rb-head"><h2>Could this just be consumer confidence?</h2>
      <p class="rb-sub">A cultural factor built from searches and streams can be a lagging confidence proxy — people buy more of everything when they feel good, so taste has to clear a published sentiment index as well as the market. The control is the University of Michigan Index of Consumer Sentiment (FRED <code>UMCSENT</code>, ${esc(se.source ?? "")}), carried as its month-over-month change on the weeks inside that month — a monthly series, coarse by construction, and printed as coarse rather than interpolated into a weekly series it does not have. A null here would mean the factor is a sentiment proxy and the word "cultural" is unearned.</p></div>
    <div class="rb-grid">
      <div class="rb-test">
        <div class="rb-k">Taste, after sentiment</div>
        <div class="rb-v ${adds ? "good" : "bad"}">${pts(se.oos.meanTasteExtraR2)}</div>
        <div class="rb-tag ${adds ? "good" : "bad"}">${seTag}</div>
        ${c ? `<div class="rb-se">± ${(se.oos.se * 100).toFixed(2)} pts · 90% CI ${ptsSigned(c[0])} → ${ptsSigned(c[1])}${crosses ? " · crosses zero" : ""}</div>` : ""}
        <p>Out-of-sample ΔR² of taste over <i>SPY + sentiment</i>, on the last ${se.oos.testWeeks} weeks, never clamped. Positive on ${share}% of ${se.holdings} names.${frozen ? ` Those ${se.oos.testWeeks} weeks are frozen for every name at this Qloo vintage, so the figure is the training fits' perturbation, not a measured add over sentiment.` : ""}</p>
      </div>
      <div class="rb-test">
        <div class="rb-k">Basket vs sentiment</div>
        <div class="rb-v">${se.meanCorr == null ? "—" : (se.meanCorr > 0 ? "+" : "") + se.meanCorr.toFixed(2)}</div>
        <div class="rb-tag">mean correlation</div>
        <p>Average correlation between each name's weekly taste basket and the same sentiment change — near zero means the basket is not a relabelled confidence index. ${se.movingWeeks} of ${se.oos.testWeeks + se.oos.trainWeeks} weeks move at all, because the index is monthly.</p>
      </div>
    </div>
  </section>`;
}

function impactBlock(live) {
  return `<section class="use" aria-label="How the desk is used">
    <div class="use-head"><h2>What the reading is for</h2>
      <p>${live ? "A screen, not a signal service." : "The workflow the keyed run unlocks — all three steps need a live cultural beta."}</p></div>
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
      <button class="btn ghost" id="recompute" title="re-derives the panel from the Qloo responses already cached — no new API calls, nothing spent">Re-derive the panel</button>
      <p class="caption">Without a key the endpoint answers with a refusal, not a zero-filled run. Re-deriving reads the responses already paid for; it does not refresh Qloo's series.</p>
    </div>
    <dl class="ledger">
      <dt>Market</dt><dd>${MARKET.window.weeks} weekly returns × ${MARKET.rows.length} names<br>${MARKET.window.start} → ${MARKET.window.end}<br>Yahoo Finance · committed fixture</dd>
      <dt>Withheld</dt><dd>taste series · cultural betas<br>taste-risk flags · ΔR² from taste<br>out-of-sample ΔR² · placebo p</dd>
      <dt>Source</dt><dd>Qloo /v2/trending<br>Qloo /v2/insights</dd>
    </dl>
  </div>`;
}

// The book is 100+ names, so the reading is filtered by sub-sector rather than
// scrolled. "All" is the factor; a sector is the same factor on its own audience.
function filterBar(rows) {
  const seen = [];
  for (const r of rows) if (r.sector && !seen.some((s) => s.id === r.sector)) seen.push({ id: r.sector, label: r.sectorLabel ?? r.sector });
  const chip = (id, label, n) => `<button class="fchip${sectorFilter === id ? " on" : ""}" data-sector="${id}">${esc(label)}<span>${n}</span></button>`;
  const count = (id) => rows.filter((r) => id === "all" || r.sector === id).length;
  const priced = rows.filter((r) => r.status === "ok").length;
  const shown = rows.filter((r) => (sectorFilter === "all" || r.sector === sectorFilter) && matchesQuery(r, bookQuery)).length;
  const search = `<div class="fsearch">
    <input id="book-q" type="search" autocomplete="off" spellcheck="false" value="${esc(bookQuery)}"
      aria-label="Filter the book by ticker, company or sub-sector" placeholder="Filter ${rows.length} names — ticker, company or sub-sector (/)" data-audit="book-search">
    ${bookQuery ? `<button type="button" class="fclear" data-clear="1" aria-label="Clear the filter">Clear</button>` : ""}
    <span class="fcount" aria-live="polite">${bookQuery ? `${shown} of ${count(sectorFilter)}` : ""}</span>
  </div>`;
  return `${search}<div class="filters" data-audit="filters">${chip("all", "All names", count("all")).replace("<button", `<button title="${priced} of ${count("all")} priced with a cultural beta"`)}${seen.map((s) => chip(s.id, s.label, count(s.id))).join("")}</div>`;
}

function coldTable() {
  const rows = MARKET.rows.filter((r) => (sectorFilter === "all" || r.sector === sectorFilter) && matchesQuery(r, bookQuery)).map((r) => {
    const name = `<td class="c-name" data-l="Name"><span class="tickrow">${logoTile(r.ticker, r.label)}<span class="tick">${r.ticker}</span></span><span class="name">${esc(r.label)}</span><span class="sector">${esc(r.sectorLabel ?? "")}</span></td>`;
    const trace = `<td class="ta" data-l="Trace"><a class="tracelink" href="#/evidence/${r.ticker}">trace</a></td>`;
    if (r.status === "no prices") {
      return `<tr class="link" data-ev="${r.ticker}">${name}
        <td class="num" data-l="Market beta"><span class="signal ins">no prices</span></td>
        <td class="num c-cult" data-l="Cultural beta" data-c="cultural"><span class="val"><span class="withheld">withheld</span></span></td>
        <td class="c-sig" data-l="Signal"><span class="signal ins">—</span></td>${trace}</tr>`;
    }
    return `<tr class="link" data-ev="${r.ticker}">${name}
      <td class="num" data-l="Market beta"><span class="val"><span class="v">${f2(r.marketBeta)}</span><span class="se">± ${r.marketSE.toFixed(2)}</span></span></td>
      <td class="num c-cult" data-l="Cultural beta" data-c="cultural"><span class="waitbar" aria-hidden="true"></span><span class="val"><span class="withheld">withheld</span></span></td>
      <td class="c-sig" data-l="Signal"><span class="signal none">—</span></td>${trace}</tr>`;
  }).join("");
  return `${filterBar(MARKET.rows)}
  <div class="tw">
    <table class="desk-table" data-audit="holdings">
      <thead><tr>
        <th>Name</th>
        <th><span class="th">Market beta</span><span class="thsub">± std. error</span></th>
        <th><span class="th">Cultural beta</span><span class="thsub">± std. error</span></th>
        <th><span class="th">Signal</span><span class="thsub">|t| ≥ 2 · q ≤ 0.10</span></th>
        <th class="th-right"></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// On a phone the table header disappears and every row becomes a card, so the
// desktop th buttons are not a control a reader can reach. This selector drives
// the same sortKey/sortDir state: one list, two affordances, never two orderings.
function sortBar() {
  const opt = (k, d, label) => `<option value="${k}:${d}"${sortKey === k && sortDir === d ? " selected" : ""}>${label}</option>`;
  return `<div class="sortbar" data-audit="mobile-sort">
    <label for="sort-key">Sort</label>
    <select id="sort-key" aria-label="Sort the book">
      ${opt("culturalQ", 1, "Signal (q) — strongest first")}
      ${opt("culturalBeta", -1, "Cultural beta — high to low")}
      ${opt("culturalBeta", 1, "Cultural beta — low to high")}
      ${opt("marketBeta", -1, "Market beta — high to low")}
      ${opt("ticker", 1, "Name — A to Z")}
    </select>
  </div>`;
}

function liveTable() {
  const inSector = DESK.rows.filter((r) => (sectorFilter === "all" || r.sector === sectorFilter) && matchesQuery(r, bookQuery));
  const rows = [...inSector].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (av == null && bv == null) return a.ticker.localeCompare(b.ticker);
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * sortDir || a.ticker.localeCompare(b.ticker);
  });
  const arrow = (k) => `<span class="arrow">${k === sortKey ? (sortDir > 0 ? "▲" : "▼") : ""}</span>`;
  const maxAbs = Math.max(1, ...rows.filter((r) => r.status === "ok").map((r) => Math.abs(r.culturalBeta)));
  const body = rows.map((r) => {
    const sectorTag = sectorFilter === "all" ? `<span class="sector">${esc(r.sectorLabel ?? "")}</span>` : "";
    if (r.status === "unresolved") {
      const rs = r.resolution;
      const search = rs
        ? `${esc(rs.failure)} · ${rs.queriesTried.length} ${rs.queriesTried.length === 1 ? "query" : "queries"}, ${rs.candidatesSeen} ${rs.candidatesSeen === 1 ? "candidate" : "candidates"}`
        : "no Qloo entity";
      return `<tr>
        <td class="c-name" data-l="Name"><span class="tickrow">${logoTile(r.ticker, r.label)}<span class="tick">${r.ticker}</span></span><span class="name">${esc(r.label)}</span>${sectorTag}<span class="sector" style="font-style:italic">${search} · tried: ${esc((rs?.queriesTried ?? [r.query]).join(", ") || r.query || "")}</span></td>
        <td class="num" data-l="Market beta"><span class="val"><span class="v">${r.marketBeta == null ? "—" : f2(r.marketBeta)}</span>${r.marketSE == null ? "" : `<span class="se">± ${r.marketSE.toFixed(2)}</span>`}</span></td>
        <td class="num c-cult" data-l="Cultural beta"><span class="signal ins">no Qloo entity</span></td>
        <td class="c-sig" data-l="Signal"><span class="signal ins">—</span></td>
        <td class="ta"></td></tr>`;
    }
    if (r.status !== "ok") {
      return `<tr>
        <td class="c-name" data-l="Name"><span class="tickrow">${logoTile(r.ticker, r.label)}<span class="tick">${r.ticker}</span></span><span class="name">${esc(r.label)}</span>${sectorTag}</td>
        <td class="num" data-l="Market beta"><span class="signal ins">${esc(r.status === "no prices" ? "no prices" : "below the sample floor")}</span></td>
        <td class="num c-cult" data-l="Cultural beta"><span class="signal ins">withheld</span></td>
        <td class="c-sig" data-l="Signal"><span class="signal ins">—</span></td>
        <td class="ta" data-l="Trace"><a class="tracelink" href="#/evidence/${r.ticker}">trace</a></td></tr>`;
    }
    const b = r.culturalBeta, pct = Math.abs(b) / maxAbs * 50;
    const depth = r.featured ? `#/holding/${r.ticker}` : `#/evidence/${r.ticker}`;
    // "tailwind" was read as a finding on a name that fails the q filter. The column
    // reports the t-test it actually passed and the q it failed; direction is already
    // in the beta's sign.
    const sig = r.flagged
      ? `<span class="signal risk">● taste risk</span><span class="q">q ${r.culturalQ != null ? r.culturalQ.toFixed(2) : "—"}</span>`
      : Math.abs(r.culturalT) >= 2
        ? `<span class="signal ${b > 0 ? "tail" : "none"}">|t| ≥ 2</span><span class="q">q ${r.culturalQ != null ? r.culturalQ.toFixed(2) : "—"} · below the flag rule</span>`
        : '<span class="signal none">—</span>';
    return `<tr class="link" data-h="${r.ticker}" data-feat="${r.featured ? 1 : 0}">
      <td class="c-name" data-l="Name"><span class="tickrow">${logoTile(r.ticker, r.label)}<span class="tick">${r.ticker}</span></span><span class="name">${esc(r.label)}</span>${sectorTag}</td>
      <td class="num" data-l="Market beta"><span class="val"><span class="v">${f2(r.marketBeta)}</span><span class="se">± ${r.marketSE.toFixed(2)}</span></span></td>
      <td class="num c-cult ${b < 0 ? "neg" : ""}" data-l="Cultural beta">
        <div class="bar"><i class="${b >= 0 ? "pos" : "negs"}" style="width:${pct}%"></i></div>
        <span class="val"><span class="v">${f2(b)}</span><span class="se">± ${r.culturalSE.toFixed(2)}${r.activeWeeks != null ? ` · ${r.activeWeeks}/${r.weeks} wk` : ""}</span></span></td>
      <td class="c-sig" data-l="Signal">${sig}</td>
      <td class="ta" data-l="Trace"><a class="tracelink" href="${depth}">${r.featured ? "open" : "trace"}</a></td></tr>`;
  }).join("");
  const fs = DESK.factorSparsity;
  const sparseNote = fs
    ? `<p class="muted" style="font-size:12px;margin-top:10px">The basket is flat in weeks Qloo reports no movement, so each slope is identified on the weeks it moves — ${fs.minActive}–${fs.maxActive} of ${fs.weeks} per name (median ${fs.medianActive}). A beta from that few weeks can be large and carry a wide ±; each trace shows the out-of-sample ΔR² that checks it.</p>`
    : "";
  const unr = DESK.universe?.unresolved?.length ?? 0;
  const res = (DESK.universe?.unresolved ?? []).map((u) => u.resolution).filter(Boolean);
  const byClass = res.reduce((a, r) => { a[r.failure] = (a[r.failure] ?? 0) + 1; return a; }, {});
  const singleQuery = res.filter((r) => r.queriesTried.length === 1).length;
  const classText = res.length
    ? ` By cause, as recorded by the resolver: ${Object.entries(byClass).map(([k, n]) => `${n} ${k}`).join(", ")}. ${singleQuery} of the ${res.length} were searched under a single query, so for those the search was not exhausted — a miss there is a limit on what was asked, not a finding that the brand is outside Qloo.`
    : "";
  const rosterNote = unr
    ? `<p class="muted" style="font-size:12px;margin-top:6px">${unr} of ${DESK.universe.total} names resolved to no Qloo brand entity. They keep their row with the market half measured, the cultural column withheld and the search printed beside them, so the roster does not shrink to hide them: ${DESK.rows.filter((r) => r.status === "ok").length} of ${DESK.rows.length} names carry a cultural beta.${classText}</p>`
    : "";
  return `${filterBar(DESK.rows)}${sortBar()}
  <div class="tw">
    <table class="desk-table" data-audit="holdings">
      <thead><tr>
        <th class="sort" data-k="ticker">Name ${arrow("ticker")}</th>
        <th class="sort" data-k="marketBeta"><span class="th">Market beta</span><span class="thsub">± std. error</span></th>
        <th class="sort" data-k="culturalBeta"><span class="th">Cultural beta ${arrow("culturalBeta")}</span><span class="thsub">± std. error · Qloo</span></th>
        <th class="sort" data-k="culturalQ"><span class="th">Signal ${arrow("culturalQ")}</span><span class="thsub">${sortKey === "culturalQ" ? "sorted by q · " : ""}flag needs |t| ≥ 2 · q ≤ 0.10</span></th>
        <th class="th-right"></th>
      </tr></thead>
      <tbody>${body || `<tr class="empty"><td colspan="5">No name in the book matches “${esc(bookQuery)}”${sectorFilter !== "all" ? " in this sub-sector" : ""}. <button type="button" class="fclear" data-clear="1">Clear the filter</button></td></tr>`}</tbody>
    </table>
  </div>${sparseNote}${rosterNote}`;
}

/* ---------- views ---------- */
// The first thing a judge reads is a sentence, not a grid. HOLDS / NO SIGNAL /
// FAILS describe the factor's out-of-sample behaviour, never the product's worth:
// A null result is a finding, and the desk says so in the same breath. NO SIGNAL
// is a separate grade from FAILS: the factor was looked for and not detectable at
// this window length, which is not the same as measuring it as harmful, and calling
// it "unpowered" would understate a null the data actively supports.
//
// The grade is read off the refit interval — the one that includes coefficient
// error. The fixed-coefficient interval holds the fit still across resamples, so it
// is narrower than the truth; grading on it would let a claim through on an
// uncertainty the desk chose not to charge for.
// One spelling of the null set, everywhere it is printed. Three decimals because the
// two permutation numbers round to the same 2-dp figure at this pull, and a reader who
// sees "0.83" beside a value that is really 0.830 vs 0.778 cannot tell which test ran.
function nullList(va) {
  const f = (x) => (x == null ? "—" : x.toFixed(3));
  const rot = va?.placebo?.p, wk = va?.permutation?.p, blk = va?.permutation?.pBlocked;
  return blk == null
    ? `rotation p ${f(rot)}, week permutation p ${f(wk)}`
    : `rotation p ${f(rot)}, week permutation p ${f(wk)}, 6-week block p ${f(blk)}`;
}

function verdictOf(ok, flagged, va) {
  const oos = va?.oos?.meanDeltaR2 ?? null;
  const p = va?.placebo?.p ?? null;
  const untestable = va?.oos?.scoring ? va.oos.scoring.testable === false : false;
  const permP = va?.permutation ? Math.max(va.permutation.p, va.permutation.pBlocked ?? -Infinity) : null;
  const sec = va?.secondary;
  const covers = (c) => Array.isArray(c) && c[0] <= 0 && c[1] >= 0;
  const interval = va?.oos?.refit?.ci90 ?? va?.oos?.ci90;
  const straddles = covers(interval);
  const bothNullsBeaten = p !== null && permP !== null && p <= 0.1 && permP <= 0.1;
  const primaryHolds = oos !== null && bothNullsBeaten && oos > 0 && !straddles;
  const primaryFails = oos !== null && !straddles && oos <= 0;
  let grade;
  // A frozen scored slice cannot grade a held-out test: the OOS cell and its
  // interval describe perturbation of the training fit, not taste. The grade then
  // rests on the in-sample book and the nulls, and says so in the word itself.
  const inSampleSignal = p !== null && permP !== null && p <= 0.1 && permP <= 0.1 && (va?.meanDeltaR2 ?? 0) > 0;
  if (oos === null || p === null) grade = "MARGINAL";
  else if (untestable) grade = inSampleSignal ? "IN-SAMPLE ONLY" : "NO SIGNAL (IN-SAMPLE)";
  else if (!sec) grade = primaryHolds ? "HOLDS" : straddles ? "NO SIGNAL" : primaryFails ? "FAILS" : "MARGINAL";
  else if (primaryHolds && sec.replicates) grade = "HOLDS";
  else if (primaryFails && !sec.replicates) grade = "FAILS";
  else if (straddles) grade = "NO SIGNAL";
  else grade = "MARGINAL";

  const priced = ok.length;
  let sentence;
  if (flagged > 0) {
    sentence = `${flagged} of ${priced} priced ${flagged === 1 ? "name carries" : "names carry"} a measurable taste headwind — negative cultural beta, |t| ≥ 2 and a book-wide q ≤ 0.10.`;
  } else {
    sentence = `No name among the ${priced} priced names carries a taste headwind that survives its own significance screen: taste is measured on every name and charged as a risk on none.`;
  }
  const mag = oos === null ? "" : pts(Math.abs(oos)).replace(/^\+/, "");
  const bound = Array.isArray(interval) ? Math.max(Math.abs(interval[0]), Math.abs(interval[1])) * 100 : null;
  const nulls = nullList(va);
  const tail = oos === null ? "" : untestable
    ? ` In sample the basket added ${pts(va.meanDeltaR2).replace(/^\+/, "")} of r², and every null matches or beats that alignment (${nulls}). The held-out slice cannot check it: every scored week is frozen at this Qloo vintage (see Data basis), so the grade is read in sample and says so in the word. NO SIGNAL (IN-SAMPLE) means no sign in the book and no separable null — not a demonstrated absence, and not a completed held-out test.`
    : ` Out of sample the basket ${oos > 0 ? "added" : "lost"} ${mag} of r² on the last ${va.oos.testWeeks} weeks${straddles ? `, and the interval that carries coefficient error crosses zero${bound === null ? "" : ` — so the window can only exclude effects larger than about ${bound.toFixed(1)} pts, which is little`}` : ", with the interval clear of zero"}. Every null (${nulls}) scores at least as well as the real alignment.${straddles ? " No sign is detectable in either direction at this window length, and that is the finding." : ""}`;
  const secTail = sec
    ? ` The prior ${sec.window.weeks} weeks ${sec.replicates ? "replicate" : "do not replicate"} it (out-of-sample ΔR² ${pts(sec.oos.meanDeltaR2)}, placebo p ${sec.placebo.p.toFixed(2)}).`
    : "";
  return { grade, untestable, sentence: sentence + tail + secTail };
}

function chips(grade, flagged, va) {
  const oos = va?.oos?.meanDeltaR2 ?? null;
  const p = va?.placebo?.p ?? null;
  const sec = va?.secondary;
  const untestable = va?.oos?.scoring ? va.oos.scoring.testable === false : false;
  const cls = grade === "HOLDS" ? "good" : grade === "FAILS" ? "bad" : "mid";
  const wk = va?.permutation?.p ?? null;
  const blk = va?.permutation?.pBlocked ?? null;
  const rep = sec
    ? `<span class="chip ${sec.replicates ? "good" : "bad"}">${sec.replicates ? "replicates" : "does not replicate"}</span>`
    : va?.secondarySkip
      ? `<span class="chip">second window untestable</span>`
      : `<span class="chip">second window not run</span>`;
  const note = grade === "HOLDS"
    ? "HOLDS = the factor held out of sample on both windows and cleared every null"
    : grade === "NO SIGNAL (IN-SAMPLE)" || grade === "IN-SAMPLE ONLY"
      ? `${grade} = graded in sample only. The held-out slice is frozen at this Qloo vintage (${va.oos.scoring.frozenWeeks} of ${va.oos.scoring.testWeeks} scored weeks move for no name), so no held-out test ran and none is claimed; in sample the association is ${grade === "IN-SAMPLE ONLY" ? "separably positive but unconfirmed" : "indistinguishable from chance"}, which is not proof of absence`
    : grade === "NO SIGNAL"
      ? "NO SIGNAL = the out-of-sample interval crosses zero and every null matches the real alignment: the factor was looked for and not detectable at this window length. Not the same as measuring it as harmful, and not a claim that it is absent"
    : grade === "FAILS"
      ? "FAILS = the factor was measured negative out of sample with an interval clear of zero — a finding about the factor, not a defect in the desk"
      : oos === null
        ? "not yet computed — this panel is waiting on the keyed run"
        : !sec && va?.secondarySkip
          ? `Second window untestable = the pre-registered window stays in the config, but Qloo's levels do not cover enough of it to clear the ${DESK?.sampleFloor?.floor ?? 100}-week floor`
          : sec && !sec.replicates
            ? "MARGINAL = it held on the primary window and did not replicate on the disjoint one"
            : "MARGINAL = the factor is weak on at least one window; the numbers are as computed";
  return `<div class="chips" data-audit="verdict">
    <span class="chip ${cls}">${grade}</span>
    ${untestable ? `<span class="chip bad">held-out slice frozen</span>` : ""}
    <span class="chip">${flagged} of ${va?.holdings ?? "—"} flagged</span>
    <span class="chip">${untestable ? "OOS ΔR² not a test" : `OOS ΔR² ${oos === null ? "—" : pts(oos)}`}</span>
    <span class="chip">rotation p ${p === null ? "—" : p.toFixed(3)}</span>
    <span class="chip">week shuffle p ${wk === null ? "—" : wk.toFixed(3)}${blk === null ? "" : ` · block p ${blk.toFixed(3)}`}</span>
    ${rep}
    <span class="chip note">${note}</span>
  </div>`;
}

function bootView() {
  return `<div class="head"><div class="lede-col">
    <h1>Taste is a <span class="thin">risk factor.</span></h1>
    <p class="sub">Loading the panel — the book, the taste baskets and the read-only analyst.</p>
  </div></div>
  <p class="caption" data-audit="boot">No number is shown until its file has arrived.</p>`;
}

function deskView() {
  if (!DESK) {
    if (!MARKET) return `<div class="head"><div class="lede-col"><h1>Taste is a <span class="thin">risk factor.</span></h1>
      <p class="sub">The desk server is not answering. Start it with <code>npm start</code> and reload.</p></div></div>`;
    const w = MARKET.window;
    return `${headBlock("Taste is a <span class=\"thin\">risk factor.</span>",
      `Every consumer name in the book, priced two ways: market beta against the S&P 500, and cultural beta against its own sub-sector's taste basket from Qloo — ${MARKET.rows.length} names, one factor.`,
      w, "prices committed · cultural factor locked", "warn", false)}
    <div class="notice" role="status">
      <span class="dot"></span>
      <span class="notice-text"><b>Cultural factor locked.</b> No Qloo response is connected to this build, so no cultural beta is printed.
      The market half below is shown for ${MARKET.universe?.priced ?? MARKET.rows.length} of ${MARKET.rows.length} names; the rest have no complete price history and keep their row without a beta.</span>
      <a class="notice-link" href="#/evidence">What is withheld →</a>
    </div>
    ${strip([[String(MARKET.rows.length), "names in the book"], [String(w.weeks), "aligned weeks"], [String(MARKET.universe?.priced ?? MARKET.rows.length), "market betas, live"], ["0", "cultural betas"]])}
    ${coldTable()}
    <p class="caption">Market beta is a one-regressor fit of weekly return on ${esc(MARKET.index.label)}. It needs no Qloo data,
    so it is shown; the cultural column stays withheld until a live Qloo run fills it.
    That first keyed run also prints ΔR² from taste, the median |t| of the cultural betas,
    an out-of-sample ΔR² on a pre-registered held-out slice, a circular-rotation
    placebo p over 400 draws, and the out-of-sample and placebo tests repeated on the disjoint replication window before this one.
    The signal column flags a cultural beta that is negative, clears |t| ≥ 2, and survives a Benjamini–Hochberg
    q ≤ 0.10 across every priced name.</p>
    ${impactBlock(false)}
    ${policyBlock()}`;
  }
  const ok = DESK.rows.filter((r) => r.status === "ok");
  const flagged = ok.filter((r) => r.flagged).length;
  const va = DESK.valueAdd;
  const v = verdictOf(ok, flagged, va);
  const sectors = DESK.universe?.sectors?.length ?? 0;
  const sc = va?.oos?.scoring;
  // The single fact that changes how every number on this page is read belongs on
  // this page, not two clicks away: a judge who never opens the vintage card must
  // not read an in-sample grade as a completed held-out test.
  // meanDeltaR2 is a fraction of variance and medianDeltaR2Pts is already in points;
  // dividing them unscaled printed 2033× on the landing page (it is 20.3×).
  const obsPts = va?.meanDeltaR2 != null ? va.meanDeltaR2 * 100 : null;
  const mdeRatio = MDE?.book?.medianDeltaR2Pts && obsPts ? MDE.book.medianDeltaR2Pts / obsPts : null;
  const mdeLay = mdeRatio && sc && sc.testable === false
    ? ` In plain terms: this window can only see a taste effect about <b>${mdeRatio.toFixed(0)}× larger</b> than the one the book actually shows (a ${nf(MDE.book.medianDeltaR2Pts)}-point ΔR² against the ${nf(obsPts)} measured) — a statement about how short the window is, not evidence that taste does not matter.`
    : "";
  const basis = sc && sc.testable === false
    ? `<p class="basis" data-audit="basis"><b>Data basis.</b> Qloo's taste series last moved in the week ending ${esc(sc.lastMove ?? "—")}. The final <b>${sc.frozenAfterWindow} of ${va.oos.trainWeeks + va.oos.testWeeks} weeks</b> repeat that level with a log change of exactly zero for every name, and <b>all ${sc.testWeeks} scored weeks sit inside them</b> — so no held-out test of taste ran, and none is claimed anywhere on this desk. Every number here is in sample. Of the ${DESK.rows.length} names in the book, <b>${ok.length} are priced</b>: 3 have no fully aligned weekly price history and 18 have no Qloo brand entity (mostly B2B, auto-parts and tobacco names). No name was dropped after its beta was seen.${mdeLay} <a href="#/evidence">Why, and what a test would need →</a></p>`
    : "";
  // The landing page is a reading, not a methods note. The finding, the state of
  // the desk and the book come first; the basis that qualifies every number is
  // moved below the table, complete, under its own heading. Nothing is deleted.
  const headNote = sc && sc.testable === false
    ? `<b>All ${sc.testWeeks} scored weeks are frozen</b> at this Qloo vintage — every number here is in sample. <a href="#/evidence">Why →</a>`
    : "";
  const tasteHl = v.grade === "HOLDS";
  const plainPts = va?.meanDeltaR2 != null ? pts(va.meanDeltaR2).replace(/^\+/, "") : "—";
  // meanDeltaR2 is a fraction of variance; medianDeltaR2Pts is already in points.
  const mdePts = nf(MDE?.book?.medianDeltaR2Pts, 1);
  const finding = `And it won't cry wolf: ${flagged} of ${ok.length} priced names clear a strict flag rule (|t| ≥ 2 and q ≤ 0.10). At this Qloo vintage the desk could have seen an effect of about ${mdePts} R² points; taste adds ${plainPts} in sample.`;
  // 52.77 → 43.81 from revision-replay.json, committed vintage.
  return `${headBlock(`Every consumer stock, <span class="thin">read through what its audience loves.</span>`,
    `Cultural beta prices ${DESK.rows.length} consumer names across ${sectors} sub-sectors against the S&P 500 and against a basket of what each sub-sector's audience loves, from Qloo. When Qloo's taste data moves, the desk re-checks itself: Qloo revised two Disney-basket entities on 2025-12-15, the freshness gate caught it, and the desk re-estimated Disney's cultural beta live — 52.77 at the pre-revision vintage, 43.81 on today's panel — printing both, with the reading of record labelled.`,
    DESK.window, `${ok.length} of ${DESK.rows.length} priced · ${liveLabel()}${frozenAfter()}`, liveTone())}
    <p class="verdict-line" data-audit="verdict-line">${esc(finding)}</p>
    <section class="strip" data-audit="desk-strip" aria-label="State of the desk">
      <div class="stat neutral" title="${esc(v.grade)}${sc && sc.testable === false ? " · held-out slice frozen" : ""}"><b>${flagged} cry-wolf flags</b><span>of ${ok.length} priced · strict rule</span></div>
      <div class="stat"><b>${ok.length} / ${DESK.rows.length}</b><span>names priced</span></div>
      <div class="stat"><b>${esc(sc?.lastMove ?? "—")}</b><span>last taste-series move</span></div>
      <div class="stat"><b>52.77 → 43.81</b><span>DIS re-estimated · Qloo revision</span></div>
      <div class="stat"><b>${pts(va?.meanDeltaR2)}</b><span>ΔR² from taste · in sample</span></div>
    </section>
    <nav class="start" data-audit="start-here" aria-label="Start here"><a href="#/holding/DIS"><i>1</i>See what Disney's audience loves</a><a href="?replay=1#/ask" data-prefill="Recompute Disney's cultural beta live."><i>2</i>Watch the desk catch a Qloo revision</a><a href="#/evidence"><i>3</i>Why nothing is flagged, and why that's the point</a></nav>
    <p class="xray-cta" data-audit="xray-cta"><a href="#/xray?h=DIS:40,NKE:25,SBUX:20,AAPL:15">Paste your own holdings → Taste X-ray</a> <span>what your portfolio's audience loves, its cultural beta beside its market beta, and which names moved with Qloo's last revision. Runs in the page; nothing is stored.</span></p>
    <section class="null-bound" data-audit="null-bound" aria-labelledby="null-bound-title">
      <div class="nb-head">
        <span class="eyebrow">What the null is, exactly</span>
        <h2 id="null-bound-title">A bound, not a proof. And not a sign error.</h2>
      </div>
      <div class="strip nb-strip">
        <div class="stat"><b>44 / 36</b><span>negative / positive betas</span></div>
        <div class="stat"><b>3.17</b><span>best |t| (DIS) vs 3.32 after 80 tests</span></div>
        <div class="stat"><b>1</b><span>negative name past |t| 2 · KDP, q 0.351</span></div>
        <div class="stat"><b>13.7 pts</b><span>median ΔR² the design could detect</span></div>
        <div class="stat"><b>6.7 pts</b><span>largest observed (DIS)</span></div>
      </div>
      <p class="nb-note">The best candidate misses the multiplicity bar by 5% on t (3.17 vs 3.32), and no name's observed increment reaches even the most detectable name's 80%-power bar (6.7 vs 8.6 pts). So “0 of 80” bounds large effects; it does not show that taste has no small one. The held-out slice cannot test the sign at this vintage — all 35 scored weeks are frozen — and the desk says so rather than quoting a number that is not a test.</p>
      <p class="nb-more"><a href="#/evidence">The full bound →</a></p>
    </section>
    <div class="book-head">
      <h2>The book, priced two ways</h2>
      <p>Filter by sub-sector, ticker or company. Market beta is the S&amp;P 500 control; cultural beta is the taste reading. Each row opens its evidence; the featured name opens a full reading.</p>
    </div>
    ${liveTable()}
    <section class="data-basis" data-audit="data-basis" aria-labelledby="data-basis-title">
      <div class="basis-head">
        <span class="eyebrow">The fine print, kept</span>
        <h2 id="data-basis-title">Data basis and limits</h2>
        <p>Nothing here changes a number; it says what each number can claim. The verdict and the flag rule sit after the table, so the reading comes first.</p>
      </div>
      ${basis}
      <p class="verdict-full">${esc(v.sentence)}</p>
      ${chips(v.grade, flagged, va)}
      ${headNote ? `<p class="caption" data-audit="head-note">${headNote}</p>` : ""}
      <p class="caption">Flag rule: negative cultural beta with |t| ≥ 2 <em>and</em> a Benjamini–Hochberg q ≤ 0.10 across the book — a measured headwind, not an instruction.
    Of ${ok.length} priced names, |t| ≥ 2 alone would flag about ${Math.round(ok.length * 0.05)} by chance, so the correction is not optional. Names marked <b>open</b> have an audience-level basket and a full reading;
    the rest link to their provenance row. ${va ? `The taste basket adds ${pts(va.meanDeltaR2)} of in-sample r² on average (market ${va.meanMarketR2.toFixed(3)} → ${va.meanFullR2.toFixed(3)}); the median |t| of the cultural betas is ${va.medianAbsCulturalT.toFixed(2)} — a signal strength, not a guarantee.` : ""}${va?.ablation?.oos ? ` Against a same-sector peer basket, taste adds ${pts(va.ablation.oos.meanTasteExtraR2)} out of sample on ${Math.round(va.ablation.oos.sharePositive * 100)}% of names — the control is on Evidence.` : ""}</p>
      <p class="readlink"><a href="#/read">New to the desk? Read it in plain English →</a></p>
    </section>
    ${impactBlock(true)}`;
}

// A single row's OOS number with the same two intervals the book carries, and
// the identity of the wider one. A lone point estimate on a holding page reads
// as more certainty than 36 test weeks can support.
function rowIntervals(r) {
  const f = r.oosFixed, q = r.oosRefit;
  if (!f && !q) return "";
  const seg = (x, label) => `${label} 90% CI ${ptsSigned(x.lo)} → ${ptsSigned(x.hi)}`;
  const both = [f ? seg(f, "fixed coefficients") : null, q ? seg(q, "refit per draw") : null].filter(Boolean).join("; ");
  const wider = widerOf({ ci90: f ? [f.lo, f.hi] : null, refit: q ? { ci90: [q.lo, q.hi] } : null });
  return `Intervals: ${both}.${wider ? ` The claim rests on the wider interval — <b>${wider}</b>.` : ""}`;
}

function holdingView(tick) {
  const r = DESK.rows.find((x) => x.ticker === tick);
  if (!r) return `<p>No such name in the book.</p>`;
  const back = `<a class="back" href="#/">← Back to the desk</a>`;
  if (r.status !== "ok") {
    return `${back}<h1>${tick}</h1><p class="lede">${esc(r.label)} has too few Qloo weekly points to price taste.
      It stays in the book, marked, with no cultural beta — the sample floor, shown rather than hidden.</p>`;
  }
  const sig = Math.abs(r.culturalT) >= 2;
  const sc = DESK?.valueAdd?.oos?.scoring;
  const verdict = r.flagged
    ? "Flagged: taste is a significant headwind."
    : sig ? `Strongest-tier taste exposure (t ${f2(r.culturalT)}), short of the book-wide bar (q ${r.culturalQ != null ? r.culturalQ.toFixed(3) : "—"}).`
    : "Not significant at |t| ≥ 2. Measured, and not charged.";
  const s = SERIES?.[tick];
  const chart1 = s ? lineChart(s.dates, s.returns, s.basket, tick, `${r.sectorLabel ?? "sub-sector"} basket`) : "";
  let chart2 = "";
  if (s) {
    const ps = partialSlope(s.returns, s.index, s.basket);
    if (ps) chart2 = scatter(ps.ry, ps.rx, ps.slope, tick);
  }
  // On the stub harness the eight "Stub brand 0…" rows at identical weights read
  // as a rendering bug to anyone skimming past the tag, so the block collapses to
  // one labelled state and the named neighbours appear only on a keyed run.
  const weightRows = (members, kinds) => isStub()
    ? `<div class="wm-empty">
        <div class="wm-top"><b>${members.length} neighbours · equal weights on the stub</b><span class="wm-p">structure only</span></div>
        <div class="track"><div class="fill" style="width:100%"></div></div>
        <span class="wm-note">Named brands, films, artists and shows appear here on the keyed run, one row each with its affinity weight.${kinds ? ` This basket draws on ${kinds}.` : ""}</span>
      </div>`
    : members.map((m) => `<div class="wm">
    <div class="wm-top"><b title="${esc(m.name)}">${esc(m.name)}</b><span class="wm-t">${esc(m.type)}</span><span class="wm-p">${(m.weight * 100).toFixed(1)}%</span></div>
    <div class="track"><div class="fill" style="width:${(m.weight * 100).toFixed(0)}%"></div></div>
  </div>`).join("");
  const kindsOf = (ms) => [...new Set(ms.map((m) => m.type).filter(Boolean))].map((t) => t.replace(/_/g, " ")).join(", ");
  const sec = r.secondary;
  return `${back}
  <div class="head">
    <div class="lede-col">
      <h1 class="holding-h1">${logoTile(tick, r.label, "lg", true)}<span>${tick} <span class="thin">— ${esc(r.label)}</span></span></h1>
      <p class="sub">${verdict} <span class="sector">${esc(r.sectorLabel ?? "")}</span></p>
    </div>
    <div class="side">${windowPill(DESK.window)}
      <div class="state ${liveTone()}">${DESK.rows.filter((x) => x.status === "ok").length} of ${DESK.rows.length} names priced · ${liveLabel()}${frozenAfter()}</div>
    </div>
  </div>
  ${(r.basket ?? []).length ? `<p class="loves"><b>${esc(r.label)}'s audience also loves</b> ${r.basket.slice(0, 5).map((b) => esc(b.name)).join(", ")}, so that audience's weekly taste momentum is ${esc(r.label)}'s cultural factor.</p>` : ""}
  <div class="big">
    <div class="stat"><b>${f2(r.marketBeta)}</b><small>market beta ± ${r.marketSE.toFixed(2)}</small></div>
    <div class="stat"><b style="color:${r.culturalBeta < 0 ? "var(--accent)" : "var(--good)"}">${f2(r.culturalBeta)}</b><small>cultural beta ± ${r.culturalSE.toFixed(2)} · identified on ${r.activeWeeks ?? "—"} of ${r.weeks} weeks</small></div>
    <div class="stat"><b>${f2(r.culturalT)}</b><small>t · p ${r.culturalP < 0.001 ? "< 0.001" : r.culturalP.toFixed(3)}</small></div>
    <div class="stat"><b>${r.culturalQ != null ? r.culturalQ.toFixed(3) : "—"}</b><small>q · Benjamini–Hochberg</small></div>
    <div class="stat"><b>${ptsSigned(r.deltaR2)}</b><small>ΔR² over market only</small></div>
    <div class="stat"><b>${r.r2.toFixed(2)}</b><small>R² · ${r.weeks} weeks</small></div>
  </div>
  ${r.oos ? (() => {
    const sc = DESK?.valueAdd?.oos?.scoring;
    if (sc && sc.testable === false) {
      return `<p class="rb-line">Held-out slice: <b>no test</b> — all ${r.oos.testWeeks} scored weeks are frozen for every name, and Qloo's taste series last moved in the week ending ${esc(sc.lastMove ?? "—")}. What would sit here is the training fit's perturbation on a zero regressor, <b>not a test of this name</b>.${r.placeboP != null ? ` The placebo p (${pval(r.placeboP)}) rotates the basket; it is not evidence about this row.` : ""}</p>`;
    }
    return `<p class="rb-line">Out of sample: <b>${pts(r.oos.deltaR2)}</b> ΔR² on the last ${r.oos.testWeeks} weeks, refit on the first ${r.oos.trainWeeks}${r.placeboP != null ? ` · placebo <b>p ${pval(r.placeboP)}</b>` : ""}.
    ${rowIntervals(r)} ${Math.abs(r.oos.deltaR2) < 0.00005 ? "Flat — the basket added nothing on weeks it was not fitted on, and the intervals say how little this name's row can rule out." : r.oos.deltaR2 < 0 ? "Negative — the basket did not generalise for this name." : "Positive — the basket helped on weeks it was not fitted on."}</p>`;
  })() : ""}
  ${sec ? `<p class="rb-line">Second window (${esc(sec.weeks + "")} weeks, pre-registered, an earlier market regime): cultural beta <b>${f2(sec.culturalBeta)}</b>, t ${f2(sec.culturalT, 1)}, q ${sec.culturalQ != null ? sec.culturalQ.toFixed(3) : "—"}, out-of-sample ΔR² ${sc && sc.testable === false ? "no test (the scored slice is frozen)" : pts(sec.oos.deltaR2)} — ${sec.flagged ? "the flag reproduces on this slice." : "no flag on this slice."}</p>` : ""}
  ${(() => {
    const d = DESK?.valueAdd?.dispersion;
    if (!d?.variance) return "";
    return `<p class="rb-line">This row is one name in a book of ${d.names}. Read it as a reading with its error, not as a name that is measurably different from its peers: the spread of cultural betas across the book is ${d.variance.toFixed(0)} against ${d.samplingVariance.toFixed(0)} from estimation noise alone, and the test for genuine cross-name differences is <b>${d.readsAs === "excess-dispersion" ? "positive — the names do differ" : d.readsAs === "uninformative" ? `not detectable here — this window could not have seen a taste exposure of any practical size (it would need a spread near ${d.detectable?.sd ?? "—"} against the ${d.observedSd?.toFixed(1) ?? "—"} this book shows), so treat the number as a reading with its error, not as a ranking` : "not significant"}</b>. The test and its power curve are printed on the evidence page, under "Are the names actually different from each other?".</p>`;
  })()}
  <div class="cards">
    ${s ? `<div class="card"><h3>Price and taste, ${r.weeks} weeks — both indexed to 100</h3>${chart1}
      <p class="muted" style="font-size:12px;margin-top:10px">Taste is the affinity-weighted ${esc(r.sectorLabel ?? "sub-sector")} basket, the same series the beta is fitted on.</p></div>` : ""}
    <div class="card${s ? "" : " wide"}"><h3>${esc(r.sectorLabel ?? "Sub-sector")} taste basket — what this audience leans toward (Qloo recommendations)</h3>
      <div class="wh">${weightRows(r.basket, kindsOf(r.basket))}</div>
      <p class="muted" style="font-size:12px;margin-top:14px">Every name in the ${DESK.universe?.total ?? "consumer"} universe is excluded by construction, so ${tick} can never sit in its own basket and no other name in the book can stand in for taste. ${isStub() ? "On a keyed run each row carries the affinity weight Qloo ranked it by, normalised to 1 across the basket." : "Weights are the affinity Qloo ranked each neighbour by, normalised to 1 across the basket."}</p>
    </div>
    ${chart2 ? `<div class="card wide"><h3>Why the slope is the cultural beta</h3>${chart2}
      <p class="muted" style="font-size:12px">Both axes are residualised on SPY, so the slope is the partial coefficient (Frisch–Waugh–Lovell), identical to the regression on the desk.</p>
    </div>` : ""}
    ${r.audience ? `<div class="card wide"><h3>This brand's own audience — a second, audience-level reading</h3>
      <p style="font-size:13.5px">Priced against a basket built from ${tick}'s own entity instead of its sub-sector: cultural beta <b>${f2(r.audience.culturalBeta)}</b> ± ${r.audience.culturalSE.toFixed(2)}, t ${f2(r.audience.culturalT, 1)}, ΔR² ${pts(r.audience.deltaR2)} in-sample (not the out-of-sample number) against the sector basket's ${pts(r.deltaR2)}, out of sample ${sc && sc.testable === false ? "no test (the scored slice is frozen)" : pts(r.audience.oos?.deltaR2)}. Both baskets are measured, neither is the other's stand-in: the sector number is the one on the desk and in the panel because it is comparable across the book; the audience number prices the same brand against the audience it actually sells to.</p>
      <div class="wh">${weightRows(r.audience.members, kindsOf(r.audience.members))}</div>
      <p class="muted" style="font-size:12px;margin-top:14px">Source: ${esc(r.audience.provenance)}.</p>
    </div>` : ""}
  </div>
  <p class="caption">Source: ${esc(r.provenance.basket)} · ${esc(r.provenance.series)} · ${esc(r.provenance.prices)}${r.audience ? ` · ${esc(r.audience.provenance)}` : ""}.
  <a href="#/evidence/${tick}">Open the evidence row →</a></p>`;
}

const SECTOR_SHORT = {
  beauty: "Beauty", apparel: "Apparel", restaurants: "Restaurants", media: "Media",
  grocery: "Grocery", home: "Home", beverages: "Beverages", food: "Packaged food",
  retail: "Specialty", travel: "Travel", auto: "Autos",
};

function medianOf(xs) {
  const s = [...xs].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mapView() {
  const ok = DESK.rows.filter((r) => r.status === "ok");
  const acc = new Map();
  for (const r of ok) {
    const a = acc.get(r.sector) ?? { m: [], n: 0, c: [], label: r.sectorLabel, tickers: [] };
    a.m.push(r.marketBeta); a.c.push(r.culturalBeta); a.n++; a.tickers.push(r.ticker);
    acc.set(r.sector, a);
  }
  const points = [...acc].map(([id, a]) => ({
    id,
    ticker: SECTOR_SHORT[id] ?? a.label,
    label: a.label,
    // Medians on both axes: one thin-basket name (PARA, −242) dragged the media
    // mean to −27 while the typical media name sits above zero.
    marketBeta: medianOf(a.m),
    culturalBeta: medianOf(a.c),
    n: a.n,
    members: a.tickers,
  }));
  const negative = points.filter((p) => p.culturalBeta < 0).sort((a, b) => a.culturalBeta - b.culturalBeta);
  return `
  <div class="head">
    <div class="lede-col"><h1>Taste <span class="thin">map.</span></h1>
      <p class="sub">Each dot is a sub-sector, placed by its median market beta (x) and median cultural beta (y) — medians, so one outlier name cannot drag a sub-sector across zero;
      dot size is the number of names with a cultural beta. The corner to watch is bottom-right: high market risk, taste against it.
      Hover a dot for the names inside it, or click to open that sub-sector on the desk.</p></div>
    <div class="side">${windowPill(DESK.window)}
      <div class="state ok">${ok.length} of ${DESK.rows.length} priced · ${points.length} sub-sectors</div>
    </div>
  </div>
  <div class="cards">
    <div class="card wide"><h3>The consumer book, priced two ways${isStub() ? `<span class="stubtag">stub harness · magnitudes are layout only</span>` : ""}</h3>${quadrant(points)}
      <div class="legend">
        <span><i class="sw neg"></i>median cultural beta below zero — for the typical name, taste runs against</span>
        <span><i class="sw pos"></i>above zero — taste is a tailwind</span>
        <span>dot area ∝ names with a cultural beta</span>
      </div>
    </div>
  </div>
  <p class="lede">${negative.length
    ? `${negative.map((p) => `${p.label} (${f2(p.culturalBeta)})`).join(", ")} ${negative.length === 1 ? "sits" : "sit"} below zero — for the typical name in ${negative.length === 1 ? "that sub-sector" : "those sub-sectors"}, taste runs against. None of these sub-sector readings clears the desk's flag rule; they describe exposure, not a signal.`
    : "Every sub-sector's median cultural beta is positive today. None of these readings clears the desk's flag rule; they describe exposure, not a signal."}</p>`;
}

function evidenceRows(rows) {
  // show the file names on their own lines; the full path stays in the tooltip
  // and in the cached JSON, so the cell never breaks a path mid-word
  const base = (p) => String(p ?? "").split("/").pop();
  const cachedCell = (r) => {
    const b = r.provenance?.basket ?? "", s = r.provenance?.series ?? "";
    return `<td class="url" data-l="Cached response"><span title="${esc(b)}">${esc(base(b))}</span><br><span title="${esc(s)}">${esc(base(s))}</span></td>`;
  };
  return rows.map((r) => {
    const cached = cachedCell(r);
    if (r.status !== "ok") {
      // Name the actual reason: an unresolved brand is not a weak signal, and a
      // missing price history is not an unresolved brand.
      const rs = r.resolution;
      const why = r.status === "unresolved"
        ? `no Qloo brand entity resolved — ${rs ? `${esc(rs.failure)}; queried ${rs.queriesTried.map((q) => `“${esc(q)}”`).join(", ")}; ${rs.candidatesSeen} ${rs.candidatesSeen === 1 ? "candidate" : "candidates"} returned, none matching on a word boundary` : "the cultural beta is withheld rather than guessed"}`
        : r.status === "no prices"
          ? "no complete price history in this window — nothing to price"
          : "below the sample floor — no beta printed";
      return `<tr id="ev-${r.ticker}"><td><b>${r.ticker}</b></td>
        <td class="th-left" data-l="Sub-sector">${esc(r.sectorLabel ?? "")}</td>
        <td class="th-left" data-l="Status" colspan="3">${why}</td>${r.provenance?.basket || r.provenance?.series ? cached : `<td class="url" data-l="Cached response">no Qloo request</td>`}</tr>`;
    }
    return `<tr id="ev-${r.ticker}"><td><b>${r.ticker}</b></td>
        <td class="th-left" data-l="Sub-sector">${esc(r.sectorLabel ?? "")}</td>
        <td class="th-left" data-l="Qloo entity">${esc(r.provenance.qlooRequest?.entity || "—")}</td>
        <td class="th-left" data-l="Workflow">${esc(r.provenance.qlooRequest?.operation || "")} → GET ${esc(r.provenance.qlooRequest?.path || "")}</td>
        <td class="th-left" data-l="Basket types">${esc((r.provenance.qlooRequest?.types || []).join(", "))}</td>
        ${cached}</tr>`;
  }).join("");
}

function limitsCard(w, va, uni) {
  const oos = va?.oos, pl = va?.placebo, sec = va?.secondary;
  const total = uni?.total ?? MARKET?.rows.length ?? null;
  const priced = uni?.priced ?? va?.holdings ?? null;
  const nSectors = uni?.sectors?.length ?? null;
  const oosTxt = oos
    ? (oos.scoring && oos.scoring.testable === false
      ? `Out of sample, the same two-regressor fit is re-estimated on the first ${oos.trainWeeks} weeks and scored on the last ${oos.testWeeks} — and on this Qloo vintage every one of those ${oos.scoring.testWeeks} scored weeks is frozen for every name (the last taste-series move is in the week ending ${esc(oos.scoring.lastMove ?? "—")}). A regressor that is zero multiplies its coefficient by zero, so the held-out condition is <b>not a test of taste at any effect size</b>: the printed ${pts(oos.meanDeltaR2)} is the training fit's perturbation, and its intervals describe coefficient wobble, not a bound on taste. The desk states that rather than presenting the cell as a negative result.`
      : `Out of sample, the same two-regressor fit is re-estimated on the first ${oos.trainWeeks} weeks and scored on the last ${oos.testWeeks}, where it added ${pts(oos.meanDeltaR2)} on average across ${priced ?? "every"} priced names. That number is reported as computed, including when it is negative.`)
    : "Out of sample, the fit is re-estimated on an early sub-window and scored on the rest; a negative result is reported as negative.";
  const plTxt = pl
    ? `The book's mean ΔR² is re-computed against ${pl.draws} circular rotations of the taste baskets, every name shifted by the same amount so cross-name alignment survives and the null keeps the book's correlation structure. Real ${pts(pl.real)} against a rotation mean of ${pts(pl.placeboMean)}, p = ${pval(pl.p)}. A high p means the factor cannot be told apart from a rotation of itself on this book.`
    : "Rotating the taste series against returns asks whether the real alignment beats a placebo.";
  const pm = va?.permutation;
  const permTxt = pm
    ? `A second null shuffles the week order of the baskets instead of rotating them — one shared shuffle per draw, so each basket keeps its own spread and only its timing is destroyed. Real ${pts(pm.real)} against a shuffled mean of ${pts(pm.placeboMean)}, p = ${pval(pm.p)}. A positive claim has to clear <b>both</b> nulls — the better of the two p-values is never used alone, because a null chosen after its p is seen is not a test.`
    : "";
  const secTxt = sec
    ? `The whole estimator — same baskets, same floor, same ${sec.placebo.draws} draws and seed — is re-run on the ${sec.window.weeks} weekly returns from ${sec.window.start} to ${sec.window.end}, immediately before the primary window. That window was fixed in config/book.json before any keyed run, never chosen from results. It is an earlier market regime, not an identical-conditions repeat, so a replication is the stronger claim and a miss can be a regime difference rather than a refutation. On it the basket's mean ΔR² is ${pts(sec.meanDeltaR2)} and placebo p ${pval(sec.placebo.p)}, so the factor ${sec.replicates ? "replicates" : "does not replicate"}.`
    : DESK?.valueAdd?.secondarySkip
      ? `The window was fixed in config/book.json before any keyed run and is not repurposed or re-dated here. It cannot be priced: ${esc(DESK.valueAdd.secondarySkip)}. The desk reports that as untestable rather than as a failure to replicate, because the estimator never ran on it.`
      : "The replication window is pre-registered in config/book.json and runs with the same estimator on the 106 weeks before the primary window.";
  const dq = DESK?.dataQuality;
  const rs = dq?.revisionSensitivity;
  const dqTxt = dq && (dq.cutFromPrimary || dq.cutFromPrior)
    ? `<li><b>Catalogue revisions.</b> ${dq.cutFromPrimary} week${dq.cutFromPrimary === 1 ? "" : "s"} cut from the primary window and ${dq.cutFromPrior} from the prior one (${dq.revisionWeeks.map((r) => esc(r.date)).join(", ")}). ${esc(dq.rule)}${rs
      ? ` The cut is checkable, not asserted: re-running the same estimator with the cut dropped (${rs.weeks} weeks) gives out-of-sample ΔR² ${pts(rs.oos)} and placebo p ${pval(rs.placeboP)} against ${pts(va?.oos?.meanDeltaR2)} and p ${pval(va?.placebo?.p)} on the cut calendar — the same verdict either way, so the cut is not what produces the result.`
      : ""}</li>`
    : "";
  const fs = DESK?.factorSparsity;
  const fsTxt = fs
    ? `<li><b>Identification.</b> The basket reads zero in every week Qloo reports no movement, so each cultural beta is estimated on the weeks it does move: ${fs.minActive}–${fs.maxActive} of ${fs.weeks} per name, median ${fs.medianActive}. A slope fitted on that few weeks can be large and unstable, which is why every row carries its ±${va?.oos?.scoring?.testable === false ? " and its held-out cell is labelled a perturbation rather than a check." : " and its out-of-sample ΔR²."}</li>`
    : "";
  return `<div class="card wide"><h3>What this desk is, and is not</h3>
    <ul class="limits">
      <li><b>Universe.</b> ${total ?? "Every"} US consumer names across ${nSectors ?? "eleven"} sub-sectors, each priced against its own sub-sector's taste basket rather than a basket of its own — so one factor is comparable across the book, and a new name costs one lookup plus the trend points for the basket it adds, never a basket of its own. It is a book to read, not a screen or a ranking of investability.</li>
      <li><b>Window.</b> ${w.weeks} weekly returns ending ${esc(w.end)}, fixed before estimation, plus a disjoint ${sec?.window.weeks ?? 106}-week replication window before it${sec || !DESK?.valueAdd?.secondarySkip ? "" : " (pre-registered, but the data could not price it — see below)"}. No weight, window or threshold was tuned on these returns.</li>
      <li><b>Units.</b> A sub-sector's basket is the affinity-weighted mean weekly log change in <code>population_percentile</code> across the non-holding entities Qloo recommends for that audience. A cultural beta of 1.0 means a name's weekly log return moves one-for-one with the basket; 0.25 means a quarter as much. It is an exposure, not a forecast.</li>
      ${dqTxt}
      ${fsTxt}
      <li><b>Multiple testing.</b> ${priced ? `The ${priced}` : "Each"} cultural betas are tested one at a time; at |t| ≥ 2 alone about ${priced ? Math.round(priced * 0.05) : "five"} of ${priced ?? "a hundred"} would flag by chance. The desk therefore requires a Benjamini–Hochberg q ≤ 0.10 across every priced name before it calls a negative beta a flag, and prints the q on the row. Read a flag as a screen that survived its own correction, not a verdict.</li>
      <li><b>ΔR², twice.</b> In-sample, it shows the taste basket adds information inside the fitted window. ${oosTxt}</li>
      <li><b>Second window.</b> ${secTxt}</li>
      <li><b>Placebo.</b> ${plTxt}</li>
      ${permTxt ? `<li><b>Placebo, second construction.</b> ${permTxt}</li>` : ""}
      <li><b>No trading.</b> The desk measures exposure. It does not size, weight, route or recommend a position. It also does not quote a Sharpe or a portfolio return, because both need a <i>varying</i> cultural series across a held-out window and, at this vintage, that window is empty. A return claim built on ${va?.oos?.scoring?.testable === false ? "the frozen scored slice" : "an unpowered slice"} would be manufactured, so none is made.</li>
    </ul>
  </div>`;
}

function gradeSummaryCard(va) {
  const sc = va?.oos?.scoring;
  if (!va?.oos) return "";
  const ok = EVIDENCE.rows.filter((r) => r.status === "ok");
  const flagged = ok.filter((r) => r.flagged).length;
  const v = verdictOf(ok, flagged, va);
  return `<div class="card wide" data-audit="grade-summary"><h3>The grade, before the table</h3>
    <div class="chips">
      <span class="chip ${v.grade === "HOLDS" ? "good" : v.grade === "FAILS" ? "bad" : "mid"}">${v.grade}</span>
      <span class="chip">${sc && sc.testable === false ? "OOS ΔR² not a test" : `OOS ΔR² ${pts(va.oos.meanDeltaR2)}`}</span>
      <span class="chip">rotation p ${va.placebo ? pval(va.placebo.p) : "—"}</span>
      <span class="chip">week shuffle p ${va.permutation ? pval(va.permutation.p) : "—"}${va.permutation?.pBlocked == null ? "" : ` · block p ${pval(va.permutation.pBlocked)}`}</span>
      ${sc && sc.testable === false ? `<span class="chip bad">held-out slice frozen</span>` : ""}
    </div>
    <p style="font-size:13.5px">${esc(v.sentence)}</p>
    ${sc && sc.testable === false ? `<p class="muted" style="font-size:12px">Against a true taste effect of any size, the held-out condition's power is its size on this pull, because the scored regressor is constant in all ${sc.testWeeks} scored weeks: multiplying a coefficient by zero gives zero whatever the coefficient is. That is not a power failure a longer window would fix at this data vintage — it is an empty test slice, and it is labelled as one wherever the out-of-sample number appears. The in-sample book and the nulls are what remain, and they are printed in full below.</p>` : ""}
  </div>`;
}

function dataVintageCard(va) {
  const sc = va?.oos?.scoring;
  if (!sc) return "";
  const c = va?.oos?.cadence;
  return `<div class="card wide" data-audit="vintage"><h3>When Qloo's numbers stop moving</h3>
    <p style="font-size:13.5px">In this pull every entity's <code>population_percentile</code> last changes on <b>${esc(sc.lastMove ?? "—")}</b> — the last week whose factor return is non-zero. The price window runs to ${esc(EVIDENCE.window.end)}, so its final <b>${sc.frozenAfterWindow} weeks</b> are a carry-forward: identical level, a weekly log change of exactly zero, for every name. The pre-registered 67/35 split puts <b>all ${sc.testWeeks} scored weeks</b> inside that tail; the median name's basket moves in ${sc.medianActive} of them. That is why the held-out cell is marked “no test” rather than read as a negative.</p>
    ${c ? `<p style="font-size:13.5px"><span class="stubtag">post-hoc · not a test of the claim</span> <b>Diagnostic only: the split moved where the data moves.</b> The same estimator, with the split moved inside the revised part of the window (${esc(c.start)} → ${esc(c.end)}, ${c.trainWeeks} train / ${c.testWeeks} test, ${c.activeMedian} active test weeks), gives a median ΔR² of <b>${ptsSigned(c.median)}</b> and is positive on ${Math.round(c.sharePositive * 100)}% of names; the mean is ${ptsSigned(c.mean)} because a handful of names with almost no variance inside the scored weeks dominate it (range ${ptsSigned(c.min)} to ${ptsSigned(c.max)}). This split was chosen after the pre-registered one failed to have power, so it is <b>not evidence for the claim and does not move the grade</b>: a test picked after seeing where the data moves can always be made to run. It is printed because the alternative — showing an empty test and nothing else — hides the most informative number available, and because a reader should see it labelled rather than find it later.</p>` : ""}
    <p class="muted" style="font-size:12px">The frozen tail is a property of the endpoint's revision history, not a choice made after seeing returns: the same dates are visible in ${esc("fixtures/qloo/series.json")} without any price data. The pre-registered window and split are unchanged.</p>
  </div>`;
}

function evidenceView(tick) {
  if (!EVIDENCE) {
    if (!MARKET) return `<div class="head"><div class="lede-col"><h1>Evidence <span class="thin">desk.</span></h1>
      <p class="sub">The desk server is not answering. Start it with <code>npm start</code> and reload.</p></div></div>`;
    const urls = Object.entries(MARKET.pricesSource?.requestUrls || {})
      .map(([s, u]) => `<tr${s === tick ? ' class="hl"' : ""}><td><b>${s}</b></td><td class="url" data-l="Request">${esc(u)}</td><td class="num" data-l="Weeks">${MARKET.window.weeks}</td></tr>`).join("");
    return `${headBlock("Evidence <span class=\"thin\">desk.</span>",
      "Every number on the desk, and the request it came from. The price half is a committed snapshot and traceable now; the Qloo requests are listed with what they will supply.",
      MARKET.window, "prices committed · cultural factor locked", "warn")}
    <div class="cards">
      <div class="card wide"><h3>Price source — committed snapshot</h3>
        <div class="tw"><table>
          <thead><tr><th>Symbol</th><th class="th-left">Yahoo Finance request</th><th><span class="th">Weeks</span></th></tr></thead>
          <tbody>${urls}</tbody></table></div>
        <p class="muted" style="font-size:12px;margin-top:10px">Fetched once by <code>scripts/fetch-prices.mjs</code> and committed to fixtures/prices.json. The desk reads that file and makes no network call for prices at runtime. Weekly bars, ${MARKET.window.start} → ${MARKET.window.end}, aligned to one calendar before any regression runs.</p>
      </div>
      <div class="card wide"><h3>Qloo requests — run when the key is connected</h3>
        <div class="tw"><table>
          <thead><tr><th class="th-left">Workflow</th><th class="th-left">Supplies</th></tr></thead>
          <tbody>
            <tr><td class="url" data-l="Workflow">exec search → GET /search</td><td class="th-left" data-l="Supplies">one entity id per consumer name; a name that does not resolve keeps its row and loses its beta</td></tr>
            <tr><td class="url" data-l="Workflow">exec recommend → GET /v2/insights</td><td class="th-left" data-l="Supplies">one taste basket per sub-sector, signalled by up to ten of its entities, with the affinity each neighbour was ranked by</td></tr>
            <tr><td class="url" data-l="Workflow">exec trends → GET /v2/trending</td><td class="th-left" data-l="Supplies">weekly taste levels for every basket member, differenced to a weekly log change in population_percentile</td></tr>
          </tbody></table></div>
        <p class="muted" style="font-size:12px;margin-top:10px">Raw Qloo responses are cached locally under fixtures/qloo/ and never committed: the hackathon terms keep response data out of public repositories.</p>
      </div>
      <div class="card wide"><h3>Product surface — the same panel, as data</h3>
        <div class="tw"><table>
          <thead><tr><th class="th-left">Route</th><th class="th-left">Returns</th></tr></thead>
          <tbody>
            <tr><td class="url" data-l="Route">GET /api/v1/panel</td><td class="th-left" data-l="Returns">versioned panel: every name's cultural beta, t, q, out-of-sample ΔR², flag, sub-sector basket and second-window reading</td></tr>
            <tr><td class="url" data-l="Route">GET /api/v1/holding/ELF</td><td class="th-left" data-l="Returns">one name, same fields, plus its basket composition and audience reading where it has one</td></tr>
            <tr><td class="url" data-l="Route">GET /api/v1/alerts</td><td class="th-left" data-l="Returns">the panel read as a watchlist: names whose headwind cleared every test, a reason for every name that did not — and a status field that says when the book-level null cannot support an alert at all</td></tr>
            <tr><td class="url" data-l="Route">GET /export/panel.csv</td><td class="th-left" data-l="Returns">the whole panel as a spreadsheet</td></tr>
          </tbody></table></div>
        <p class="muted" style="font-size:12px;margin-top:10px">A measurement desk that can be ingested, not just read. Every route answers 503 with a named refusal when the factor has not been computed, and never fills a missing beta with zero. <b>Data boundary:</b> raw Qloo responses stay in the local cache — the hosted surface serves derived numbers only, which is what Qloo's terms allow; an unfiltered republish of their payload would not.</p>
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
      <div class="state ${liveTone()}">${EVIDENCE.rows.filter((r) => r.status === "ok").length}/${EVIDENCE.rows.length} names priced · ${liveLabel()}${frozenAfter()}</div>
    </div>
  </div>
  <div class="cards">
    ${gradeSummaryCard(EVIDENCE.valueAdd)}
    <div class="card wide"><h3>Qloo requests behind the cultural betas</h3>
      <div class="tw"><table data-audit="holdings"><thead><tr><th>Name</th><th class="th-left">Sub-sector</th><th class="th-left">Qloo entity</th><th class="th-left">Workflow</th><th class="th-left">Basket types</th><th class="th-left">Cached response</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <p class="muted" style="font-size:12px;margin-top:10px">Coverage: <b>${EVIDENCE.rows.filter((r) => r.status === "ok").length} priced with a cultural beta</b>, ${EVIDENCE.rows.filter((r) => r.status === "no prices").length} without a complete price history, ${EVIDENCE.universe?.unresolved?.length ?? 0} with no Qloo entity — those carry no beta rather than a guessed one, and their searches are printed in the book. One recommend call per sub-sector per type, signalled by up to ten resolved entities of that sector. The ablation control is not in this table because it uses no Qloo data: it is the equal-weight weekly return of the other names in the sub-sector, computed from the same committed prices. The taste arm costs up to ${EVIDENCE ? "11 sub-sectors × 4 creative types × 1 recommend call plus one trends page per basket member" : "one Qloo call set"}; the peer control costs zero.</p>
    </div>
    <div class="card"><h3>Price evidence</h3>
      <div class="ev">${urls}</div>
      <p class="muted" style="font-size:12px;margin-top:10px">Fetched once and committed to fixtures/prices.json; read from disk, never refetched at runtime. ${EVIDENCE.window.weeks} aligned weekly returns per name, window ${EVIDENCE.window.start} → ${EVIDENCE.window.end}.</p>
    </div>
    ${dataVintageCard(EVIDENCE.valueAdd)}
    <div class="card"><h3>Factor construction</h3>
      <p style="font-size:13.5px">${esc(EVIDENCE.factorConstruction)}</p>
      <p class="muted" style="font-size:12px">Null route: with Qloo responses emptied the desk refuses to print — enforced by tests/nullroute.test.mjs. Sample floor: a name with fewer than 100 weekly points keeps its row and carries no beta.</p>
    </div>
    <div class="card wide"><h3>Product surface — the same panel, as data</h3>
      <div class="tw"><table>
        <thead><tr><th class="th-left">Route</th><th class="th-left">Returns</th></tr></thead>
        <tbody>
          <tr><td class="url" data-l="Route">GET /api/v1/panel</td><td class="th-left" data-l="Returns">versioned panel: every name's cultural beta, t, q, out-of-sample ΔR², flag, sub-sector basket and second-window reading</td></tr>
          <tr><td class="url" data-l="Route">GET /api/v1/holding/ELF</td><td class="th-left" data-l="Returns">one name, same fields, plus its basket composition and audience reading where it has one</td></tr>
          <tr><td class="url" data-l="Route">GET /api/v1/alerts</td><td class="th-left" data-l="Returns">the panel read as a watchlist: names whose headwind cleared every test, a reason for every name that did not — and a status field that says when the book-level null cannot support an alert at all</td></tr>
          <tr><td class="url" data-l="Route">GET /export/panel.csv</td><td class="th-left" data-l="Returns">the whole panel as a spreadsheet</td></tr>
        </tbody></table></div>
      <p class="muted" style="font-size:12px;margin-top:10px">A measurement desk that can be ingested, not just read. Every route answers 503 with a named refusal when the factor has not been computed, and never fills a missing beta with zero. <b>Data boundary:</b> raw Qloo responses stay in the local cache — the hosted surface serves derived numbers only, which is what Qloo's terms allow; an unfiltered republish of their payload would not.</p>
    </div>
    ${robustBand(EVIDENCE.valueAdd)}
    ${pooledBand(EVIDENCE.valueAdd)}
    ${dispersionBand(EVIDENCE.valueAdd)}
    ${mdeBand()}
    ${flipBand(EVIDENCE.valueAdd)}
    ${basketBand()}
    ${sentimentBand(EVIDENCE.valueAdd)}
    ${ablationBand(EVIDENCE.valueAdd)}
    ${costBand(EVIDENCE.valueAdd)}
    ${branchCard(EVIDENCE.valueAdd)}
    ${limitsCard(EVIDENCE.window, EVIDENCE.valueAdd, EVIDENCE.universe)}
  </div>`;
}

/* ---------- the same variation, read pooled ---------- */
// The per-name fit spends 102 weeks of data on a basket that moves in about 29 of
// them, so each slope is wide. Pooling shares one slope across the names of a
// sub-sector, which is the restriction the per-name table cannot test. It is
// labelled post-hoc because it was added after a review, not pre-registered.
function pooledBand(va) {
  const p = va?.pooled;
  if (!p?.sectors?.length) return "";
  const k = p.sectors.length;
  const bonf = 0.05 / k;
  const survivors = p.sectors.filter((s) => s.p <= bonf);
  const twoSig = p.sectors.filter((s) => Math.abs(s.t) >= 2);
  const rows = p.sectors.map((s) => `<tr${Math.abs(s.t) >= 2 ? ' class="hl"' : ""}>
      <td>${esc(s.id)}</td><td class="num" data-l="Names">${s.names}</td>
      <td class="num" data-l="β">${s.beta >= 0 ? "+" : ""}${s.beta.toFixed(2)}</td>
      <td class="num" data-l="±">± ${s.se.toFixed(2)}</td>
      <td class="num" data-l="t">${s.t.toFixed(2)}</td>
      <td class="num" data-l="p">${pval(s.p)}</td>
      <td class="num" data-l="Ridge β">${s.ridgeBeta == null ? "—" : (s.ridgeBeta >= 0 ? "+" : "") + s.ridgeBeta.toFixed(2)}</td>
    </tr>`).join("");
  return `<section class="robust full" aria-label="Pooled panel">
    <div class="rb-head"><h2>One slope per sub-sector <span class="stubtag">post-hoc · added after external review</span></h2>
      <p class="rb-sub">The per-name table fits 80 separate slopes, each identified on the few weeks its basket actually moved — ${p.weeks} at the median. This reading asks the other question — is there <i>one</i> cultural slope per sub-sector? — by pooling the ${p.names} names into ${p.obs.toLocaleString("en-US")} name-weeks with name fixed effects swept out, one common market slope, and standard errors clustered by week because every name shares the same calendar. <b>It answers a different estimand.</b> One slope per sub-sector is a statement about the sub-sector; it cannot confirm or refute a claim about an individual name, and a flat sector slope is compatible with names inside it moving in opposite directions. What it does test is the restriction the per-name table leaves open: that taste, if it prices at all, prices the same for peers. It is not pre-registered: a reviewer asked for it and it is reported whatever it says.</p></div>
    <div class="rb-grid three">
      <div class="rb-test"><div class="rb-k">Common market slope</div><div class="rb-v">${p.market.beta.toFixed(2)}</div><div class="rb-se">t ${p.market.t.toFixed(1)} · one coefficient for the whole book</div></div>
      <div class="rb-test"><div class="rb-k">Within-book ΔR²</div><div class="rb-v">${pts(p.deltaR2)}</div><div class="rb-se">market-only within R² ${(p.withinR2.marketOnly * 100).toFixed(2)}% → ${(p.withinR2.full * 100).toFixed(2)}%</div></div>
      <div class="rb-test"><div class="rb-k">Date permutation</div><div class="rb-v ${p.null.p <= 0.10 ? "good" : "bad"}">p ${pval(p.null.p)}</div><div class="rb-se">real ${pts(p.null.real)} vs shuffled ${pts(p.null.mean)}, ${p.null.draws} draws</div></div>
    </div>
    ${(() => {
      const m = va?.pooledNameMarket;
      if (!m) return "";
      const strongest = m.sectors.reduce((a, b) => (Math.abs(b.t) > Math.abs(a.t) ? b : a));
      return `<div class="rb-window"><span>Same panel, each name keeps its own market loading</span><span class="rb-span">the common slope removed</span></div>
    <div class="rb-grid three">
      <div class="rb-test"><div class="rb-k">Within-book ΔR²</div><div class="rb-v">${pts(m.deltaR2)}</div><div class="rb-se">name fixed effects and a name-specific market beta, partialled out first — algebraically the same as a name × market interaction</div></div>
      <div class="rb-test"><div class="rb-k">Date permutation</div><div class="rb-v ${m.null.p <= 0.10 ? "good" : "bad"}">p ${pval(m.null.p)}</div><div class="rb-se">real ${pts(m.null.real)} vs shuffled ${pts(m.null.mean)}, ${m.null.draws} draws</div></div>
      <div class="rb-test"><div class="rb-k">Market loadings across names</div><div class="rb-v">${m.market.min.toFixed(2)} to ${m.market.max.toFixed(2)}</div><div class="rb-se">sd ${m.market.sd.toFixed(2)} — enough variation that one common slope is a real restriction, not a harmless one. Largest |t| here is ${esc(strongest.id)} at ${strongest.t.toFixed(2)}.</div></div>
    </div>
    <p class="rb-line">A reviewer's objection was that forcing one market slope on ${m.names} names could manufacture or hide the answer. It does not: removing the restriction leaves the within-ΔR² at ${pts(m.deltaR2)} and the permutation p at ${pval(m.null.p)}, against ${pts(p.deltaR2)} and ${pval(p.null.p)} with the common slope. ${m.sectors.every((s) => Math.abs(s.t) < 2) ? "No sub-sector slope reaches |t| ≥ 2 on this arm either." : "The sub-sector slopes move once each name's loading is free, which is itself the reason the sector-level estimand is not the per-name claim."}</p>`;
    })()}
    <div class="tw" style="margin-top:14px"><table class="live" data-audit="pooled">
      <thead><tr><th>Sub-sector</th><th><span class="th">Names</span></th><th><span class="th">Cultural beta</span></th><th><span class="th">SE</span></th><th><span class="th">t</span></th><th><span class="th">p</span></th><th><span class="th">Ridge β</span></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="rb-line">${twoSig.length
      ? `${twoSig.length} of ${k} slopes ${twoSig.length === 1 ? "reaches" : "reach"} |t| ≥ 2 (${twoSig.map((s) => `${esc(s.id)} ${s.t.toFixed(2)}`).join(", ")}), and ${survivors.length ? `${survivors.length} survives` : "none survives"} a Bonferroni threshold of p ≤ ${bonf.toFixed(4)} across ${k} sub-sectors. With ${k} sub-sector tests, one or two |t| ≥ 2 is what chance supplies — the pooled reading therefore says the same thing as the per-name book: at this window length the cultural factor is not separable from chance.`
      : `No sub-sector slope reaches |t| ≥ 2, so the pooled reading agrees with the per-name book: at this window length the cultural factor is not separable from chance.`}
      ${p.ridge ? ` The ridge column applies one penalty scale (λ = ${p.ridge.lambda.toExponential(1)}, ${(p.ridge.factor * 100).toFixed(0)}% of the mean cultural diagonal) to every sub-sector: the slopes whose baskets barely move shrink most — media ${(p.sectors.find((s) => s.id === "media")?.beta ?? 0).toFixed(2)} → ${(p.sectors.find((s) => s.id === "media")?.ridgeBeta ?? 0).toFixed(2)} is the extreme — which is the instability the per-name ±s already show.` : ""}</p>
  </section>`;
}

/* ---------- are the names actually different? ---------- */
// A near-zero mean and a zero spread are different findings. The book-level tests
// cannot tell them apart, so the per-name slopes are read directly: is the spread
// across names more than estimation noise? Both tails are printed, because the
// lower one is the reading that rules the per-name column out.
function dispersionBand(va) {
  const d = va?.dispersion;
  if (!d || d.variance == null) return "";
  const mde = d.detectable ? `${d.detectable.sd}` : null;
  const reads = {
    "excess-dispersion": ["the names genuinely differ", "good"],
    "no-dispersion": ["spread below noise — one number plus scatter", "bad"],
    indeterminate: ["no larger than noise — heterogeneity not detectable", "mid"],
    uninformative: ["the test cannot see a spread this window could contain", "mid"],
    undetermined: ["not determinable", "mid"],
  }[d.readsAs] ?? ["not determinable", "mid"];
  const powerRows = (d.power ?? []).map((r) => `${r.sd} → <b>${Math.round(r.power * 100)}%</b>`).join(" · ");
  return `<section class="robust full" aria-label="Dispersion">
    <div class="rb-head"><h2>Are the names actually different from each other? <span class="stubtag">post-hoc · added after external review</span></h2>
      <p class="rb-sub">A mean near zero can mean every name has the same dull exposure, or that names genuinely pull opposite ways and the mean cancels. Only the second makes a per-name column worth reading. This tests the spread directly: the cross-sectional variance of the ${d.names} per-name cultural betas against the average squared standard error, which is what spread you would see if every name were in truth the same number. The null rotates <b>each name's basket independently</b>, so every basket keeps its own shape and loses only its timing — sampling noise survives, any name-specific signal does not.</p></div>
    <div class="rb-grid four">
      <div class="rb-test"><div class="rb-k">Spread across names</div><div class="rb-v">${d.variance.toFixed(0)}</div><div class="rb-se">variance of ${d.names} per-name cultural betas, ${d.weeks} weeks each</div></div>
      <div class="rb-test"><div class="rb-k">Explained by noise</div><div class="rb-v">${d.samplingVariance.toFixed(0)}</div><div class="rb-se">mean squared standard error — the spread if every name were identical · excess ${d.excess >= 0 ? "+" : ""}${d.excess.toFixed(0)}</div></div>
      <div class="rb-test"><div class="rb-k">Independent-rotation null</div><div class="rb-v ${reads[1] === "mid" ? "" : reads[1] === "good" ? "good" : "bad"}">p ${pval(d.p)}</div><div class="rb-se">null mean ${d.nullMean.toFixed(0)} · p95 ${d.nullP95.toFixed(0)} · p05 ${d.nullP05.toFixed(0)}, ${d.draws} draws. Lower tail p ${pval(d.pLow)} — evidence the spread is <i>smaller</i> than noise.</div></div>
      <div class="rb-test"><div class="rb-k">Power at the observed spread</div><div class="rb-v">${d.powerObserved == null ? "—" : `${Math.round(d.powerObserved * 100)}%`}</div><div class="rb-se">how often this test would find a genuine spread the size this book shows. 80% is the bar; at 0% the non-detection is uninformative, not a kill.</div></div>
    </div>
    <div class="rb-window"><span>Could this test have seen a spread at all?</span><span class="rb-span">planted heterogeneity, ${d.powerWorlds} simulated books per value</span></div>
    <p class="rb-line">Each name's outcome is shifted so its cultural beta becomes a draw from a known spread, holding everything else fixed, and the same 90% threshold is applied. Detection rate at a planted cross-sectional sd of ${powerRows}. ${mde
      ? `80% power is reached only at sd ${mde} — a taste exposure that would move a stock ${mde}% for every 1% the basket moves, far outside anything plausible in this book, and about ${(Number(mde) / Math.sqrt(d.variance)).toFixed(1)}× the spread actually observed.`
      : `No planted spread in the grid reaches 80% power.`} The bar is fixed on that pre-specified grid, not on the spread the book happens to show.${d.powerObserved != null ? ` Power at the observed spread (sd ${d.observedSd.toFixed(1)}) is <b>${Math.round(d.powerObserved * 100)}%</b> — a diagnostic of what the test could have seen, and the whole basis for calling the non-detection ${d.powerObserved >= 0.8 ? "a real null" : "uninformative"}. Power 0% means the test cannot separate the spread it measured from noise; it does <b>not</b> say the spread is real.` : ""}</p>
    <p class="rb-line"><b>${reads[0]}.</b> Observed spread is ${d.ratio == null ? "—" : d.ratio.toFixed(2)}× the analytic noise benchmark, and the rotation null sits ${d.benchmarkGap == null ? "—" : `${(Math.abs(d.benchmarkGap) * 100).toFixed(0)}% ${d.benchmarkGap < 0 ? "below" : "above"}`} it. The two benchmarks disagree, and the null says which one is wrong for this statistic: ${d.nullSamplingVariance != null && d.gapInNull != null ? `inside the rotation draws — where every name's basket timing is severed — the analytic figure still averages ${d.nullSamplingVariance.toFixed(0)} against a cross-sectional variance of ${d.nullMean.toFixed(0)}, a ${(Math.abs(d.gapInNull) * 100).toFixed(0)}% gap, essentially the same as on the real book. So the mean squared standard error is the miscalibrated benchmark here. Two channels can produce that gap — a sum of ${d.names} marginal variances treats the slopes as ${d.names} independent estimates, and the ${d.names} names are measured on one shared calendar, where common shocks and correlated residuals pull the cross-sectional spread away from that sum. The null cannot separate the two channels; what it does establish is that the analytic figure is the wrong yardstick, and every p above is read against the rotation null.` : "the analytic benchmark assumes independent per-name estimates, which a shared calendar violates."} ${d.readsAs === "excess-dispersion"
      ? "The spread is wider than noise: names carry genuinely different exposures, a cross-sectional story the book-level mean cannot show."
      : d.readsAs === "uninformative"
        ? `So this is <b>not a kill</b>, and the practical consequence is what matters: at this window the book <b>cannot detect a taste exposure of any size a portfolio would act on</b> — it would take a spread near ${mde ?? "the grid's top"} against the ${d.observedSd.toFixed(1)} actually present. The per-name column is therefore a reading with its error, not a ranking of which names carry more cultural risk, and the absence of excess spread is a property of this window rather than evidence that the names move together.`
        : "The spread is no larger than noise, so the per-name column is a reading with its error rather than evidence that sub-sectors respond differently."}</p>
  </section>`;
}

/* ---------- what this window could have detected ---------- */
// A zero flag count is only a result next to the effect size the design could have
// flagged, and only a robust one next to the alternative constructions that were also
// tried. Both bands read a committed analysis file served by the desk: nothing here is
// re-derived in the browser, and a missing file prints as "not computed".
const ptsf = (x) => (x == null || !Number.isFinite(Number(x)) ? "—" : (Number(x) >= 0 ? "+" : "") + (Number(x) * 100).toFixed(2));
const nf = (x, d = 2) => (x == null || !Number.isFinite(Number(x)) ? "—" : Number(x).toFixed(d));
const npc = (x, d = 1) => (x == null ? "—" : (Number(x) * 100).toFixed(d) + "%");

function mdeBand() {
  if (!MDE) {
    return `<section class="robust full" aria-label="Detectability">
    <div class="rb-head"><h2>What this window could have detected <span class="stubtag">not computed</span></h2>
      <p class="rb-sub">The bound is not on this build: <code>/api/mde.json</code> served no file. <code>node scripts/mde.mjs</code> re-derives it from the committed panel and the cached responses, and makes zero Qloo requests.</p></div>
  </section>`;
  }
  const mo = MDE.method ?? {};
  const b = MDE.book ?? {};
  const o = b.observed ?? {};
  const s = MDE.source ?? {};
  const fs = MDE.frozenSlice ?? null;
  const sim = MDE.simulation ?? {};
  const arms = sim.analyticVsSimulated ?? [];
  const nullArm = arms.find((r) => r.ncp === 0);
  const mdeArm = arms.find((r) => r.ncp != null && Math.abs(r.ncp - (mo.ncpMDE ?? NaN)) < 1e-3);
  const req = (MDE.designRequirement?.rows ?? []).slice().sort((a, r) => (r.weeks ?? 0) - (a.weeks ?? 0));
  const selfCheck = req.find((r) => /self-check/i.test(String(r.label ?? "")));
  const cell = (k, v, sub, tone = "") => `<div class="rb-test"><div class="rb-k">${k}</div><div class="rb-v ${tone}">${v}</div>${sub ? `<div class="rb-se">${sub}</div>` : ""}</div>`;
  const obsCell = (r, caption) => r ? cell(`Largest ${caption} in the book <b>${esc(r.ticker)}</b>`, `t ${nf(r.t, 3)}`, `β ${nf(r.beta)} · q ${nf(r.q, 3)} · its in-sample increment ${nf(r.deltaR2Pts)} pts is <b>${npc(r.shareOfMde)}</b> of the detectable one, and the rule would flag it ${npc(r.powerAtObserved)} of the time at that effect`) : "";
  const rows = req.map((r) => `<tr>
      <td class="th-left" data-l="Effect">${esc(r.label)}</td>
      <td class="num" data-l="ΔR²">${nf(r.deltaR2Pts)} pts</td>
      <td class="num" data-l="Weeks">${r.weeks == null ? "—" : Number(r.weeks).toLocaleString("en-US")}</td>
      <td class="num" data-l="Years">${r.years == null ? "—" : r.years}</td>
      <td class="num" data-l="× panel">${r.multipleOfCurrentPanel == null ? "—" : r.multipleOfCurrentPanel + "×"}</td>
      <td class="th-left" data-l="Source">${esc(r.source ?? "")}${r.reason ? ` · ${esc(r.reason)}` : ""}</td>
    </tr>`).join("");
  return `<section class="robust full" aria-label="Detectability">
    <div class="rb-head"><h2>What this window could have detected <span class="stubtag">design bound · post-hoc as a choice of effect size</span></h2>
      <p class="rb-sub">"0 of ${b.names ?? "the"} names flagged" is only a result next to the effect size the design could have flagged. This is that number: the <b>minimum detectable effect</b> — the increment over the market-only fit a name would need for the pre-registered rule (negative β, |t| ≥ ${mo.flagRule?.absT ?? "2"}, Benjamini–Hochberg q ≤ ${mo.flagRule?.qMax ?? "0.1"}) to flag it ${npc(mo.powerTarget, 0)} of the time, computed on that name's own design: ${mo.weeks} weeks, its own residual scale, its own basket's own variance. ${esc(mo.singleDiscoveryLevelRule ?? "")} It uses no observed t-statistic at all, which is why it can be published beside the null rather than chosen by it. ${esc(MDE.preRegistered?.note ?? "")}</p></div>
    <div class="rb-grid four">
      ${cell("Detectable increment, median name", `${nf(b.medianDeltaR2Pts)} pts`, `IQR ${nf(b.iqr?.[0])} – ${nf(b.iqr?.[1])} · range ${nf(b.minDeltaR2Pts)} – ${nf(b.maxDeltaR2Pts)} across ${b.names} names · median |β| ${nf(b.medianBetaMDE)} slope units, comparable inside a sub-sector only`)}
      ${cell("The same bound as a partial correlation", nf(b.minPartialCorrelation, 3), `partial R² ${nf(b.partialR2MDEpts)} pts · required noncentrality ${nf(mo.ncpMDE, 4)} at t<sub>crit</sub> ${nf(mo.tCrit, 4)}, df ${mo.df}${mo.singleDiscoveryLevel == null ? "" : ` · lone-discovery level ${mo.singleDiscoveryLevel}`}`)}
      ${cell("What the book actually shows", `${nf(o.meanDeltaR2Pts)} pts`, `mean in-sample increment over ${mo.weeks} aligned weeks · largest single reading ${nf(o.largestAbsT?.deltaR2Pts)} pts`)}
      ${cell("Flagged names", String(o.flaggedNames ?? "—"), `power at the median observed reading ${npc(b.powerAtMedianObserved, 2)} — at the spread the book shows, this rule finds essentially nothing`, "bad")}
    </div>
    <div class="rb-window"><span>The two largest readings, against the bound</span><span class="rb-span">the rule screens for a negative slope, so the two are not the same test</span></div>
    <div class="rb-grid two">
      ${obsCell(o.largestAbsT, "|t|")}
      ${obsCell(o.largestNegativeAbsT, "negative |t|")}
    </div>
    <p class="rb-line"><b>Read as a bound.</b> This design could have flagged a taste effect worth about <b>${nf(b.medianDeltaR2Pts)} ΔR² points</b> for the median name — ${nf(b.minDeltaR2Pts)} to ${nf(b.maxDeltaR2Pts)} across the book, depending on each name's own residual scale and market share — a partial correlation near <b>${nf(b.minPartialCorrelation, 3)}</b>. It could not have flagged anything at the scale this panel shows: the book's mean increment is ${nf(o.meanDeltaR2Pts)} pts and the largest reading in the book, ${esc(o.largestAbsT?.ticker ?? "—")} at ${nf(o.largestAbsT?.deltaR2Pts)} pts, sits at ${npc(o.largestAbsT?.shareOfMde)} of the required effect. ${o.largestAbsT && o.largestAbsT.beta > 0 ? `That reading is also a <i>positive</i> slope, so the pre-registered direction screen excludes it before multiplicity is ever reached; the closest this study came is ${esc(o.largestNegativeAbsT?.ticker ?? "—")} at ${npc(o.largestNegativeAbsT?.shareOfMde)} of the required effect.` : ""}Everything the null result is worth is worth less than what the design could see, and that is the sentence the desk owes a reader.</p>
    ${rows ? `<div class="rb-window"><span>How many weeks an effect of each size would need</span><span class="rb-span">${npc(mo.powerTarget, 0)} flag probability under the pre-registered rule${MDE.designRequirement?.postHoc ? " · post-hoc as a choice of effect size, pre-registered as a rule" : ""}</span></div>
    <div class="tw"><table class="live" data-audit="mde">
      <thead><tr><th class="th-left">Effect</th><th><span class="th">ΔR²</span></th><th><span class="th">Weeks</span></th><th><span class="th">Years</span></th><th><span class="th">× this panel</span></th><th class="th-left">How the size was chosen</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="rb-line">The effect is held fixed in ΔR² at each name's own market share of variance, so these rows are a statement about sample size only — never that a taste signal of that size would persist over the decades such a panel would span. The last row is the guard rail: asking this table to return the increment the ${mo.weeks}-week design can detect answers ${selfCheck?.weeks ?? "—"} weeks, so the table is calibrated against itself.</p>` : ""}
    ${nullArm && mdeArm ? `<p class="rb-line"><b>Checked against simulation</b> (seed ${sim.seed}, ${sim.draws?.iid ?? "—"} draws iid, ${sim.draws?.block ?? "—"} in ${sim.blockWeeks}-week circular blocks). At the published bound the analytic flag probability is ${nf(mdeArm.analytic, 3)} and the iid arm returns ${nf(mdeArm.iid, 3)}, so the formula, the quadrature and the Benjamini–Hochberg implementation agree. The block arm returns ${nf(mdeArm.block, 3)}: with dependence allowed inside a resampled block, the ordinary-least-squares standard error understates the slope's spread, and the same arm over-rejects under the null — ${nf(nullArm.block, 5)} against the nominal ${nf(nullArm.analytic, 5)}. Read the ${npc(mo.powerTarget, 0)} power claim as about ${Math.round((mdeArm.block ?? 0) * 100)}% on a dependence-preserving design; the gap is reported, not reconciled away.</p>` : ""}
    ${fs ? `<p class="rb-line"><b>And the held-out arm is not a low-power test — it is not a test.</b> ${fs.computable ? "This build reports it as computable." : `Its ${fs.weeks} scored weeks contain <b>${fs.nonzeroRegressorWeeks} weeks in which the taste regressor moves</b>: ${esc(fs.reason)}. ${esc(fs.powerAtAnyEffect ?? "")} Worked example ${esc(fs.workedExample?.ticker ?? "—")}: ${fs.workedExample?.scoredWeeks} scored weeks, ${fs.workedExample?.nonzeroWeeks} non-zero regressor weeks, basket residual sum of squares ${fs.workedExample?.basketResidualSsq}, while the same name shows ${nf(fs.workedExample?.observedInSampleDeltaR2Pts)} points in sample where the basket does move. That is a statement about the vendor's carry-forward cadence, and the arm becomes testable the moment the series moves again.`}</p>` : ""}
    <p class="rb-line"><b>Provenance.</b> <code>output/mde.json</code>, generated ${esc(MDE.generatedAt ?? "—")} from panel revision <code>${esc(s.deskRevision ?? "—")}</code> (${s.deskBytes ?? "—"} bytes, ${s.deskWindow?.weeks ?? "—"} weeks ${esc(s.deskWindow?.start ?? "—")} → ${esc(s.deskWindow?.end ?? "—")}). Integrity checks inside the file: ${s.integrity?.rebuiltDesignsMatchPublishedFit ?? "—"} rebuilt designs match the published fit, ${s.integrity?.outputSeriesCrossChecked ?? "—"} output series cross-checked, ${s.integrity?.entityRosterRows ?? "—"} roster rows read. <b>${s.qlooRequests ?? "—"} Qloo requests</b> — every input was already on disk. Post-hoc fields: ${esc((mo.postHocFields ?? []).join(", ") || "none")}.</p>
  </section>`;
}

/* ---------- does the answer depend on how the basket is built? ---------- */
// The falsification request two reviewers made in the same words. The same estimator
// on the same calendar under seven alternative baskets: what moves is the point
// estimate, and the desk prints both that and the fact that nothing gets flagged.
// A null is only worth publishing if the author can say what would end it. Each row
// is a condition, today's value against it, and who checks — three need data that
// does not exist yet, and the first is checked by the desk on every answer.
function flipBand(va) {
  const med = MDE?.book?.medianDeltaR2Pts ?? null;
  // desk.json keeps ΔR² as a fraction and mde.json in points; the band prints points,
  // so the fraction is scaled once here rather than in three format calls.
  const obs = va?.meanDeltaR2 != null ? va.meanDeltaR2 * 100 : null;
  const req = (MDE?.designRequirement?.rows ?? []).find((r) => /mean/i.test(String(r.label ?? ""))) ?? null;
  const cmp = Object.values(BASKET?.comparisons ?? {})[0] ?? null;
  const latestRevision = va?.oos?.scoring?.lastMove ?? null;
  const fresh = FRESH ?? null;
  const freshNow = fresh?.checked
    ? `last check ${String(fresh.respondedAt ?? fresh.at ?? "").slice(11, 16)}Z · ${fresh.verdict === "qloo_has_a_newer_revision" ? "REVISED" : freshestVerdict(fresh.verdict)}`
    : fresh?.why ? `not checked — ${FRESH_WHY[fresh.why] ?? fresh.why}` : "checked on every answer";
  const rows = [
    {
      n: "1",
      what: "Qloo revises a basket after the panel's last revision",
      now: latestRevision ? `no revision since ${latestRevision}` : "no revision dated",
      take: "nothing to build — the desk already asks Qloo on every answer and stamps the answer \"Qloo has moved\" when one entity reports a newer revision",
      who: `<a href="#/ask">the desk, per answer</a>`,
      state: freshNow,
    },
    {
      n: "2",
      what: "A taste effect at least as large as the design could detect",
      now: med != null && obs != null ? `detectable ${nf(med)} ΔR² pts · measured ${nf(obs)}` : "bound not on this build",
      take: med != null && obs != null ? `${nf(med / obs, 1)}× the measured effect; at the measured size the same rule needs ${nf(req?.weeks ?? null, 0) ?? "—"} weeks (${nf(req?.years ?? null, 1) ?? "—"} years)` : "run scripts/mde.mjs",
      who: "a longer panel or a larger effect",
      state: "not reachable at this vintage",
    },
    {
      n: "3",
      what: "A ranking that survives the basket it was built from",
      now: cmp ? `β moves a median ${nf(cmp.medianAbsDBeta, 1)} pts across constructions (p90 ${nf(cmp.p90AbsDBeta, 1)}, rank ρ ${nf(cmp.rankCorrSpearman, 2)})` : "sensitivity not on this build",
      take: "a name would have to clear the same tests in all four constructions; none does today, and no construction flags one",
      who: "the construction re-run, on cache",
      state: "0 of 80 under any construction",
    },
    {
      n: "4",
      what: "A flag that survives the book-wide correction",
      now: "0 of 80 names at Benjamini–Hochberg q ≤ 0.10",
      take: MDE?.book?.tCrit ? `a single-name |t| of ${nf(MDE.book.tCrit, 2)} to be a discovery at this book size, before the correction` : "a per-name t large enough to survive 80 tests",
      who: "the multiplicity rule",
      state: "none today",
    },
  ];
  return `<section class="robust full" aria-label="Falsification" data-audit="flip-band">
    <div class="rb-head"><h2>What would flip this verdict</h2>
      <p class="rb-sub">Four conditions, each with today's value. A null that cannot name the evidence that would end it is an opinion; three of these need data that does not exist yet, and the first is checked automatically, from the deployed host, on every answer.</p></div>
    <div class="flip">
      ${rows.map((r) => `<div class="fl"><div class="fl-n">${r.n}</div><div class="fl-b">
        <b>${esc(r.what)}</b>
        <span class="fl-now"><span class="fl-k">today</span>${esc(r.now)}</span>
        <span class="fl-take"><span class="fl-k">what it takes</span>${esc(r.take)}</span>
        <span class="fl-who"><span class="fl-k">checked by</span>${r.who}<span class="fl-sep"> · </span>${esc(r.state)}</span>
      </div></div>`).join("")}
    </div>
  </section>`;
}

function freshestVerdict(v) {
  return v === "newer_weeks_no_change" ? "newer weeks, no newer signal" : v === "nothing_newer_than_panel_tail" ? "nothing newer than the panel tail" : String(v ?? "no verdict").replaceAll("_", " ");
}

function basketBand() {
  if (!BASKET) {
    return `<section class="robust full" aria-label="Basket construction">
    <div class="rb-head"><h2>Does the answer depend on how the basket is built? <span class="stubtag">not computed</span></h2>
      <p class="rb-sub">The sensitivity re-run is not on this build: <code>/api/basket-sensitivity.json</code> served no file. <code>node scripts/basket-sensitivity.mjs</code> re-runs the identical estimator on the cached responses and makes zero Qloo requests.</p></div>
  </section>`;
  }
  const g = BASKET.gate ?? {};
  const cov = BASKET.coverage ?? {};
  const cmp = BASKET.comparisons ?? {};
  const consts = BASKET.constructions ?? [];
  const label = (id) => consts.find((c) => c.id === id)?.label ?? id;
  const screen = Object.entries(cmp).flatMap(([id, v]) => (v.screenPassesBeforeBH ?? []).map((x) => ({ ...x, id })));
  const best = screen.length ? Math.min(...screen.map((x) => x.q)) : null;
  const clears = [...new Set(screen.map((x) => x.ticker))];
  const cell = (k, v, sub, tone = "") => `<div class="rb-test"><div class="rb-k">${k}</div><div class="rb-v ${tone}">${v}</div>${sub ? `<div class="rb-se">${sub}</div>` : ""}</div>`;
  const rows = Object.entries(cmp).map(([id, v]) => `<tr>
      <td class="th-left" data-l="Construction">${esc(v.label ?? label(id))}</td>
      <td class="num" data-l="Fitted">${v.compared ?? cov[id]?.fitted ?? "—"}</td>
      <td class="num" data-l="Degenerate">${cov[id]?.degenerate ?? 0}</td>
      <td class="num" data-l="Median |Δβ|">${nf(v.medianAbsDBeta)}</td>
      <td class="num" data-l="p90 |Δβ|">${nf(v.p90AbsDBeta)}</td>
      <td class="num" data-l="Median |Δt|">${nf(v.medianAbsDT, 3)}</td>
      <td class="num" data-l="Max |Δt|">${nf(v.maxAbsDT, 3)}</td>
      <td class="num" data-l="Spearman ρ">${nf(v.rankCorrSpearman, 3)}</td>
      <td class="th-left" data-l="Clears the screen">${(v.screenPassesBeforeBH ?? []).length ? (v.screenPassesBeforeBH ?? []).map((x) => `${esc(x.ticker)} t ${nf(x.t, 2)}, q ${nf(x.q, 2)}`).join(" · ") : "none"}</td>
      <td class="num" data-l="Flagged after BH">${(v.flaggedVariant ?? []).length}</td>
    </tr>`).join("");
  const biggest = (BASKET.perName ?? []).reduce((a, r) => (Math.abs(r.committedBeta ?? 0) > Math.abs(a?.committedBeta ?? 0) ? r : a), null);
  const flips = (BASKET.totals?.flipsAcrossAllVariants ?? []).length;
  return `<section class="robust full" aria-label="Basket construction">
    <div class="rb-head"><h2>Does the answer depend on how the basket is built?</h2>
      <p class="rb-sub">${esc(BASKET.note ?? "")} The request two reviewers made in the same words was whether the basket's construction decides the result, so the identical estimator was re-run on the identical ${BASKET.window?.weeks ?? "—"}-week cut calendar (${esc(BASKET.window?.start ?? "")} → ${esc(BASKET.window?.end ?? "—")}, revision weeks ${esc((BASKET.window?.revisionWeeksCut ?? []).join(", "))}) against the identical committed prices, under ${consts.length} constructions — the committed one and ${Object.keys(cmp).length} alternatives — with Benjamini–Hochberg <b>recomputed inside each variant's own fitted family</b> rather than reused from the published table.</p></div>
    <div class="rb-grid four">
      ${cell("Rebuild check", g.reproduced ? "reproduces" : "does not reproduce", `${g.namesChecked ?? "—"} names re-fit from the cached responses: max |Δβ| ${g.maxAbsDBetaVsDesk ?? "—"} and max |Δt| ${g.maxAbsDTVsDesk ?? "—"} against the published panel — so what follows compares constructions, not implementations.`, g.reproduced ? "good" : "bad")}
      ${cell("Names flagged under any construction", BASKET.totals?.someConstructionFlagsAName ? "≥ 1" : "0", `${esc(BASKET.flagRule?.method ?? "")} · flag flips against the committed flag set: ${flips}`, BASKET.totals?.someConstructionFlagsAName ? "bad" : "good")}
      ${cell("Changing the weighting", `${nf(cmp.equalWeights?.medianAbsDBeta, 3)} pts`, `median |Δβ| when the committed members take equal weight instead of Qloo's affinity rank · Spearman ρ of the book's betas ${nf(cmp.equalWeights?.rankCorrSpearman, 3)} — the same answer with different furniture`)}
      ${cell("Shortening the basket", `${nf(cmp.seeds3?.medianAbsDBeta)} pts`, `median |Δβ| for a 3-member basket · Spearman ρ ${nf(cmp.seeds3?.rankCorrSpearman, 2)} — here the per-name number is a property of its basket, not of the ticker`)}
    </div>
    <div class="rb-window"><span>Every construction against the committed one</span><span class="rb-span">${BASKET.perName?.length ?? "—"} priced names · ${BASKET.window?.weeks ?? "—"} weeks</span></div>
    <div class="tw"><table class="live" data-audit="basket">
      <thead><tr><th class="th-left">Construction</th><th><span class="th">Fitted</span></th><th><span class="th">Degenerate</span></th><th><span class="th">Median |Δβ|</span></th><th><span class="th">p90 |Δβ|</span></th><th><span class="th">Median |Δt|</span></th><th><span class="th">Max |Δt|</span></th><th><span class="th">Spearman ρ</span></th><th class="th-left">Clears β&lt;0, |t|≥2</th><th><span class="th">Flagged after BH</span></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="rb-line"><b>Both are true, and both are printed.</b> The <i>inference</i> is construction-insensitive: no basket the cached Qloo responses support flags a name, so the null is a property of the data rather than of the committed 8-member affinity-weighted choice. The <i>magnitudes</i> are not: a per-name cultural beta changes with the basket that priced it${biggest ? ` — the largest committed reading in the book, ${esc(biggest.ticker)} at ${nf(biggest.committedBeta)}, reads ${nf(biggest.seeds5?.beta)} under a 5-member basket and ${nf(biggest.seeds3?.beta)} under a 3-member one` : ""}. ${clears.length ? `Across all ${Object.keys(cmp).length} alternatives the only names that ever reach β &lt; 0 with |t| ≥ ${BASKET.flagRule?.absT ?? "2"} are ${clears.map((t) => esc(t)).join(", ")}, and the best q any of them gets is <b>${nf(best, 2)}</b> against a ${BASKET.flagRule?.qMax ?? "0.1"} ceiling — single draws from an ${cov.baseline?.fitted ?? "80"}-name family that look exactly like what the correction exists to discard.` : ""} ${cov.brandsOnly?.degenerate ? `The brands-only arm carries the sharpest caveat: it fits ${cov.brandsOnly.fitted} of ${cov.baseline?.fitted ?? "the"} names, and for its ${cov.brandsOnly.degenerate} degenerate rows the brand-only basket is constant across the window, so the slope is not identified and <b>no beta is printed</b> for them — a different construction there is not a different answer, it is no answer.` : ""}</p>
    <p class="rb-line">What that means for how to read a row: the finding is stated at the level of the test — nothing in this book separates from chance under any basket we can re-derive — and never as ${BASKET.perName?.length ?? "80"} independent ticker-level exposures. The basket choice decides what a beta <i>is</i>; it does not decide what is <i>significant</i>.</p>
    <p class="rb-line"><b>Provenance.</b> <code>output/basket-sensitivity.json</code> · ${BASKET.provenance?.qlooRequestsMade ?? "—"} Qloo requests, built from ${BASKET.provenance?.cacheFilesRead?.length ?? "—"} cached response files under <code>fixtures/qloo/</code> · ${esc(BASKET.provenance?.method ?? "")}</p>
  </section>`;
}

/* ---------- the same two analyses, in plain English ---------- */
// The read page states them as sentences; the evidence page carries the tables and
// the provenance. Both read the committed JSON, so a missing file says so here too.
function mdeProse() {
  if (!MDE) return `<p>The detectability bound is not computed on this build. <code>node scripts/mde.mjs</code> re-derives it from the committed panel and the cached responses — no Qloo request — and the desk prints it whenever the file is present.</p>`;
  const b = MDE.book ?? {};
  const o = b.observed ?? {};
  const mo = MDE.method ?? {};
  const req = MDE.designRequirement?.rows ?? [];
  const near = (v) => (req.find((r) => Math.abs((r.deltaR2Pts ?? 1e9) - v) < 0.01) ?? null);
  const bookRow = near(o.meanDeltaR2Pts);
  const topRow = near(o.largestAbsT?.deltaR2Pts);
  return `<p><b>Could this study have found a taste effect at all?</b> The desk prints ${o.flaggedNames ?? "0"} of ${b.names ?? "the"} names flagged, and that number only means something beside the size of effect the study <i>could</i> have flagged. On this design — ${mo.weeks ?? "102"} weeks, each name's own residual scale, its own basket's own variance, and the pre-registered rule (negative β, |t| ≥ ${mo.flagRule?.absT ?? 2}, Benjamini–Hochberg q ≤ ${mo.flagRule?.qMax ?? 0.1}) — a name needs an increment of about <b>${nf(b.medianDeltaR2Pts)} points of R²</b>, a partial correlation near <b>${nf(b.minPartialCorrelation, 3)}</b>, before the rule fires ${npc(mo.powerTarget, 0)} of the time. The book's mean increment is <b>${nf(o.meanDeltaR2Pts)} points</b>, and the largest single reading in the whole book — ${esc(o.largestAbsT?.ticker ?? "—")} at ${nf(o.largestAbsT?.deltaR2Pts)} points — is <b>${npc(o.largestAbsT?.shareOfMde)}</b> of the required size and would have been caught only <b>${npc(o.largestAbsT?.powerAtObserved)}</b> of the time even if it were exactly true. ${topRow ? `An effect that size would need about ${topRow.weeks} weeks (${topRow.years} years) to be flagged reliably; this panel has ${mo.weeks ?? 102}.` : ""}${bookRow ? ` An effect the size the average name actually displays would need roughly ${bookRow.weeks.toLocaleString("en-US")} weeks — ${bookRow.years} years, ${bookRow.multipleOfCurrentPanel}× the window in hand.` : ""} So "no names flagged" is a statement about what this design could see, and the design was not built to see anything at this scale. The bound is a property of the design, not of the readings: it uses no observed t-statistic, which is why it can be published beside a null instead of being chosen by it.${MDE.frozenSlice && MDE.frozenSlice.computable === false ? ` The held-out arm is a separate and worse case: its taste regressor moves in ${MDE.frozenSlice.nonzeroRegressorWeeks} of ${MDE.frozenSlice.weeks} scored weeks, so it is not a weak test — it is not a test.` : ""} Checked against simulation at seed ${MDE.simulation?.seed ?? "—"}: the analytic claim reproduces on independent errors and reads lower when dependence inside a block is preserved, and the desk prints both numbers.</p>`;
}

function basketProse() {
  if (!BASKET) return `<p>The basket-construction sensitivity is not computed on this build. <code>node scripts/basket-sensitivity.mjs</code> re-runs the identical estimator on the cached responses — no Qloo request — and prints it whenever the file is present.</p>`;
  const c = BASKET.comparisons ?? {};
  const cov = BASKET.coverage ?? {};
  const t = BASKET.totals ?? {};
  return `<p><b>Does the answer depend on which brands went into the basket?</b> Two reviewers asked for exactly this, so the desk re-ran the identical estimator on the identical ${BASKET.window?.weeks ?? 102}-week calendar against the identical prices, under ${Object.keys(c).length} alternative baskets — 3, 5, 7 and 10 members by affinity, equal weights instead of Qloo's affinity ranks, brands only, and one leave-the-heaviest-member-out jackknife — recomputing the multiplicity correction inside each variant's own family. The rebuild gate first reproduces the published panel exactly (${BASKET.gate?.namesChecked ?? "—"} names, max |Δβ| ${BASKET.gate?.maxAbsDBetaVsDesk ?? "—"}), so this is a comparison of constructions rather than of implementations. The answer splits in two, and both are printed. The <i>verdict</i> does not move: no construction flags a name${t.someConstructionFlagsAName ? "" : " — the flagged set is empty under every one of them"} — so the null is a property of the data, not of the committed 8-member affinity-weighted choice. The <i>magnitudes</i> do: re-weighting the same members moves the median name's beta by ${nf(c.equalWeights?.medianAbsDBeta, 3)} units and leaves the book's ranking essentially unchanged (rank correlation ${nf(c.equalWeights?.rankCorrSpearman, 3)}), while a 3-member basket moves it by ${nf(c.seeds3?.medianAbsDBeta)} units and leaves the ranking nearly uncorrelated with the committed table (${nf(c.seeds3?.rankCorrSpearman, 2)}).${cov.brandsOnly?.degenerate ? ` A brands-only basket is the limit case: ${cov.brandsOnly.fitted} of ${cov.baseline?.fitted ?? "the"} names still price, and for the other ${cov.brandsOnly.degenerate} the regressor never moves, so no beta is printed at all rather than a spurious one.` : ""} Read a per-name cultural beta as a reading against a stated basket; read the desk's finding — nothing clears q ≤ ${BASKET.flagRule?.qMax ?? "0.1"} under any basket the cached Qloo responses support — as the result.</p>`;
}

/* ---------- cost, printed as the number it is ---------- */
function costBand(va) {
  const p = BUDGET?.planned;
  if (!p?.lines?.length) return "";
  const sp = BUDGET?.spent;
  const n = (x) => (x === null || x === undefined ? "—" : Number(x).toLocaleString("en-US"));
  const tasteP = va?.placebo?.p ?? null;
  const permP = va?.permutation ? Math.max(va.permutation.p, va.permutation.pBlocked ?? -Infinity) : null;
  const peerP = va?.ablation?.oos?.placebo?.p ?? null;
  const cell = (k, v, sub) => `<div class="rb-test"><div class="rb-k">${k}</div><div class="rb-v">${v}</div>${sub ? `<div class="rb-se">${sub}</div>` : ""}</div>`;
  return `<section class="robust full" aria-label="Run cost">
    <div class="rb-head"><h2>What the taste arm costs, beside what the control costs</h2>
      <p class="rb-sub">Calling this the only instrument of its kind is a claim about spend, so it is printed as one. Every number here is derived from the same paging rules the runner uses — 20 weekly points per request, one request per basket member per window across the whole 213-week pull — not estimated by hand.</p></div>
    <div class="rb-grid four">
      ${cell("Taste arm", `${n(p.total)} requests`, sp ? `the run behind this panel spent ${n(sp.total)}` : "upper bound, until the baskets say how many members are shared")}
      ${cell("Peer control", "0 requests", "the same-sector basket is built from prices the desk already holds")}
      ${cell("Taste rotation null", tasteP === null ? "—" : `p ${tasteP.toFixed(3)}`, `${va?.placebo?.draws ?? 400} rotations of the factor, against the market`)}
      ${cell("Date permutation null", permP === null ? "—" : `p ${permP.toFixed(3)}`, `${va?.permutation?.draws ?? 400} shared shuffles of the week order — same spread, no timing${va?.permutation?.pBlocked != null ? ` · week-by-week p ${va.permutation.p.toFixed(3)}, in ${va.permutation.blockWeeks}-week blocks (which respect the refresh cadence) p ${va.permutation.pBlocked.toFixed(3)}; the stricter is used` : ""}`)}
      ${cell("Peer rotation null", peerP === null ? "—" : `p ${peerP.toFixed(3)}`, "the same basket scored against its own sector")}
    </div>
    <p class="rb-line">At about ${n(p.estimatedMinutes)} minutes of sequential calls the taste arm is a scheduled job, not a page load — which is why the expensive step prints its exact count and refuses to spend it until that count is confirmed, and why the button on this desk rebuilds from responses already paid for.</p>
  </section>`;
}

/* ---------- what the culture side costs ---------- */
function budgetBlock() {
  const p = BUDGET?.planned, sp = BUDGET?.spent;
  if (!p?.lines?.length) return `<p class="muted">The cost of a run is derived from the same paging rules the runner uses, so it is a number rather than an impression. It is not on this page right now.</p>`;
  const n = (x) => (x === null || x === undefined ? "—" : Number(x).toLocaleString("en-US"));
  const rows = p.lines.map((l) => `<li><b>${n(l.calls)}</b> — ${l.label.toLowerCase()}. ${l.note}</li>`).join("");
  return `<div id="run-cost">
    <p>The culture half of this desk is bought; the control half is free. A run costs <b>${n(p.total)} requests</b> as planned${p.trends?.exact ? "" : " (an upper bound: it assumes no basket member is shared between sub-sectors, and the exact count is printed and confirmed before the expensive step spends it)"}. The same-sector peer basket the ablation runs against costs <b>0</b> — it is built from the prices the desk already fetches, which is the point of the control.</p>
    <ul class="limits">${rows}</ul>
    <p>${sp
      ? `The run behind this panel spent <b>${n(sp.total)}</b> — ${n(sp.search)} to map names, ${n(sp.baskets)} for the baskets, ${n(sp.trends)} for ${n(sp.trendCalls)} trend calls. At about ${n(p.estimatedMinutes)} minutes of sequential calls, it is a scheduled job, not a page load.`
      : `Nothing has been spent yet: this panel is running on the market-only arm, and the ${n(p.total)} calls are the price of turning the taste arm on.`}</p>
    <p class="muted">The button on this desk re-derives the panel from responses already paid for. It never spends Qloo requests because a visitor pressed it.</p>
  </div>`;
}

/* ---------- plain-English read ---------- */
function readView() {
  const ok = DESK ? DESK.rows.filter((r) => r.status === "ok") : [];
  const flagged = ok.filter((r) => r.flagged).length;
  const va = DESK?.valueAdd;
  const uni = DESK?.universe;
  const num = (v) => v == null ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + " pts";
  const bare = (v) => v == null ? "—" : (v * 100).toFixed(1) + " pts";
  return `<div class="head">
    <div class="lede-col">
      <h1>How to <em>read</em> this desk.</h1>
      <p class="sub">Plain English, no statistics degree assumed. The same numbers, in the words a reader would use.</p>
    </div>
    <div class="side">${DESK ? windowPill(DESK.window) : ""}</div>
  </div>
  <section class="card prose">
    <h2>What the two numbers are</h2>
    <p><b>Market beta</b> is the number a terminal already shows: how much a stock moves when the stock market moves. A beta of 1.2 means the stock tends to move 1.2% for every 1% the S&amp;P 500 moves.</p>
    <p><b>Cultural beta</b> is this desk's number. Every consumer name sits in a sub-sector — beauty, restaurants, travel — and each sub-sector has a <i>taste basket</i>: the brands, films, artists and shows its audience is trending toward, taken from Qloo. Cultural beta asks how much a stock moves when that basket moves, after the market is accounted for.</p>
    <h2>Why that is a risk number</h2>
    <p>If a stock falls when its customers' taste moves away from its category, that is a risk a market beta does not measurably report in this sample — which is the hypothesis, not the result. A positive cultural beta means the stock moves with taste; <b>negative</b> means taste is a headwind. Whether that risk is <i>measurable</i> is a separate question, and it is the one this desk answers with numbers rather than with the story above: on this book no sign is separable from chance in sample, and the held-out slice cannot test it at the data vintage this pull carries — the reason is below, not hidden.</p>
    <h2>What the tests are for</h2>
    <p>Curve-fitting is easy, so each claim on this desk comes with the check that could break it. Each is a computation with a printed verdict rather than a caveat. <b>Out of sample</b>: fit on the first part of the window, grade it on the part the fit never saw. <b>Placebo</b>: rotate the baskets against returns ${va?.placebo?.draws ?? 400} times and ask how often chance does as well. The rotation shifts every name together, so the null keeps the book's correlation structure — it is a test against a rotation of the factor, not against random baskets. A second null shuffles the week order instead — week by week, and again in six-week blocks that respect the refresh cadence — and a positive claim has to clear every one of them: the friendliest p of the set is never used alone. That is a <b>max-of-p rule</b>, conservative on purpose: the nulls are correlated, so clearing all of them is a stricter bar than clearing any one — a choice, not a neutral test. ${va?.secondary
      ? `<b>Second window</b>: the same test again on ${va.secondary.window.weeks} weeks before the window (${esc(va.secondary.window.start)} → ${esc(va.secondary.window.end)}), fixed in advance. That is an earlier market regime, not an identical-conditions repeat: replicating across the two is the stronger claim, and a miss can be a regime difference.`
      : DESK?.valueAdd?.secondarySkip
        ? `<b>Second window</b>: a ${DESK?.priorWindow?.weeks ?? 106}-week window was fixed in config/book.json before any keyed run, but it could not be priced — ${esc(DESK.valueAdd.secondarySkip)} — so the desk reports it as untestable and neither claims nor invents a replication.`
        : `<b>Second window</b>: the same test again on ${DESK?.priorWindow?.weeks ?? 106} weeks before the window, fixed in advance. That is an earlier market regime, not an identical-conditions repeat.`}</p>
    ${(() => {
      const sc = va?.oos?.scoring;
      if (!sc || sc.testable !== false) return "";
      const c = va?.oos?.cadence;
      return `<h2>What the held-out test can and cannot see</h2>
    <p>This matters enough to have its own section. The out-of-sample cell fits on the first ${va.oos.trainWeeks} weeks and scores the last ${va.oos.testWeeks}. In this Qloo pull every entity's percentile last moves in the week ending <b>${esc(sc.lastMove ?? "—")}</b>: the final ${sc.frozenAfterWindow} weeks of the window are a carry-forward, with a weekly log change of exactly zero for every name. <b>All ${sc.testWeeks} scored weeks</b> sit in that tail. Adding a regressor that is zero multiplies its coefficient by zero in every scored week, so that cell would have found a taste effect of <i>no size at all</i> — it is not a weak test, it is an empty one, and the desk marks it “no test” rather than letting a near-zero number pass for a negative result.</p>
    <p>The pre-registered split is unchanged. What changed is that the product now says what the split can do. A held-out test is only possible where the data moves: moving the split inside the revised part of the window (${esc(c.start)} → ${esc(c.end)}, ${c.trainWeeks} train / ${c.testWeeks} test, ${c.activeMedian} moving weeks in the test slice) gives a median ΔR² of <b>${ptsSigned(c.median)}</b>, positive on <b>${Math.round(c.sharePositive * 100)}%</b> of names. Its mean (${ptsSigned(c.mean)}) is dominated by a few names with almost no variance inside the scored weeks, which is why the desk prints the median and the share rather than the mean. <b>Read that paragraph as a diagnostic, not as the desk's finding.</b> The split was chosen after the pre-registered one turned out to have no power, so it cannot stand in for that test, cannot upgrade the grade, and is not evidence that taste works — a test placed where the data moves will always be able to run. It is printed because a reader should see the best held-out reading the data allows; labelling it is more honest than omitting it.</p>`;
    })()}
    <h2>Does Qloo add anything the sector already shows?</h2>
    <p>The control is a <b>peer basket</b>: the average weekly return of the other stocks in the same sub-sector, with no Qloo data at all. If that alone explains what the taste basket explains, the instrument is not doing the work. The reading is deliberately narrow: peers carry the same taste exposure, so the peer basket absorbs the part of taste the sector already prices, and what is left is the share Qloo adds that a vendor-free peer basket cannot — the non-overlapping layer, not a bound on any causal total. ${(() => {
      const abO = va?.ablation?.oos;
      if (!abO) return "The ablation is not computed on this build.";
      const frozenAb = va?.ablation?.scoring ? va.ablation.scoring.testable === false : false;
      return frozenAb
        ? `On the held-out tail the cell reads ${bare(abO.meanTasteExtraR2)} and is positive on <b>${Math.round(abO.sharePositive * 100)}%</b> of names — but those weeks are frozen for every name, so that is the training coefficients' perturbation on a zero regressor, not a measured gain over the peer control. The rule is applied the same way in every direction: any arm whose scored slice is frozen is called a perturbation, the taste arm, this peer control and the sentiment control alike.`
        : `Today taste adds ${bare(abO.meanTasteExtraR2)} of r² on weeks it never saw, and beats the peer control on <b>${Math.round(abO.sharePositive * 100)}%</b> of names.`;
    })()} The desk prints the loss as readily as the gain.${va?.ablation?.qlooVsPeer ? ` The two regressors are not near-copies: the correlation between the taste basket and its peer basket averages <b>${va.ablation.qlooVsPeer.meanCorr.toFixed(2)}</b>, and the taste basket moves in ${va.ablation.qlooVsPeer.meanActive.toFixed(0)} of ${va.ablation.qlooVsPeer.weeks} weeks while the peer basket moves every week — so a null ablation means Qloo's distinct information did not add, not that Qloo reproduced the sector average.` : ""}</p>
    <p>There are two different questions here, and the desk uses a separate rotation test for each. <b>Is the basket aligned with returns at all?</b> Rotate it 400 times and see how often a rotation does as well — that p is the placebo cell in the robustness band. <b>Does that alignment survive the sector?</b> The same rotations are scored against the peer models, and that second p is printed under the ablation cell. A basket can be aligned and still not additive: the sector average already reflects the taste its audience shares. The first p being small and the second cell being negative is a coherent, reportable result, and the desk says exactly that rather than letting one number stand in for the other.</p>
    <h2>Could this just be consumer confidence?</h2>
    <p>A cultural factor built from searches and streams can be a lagging confidence proxy: people buy more of everything when they feel good about the economy. The desk answers with a control, not a sentence. The taste basket has to add over the S&amp;P 500 <i>and</i> the University of Michigan Index of Consumer Sentiment — a published, monthly index from FRED, carried as its month-over-month change on the weeks inside each month, and the desk says out loud that this is coarse. Today taste adds ${va?.sentiment ? bare(va.sentiment.oos.meanTasteExtraR2) + " of r²" : "—"} once sentiment is in the model${va?.sentiment?.oos?.ci90 ? `, 90% CI ${bare(va.sentiment.oos.ci90[0])} → ${bare(va.sentiment.oos.ci90[1])}` : ""}, and the average basket correlates with that sentiment change at <b>${va?.sentiment?.meanCorr == null ? "—" : va.sentiment.meanCorr.toFixed(2)}</b>. A correlation near zero is the evidence that "cultural" is not just a nicer word for "confident"; a correlation near one would say the reverse, and the desk would say so.</p>
    <h2>Why two ways of fitting the same data?</h2>
    <p>A per-name slope spends ${va?.pooled?.weeks ?? 102} weeks of data on a basket that moves in about ${DESK?.factorSparsity?.medianActive ?? 29} of them, so the estimate is wide and the sign can be large. The desk therefore also reads the same data <b>pooled</b>: name fixed effects swept out, one market slope for the book, one cultural slope per sub-sector, errors clustered by week because every name shares a calendar. ${va?.pooled ? `On this book the pooled within-ΔR² is ${bare(va.pooled.deltaR2)}, the date-permutation null reads p ${pval(va.pooled.null.p)}, and the sub-sector with the largest |t| is ${(() => { const s = va.pooled.sectors.reduce((a, b) => (Math.abs(b.t) > Math.abs(a.t) ? b : a)); return `${esc(s.id)} at ${s.beta.toFixed(2)} (t ${s.t.toFixed(2)})`; })()}.` : ""} The pooled reading was added after an external review rather than pre-registered, and it is labelled that way wherever it appears. It answers a <b>different estimand</b> from the per-name table: one slope per sub-sector is a statement about the sub-sector, and it cannot confirm or refute a claim about an individual name — a flat sector slope and two names moving in opposite directions are perfectly compatible. ${va?.pooledNameMarket ? `The pooling also forces one market slope on every name, which an external reviewer pointed out could manufacture the answer; that restriction is removed in a second arm, where each name keeps its own market loading, and the within-ΔR² comes out the same (${bare(va.pooledNameMarket.deltaR2)}, permutation p ${pval(va.pooledNameMarket.null.p)}). The loadings themselves span ${va.pooledNameMarket.market.min.toFixed(2)} to ${va.pooledNameMarket.market.max.toFixed(2)}, so the restriction was real; it just was not what produced the null.` : ""} It is reported for the same reason as everything else here: if it had disagreed with the per-name table, that disagreement would be the most interesting number on the page.</p>
    <h2>Are the names actually different from each other?</h2>
    <p>A near-zero average beta has two very different readings. Either every name has roughly the same cultural exposure and the per-name column is noise, or names genuinely pull in opposite directions — some hedges, some headwinds — and the mean cancels while the spread does not. The second reading is the one that would make a per-name desk worth having, so it is tested rather than assumed: the spread of the ${va?.dispersion?.names ?? 80} per-name cultural betas is compared with what estimation noise alone would produce, calibrated by rotating each name's basket <b>independently</b> — every basket keeps its own shape and loses only its timing, which leaves noise in place and removes any name-specific signal. ${va?.dispersion ? `On this book the spread across names is ${va.dispersion.variance.toFixed(0)} against ${va.dispersion.samplingVariance.toFixed(0)} from noise alone, the independent-rotation null averages ${va.dispersion.nullMean.toFixed(0)} and reads p ${pval(va.dispersion.p)} in the upper tail and ${pval(va.dispersion.pLow)} in the lower — ${va.dispersion.readsAs === "excess-dispersion" ? "the names genuinely differ" : va.dispersion.readsAs === "no-dispersion" ? "the spread is <b>smaller</b> than noise, the signature of one number plus scatter" : va.dispersion.readsAs === "uninformative" ? "no excess dispersion is detected, and — as the calibration below shows — this window cannot turn that into a finding" : "the spread is <b>no larger</b> than noise"}. The two noise benchmarks are ${Math.abs((va.dispersion.benchmarkGap ?? 0) * 100).toFixed(0)}% apart, and the null settles which one to use: inside its own draws the analytic figure overshoots the cross-sectional variance by ${Math.abs((va.dispersion.gapInNull ?? 0) * 100).toFixed(0)}%, and that gap has two candidate channels the null cannot separate: eighty marginal variances treated as if the names were independent, and a shared calendar, common shocks or correlated residuals that make the cross-section move together. Every p here is read against the rotation null, which carries both. But no dispersion being detected is not the same as there being none, so the reading is keyed to a disclosed power curve: planting known spreads of ${(va.dispersion.power ?? []).map((r) => r.sd).join(", ")} and re-running the test gives detection rates of ${(va.dispersion.power ?? []).map((r) => Math.round(r.power * 100) + "%").join(", ")}, against a pre-specified 80% bar. ${va.dispersion.detectable ? `It only reaches usable power at a spread of about ${va.dispersion.detectable.sd}, which is larger than anything this book could plausibly contain — so the test is <b>uninformative</b> here rather than a refutation of heterogeneity, and it is printed as such. The consequence is direct: this book cannot detect a taste exposure of any size a portfolio would act on, so read the per-name column as a number with its error, not as a ranking of which names carry more cultural risk.` : "It never reaches usable power, so the test is uninformative here rather than a refutation of heterogeneity — this book cannot detect a taste exposure of any practical size, and the per-name column is a reading with its error rather than a ranking."} If the power curve is read at the spread the book actually shows rather than at a plant, the answer is <b>${va.dispersion.powerObserved == null ? "—" : Math.round(va.dispersion.powerObserved * 100) + "%"}</b>: that is how often this test would find a genuine spread this size, and at zero the non-detection carries no information either way. That is the honest limit of the per-name column: it is a reading with its error, not evidence that beauty and restaurants respond to taste differently.` : "The test is not computed on this build."}</p>
    ${mdeProse()}
    ${basketProse()}
    <h2>How sure are these numbers?</h2>
    ${(() => {
      const sc = va?.oos?.scoring;
      const bound = va?.oos?.refit?.ci90 ? Math.max(Math.abs(va.oos.refit.ci90[0]), Math.abs(va.oos.refit.ci90[1])) * 100 : null;
      if (sc && sc.testable === false) {
        return `<p>Every per-name number carries an interval, and the book-level one that has a real bound is the in-sample fit: the basket moves in ${DESK?.factorSparsity?.minActive ?? 19}–${DESK?.factorSparsity?.maxActive ?? 31} of ${DESK?.factorSparsity?.weeks ?? 102} weeks per name, so each slope is estimated from a handful of moves and the per-row ± is large. That is why a zero flag count is a statement about this book, not about taste.</p>
      <p>The held-out number cannot carry an effect size at all. Qloo's taste series last moved in the week ending ${esc(sc.lastMove ?? "—")}, the final ${sc.frozenAfterWindow} weeks of the window are constant for every name, and all ${sc.testWeeks} scored weeks fall inside them. A coefficient times a zero regressor is zero, so the held-out cell's power against a true taste effect of any size is its size — no larger window at this data vintage would change that, and no interval printed on those weeks is a confidence interval for a taste effect. The desk prints the two intervals anyway, because removing them would hide how the cell is built; the refit one is the wider (effect sizes up to ${bound === null ? "a few" : bound.toFixed(1)} pts a side), and the page says at the cell that it is the fit's perturbation, not a test. What the book does have is the in-sample evidence and three nulls that all match the real alignment: that is a null result about a readable signal, not a demonstration of absence.</p>`;
      }
      return `<p>Every headline number carries an interval, not just a point. <b>And every verdict carries the effect size it could not have missed.</b> The out-of-sample interval on this book runs ${va?.oos?.refit?.ci90 ? `${bare(va.oos.refit.ci90[0])} → ${bare(va.oos.refit.ci90[1])}` : "wide of zero"}, which means the window would not have distinguished taste from chance even if taste were worth ${bound === null ? "a few" : bound.toFixed(1)} points of r². NO SIGNAL therefore means "no detectable sign at this length", never "the factor does not exist". The desk re-draws the test weeks ${va?.oos?.draws ?? 400} times in blocks, re-scores the same fitted model each time, and reports a 90% range — so a gain of ${va?.oos ? num(va.oos.meanDeltaR2) : "a few points"} on this sample is stated with the range it would still have on a different 35 weeks. A second range redraws the same weeks <i>and</i> refits the model inside each draw, so the uncertainty in the coefficients is in it too. The two disagree, and when they do the desk grades on the <b>wider one</b> — the refit range — because holding the coefficients still understates their error. That wider range does not "carry a claim" in the sense of supporting one: it <b>bounds the effect sizes this window can exclude</b>, and when it crosses zero the bound it leaves is a large one, which is little. The desk prints which range the grade used at the number, not only here.</p>`;
    })()}
    <h2>How strong the claim is</h2>
    <p>${(() => {
      const sc = va?.oos?.scoring;
      const n = uni?.priced ?? va?.holdings ?? 101;
      if (sc && sc.testable === false) {
        return `With ${va.oos.testWeeks} scored weeks, one name's ΔR² would be a coarse number even if those weeks moved — and they do not, so the desk makes <b>no held-out claim</b> on this vintage, and claims no point-estimate precision at the name level. What it claims is narrower and checkable: across ${n} names the in-sample association is stated with its interval, the nulls match the real alignment, and the held-out condition is printed as untestable rather than as a negative. A single row is a reading with its error, not a signal.`;
      }
      return `With ${va?.oos?.testWeeks ?? 35} held-out weeks, one name's ΔR² is a coarse number, and the desk does not claim point-estimate precision at the name level. The claim it does make is a book-level one: across ${n} names, taste adds a measured amount on average, on a stated share of names, and the same test repeats on a window fixed before the run. A single row is a reading with its interval, not a signal.`;
    })()}</p>
    <h2>What would prove this wrong</h2>
    <p>Four results would falsify the desk, and each is a computation with a printed verdict rather than a paragraph of caveats:</p>
    <ul class="limits">
      <li><b>No flag survives the book.</b> Every cultural beta fails Benjamini–Hochberg at q ≤ 0.10, so nothing clears the correction; the landing page says how many names flagged, and zero is a printed answer.</li>
      <li><b>Taste adds nothing over the sector.</b> The ablation cell reads negative with both intervals crossing zero: the peer basket already carries the channel and Qloo's marginal value over a vendor-free control is nil.</li>
      <li><b>The peer control wins in both windows.</b> The ablation is run on the primary window and again on the pre-registered second window; if taste loses to peers on both, the claim that Qloo is the only clean instrument for taste risk is not established — the sector average is.</li>
      <li><b>It does not replicate.</b> The pre-registered second window's mean ΔR² is at or below zero, so the primary reading is a property of one window rather than of the factor.</li>
    </ul>
    <p>Each is generated from the numbers by the code, not typed by hand: the flag is <code>verdictOf()</code> on the desk, the ablation cell comes from the same fit that prints its intervals, and the replication sentence is the pipeline's <code>replicates</code> field. A negative result changes what the page says, not whether it renders.</p>
    <h2>What this is worth if the answer is no</h2>
    <p>If taste adds nothing beyond the sector, the result is still a finding: a pre-registered falsification memo — estimator, two intervals, the peer control and the replication verdict, in a form a research desk can cite — and the desk prints it as the landed branch rather than dressing the peer basket up as a product. The buyer for that is a factor researcher or a buy-side quant who wants a pre-registered test of a culture-channel hypothesis; the cost is a Qloo subscription plus the desk's compute, and the data stays private under Qloo's terms while the method and the verdict are publishable. There is no mass-market buyer for this, and the entry does not pretend there is one.</p>
    <h2>What a flag means — and does not</h2>
    <p>${(() => {
      const sc = va?.oos?.scoring;
      const head = `Currently <b>${flagged} of ${ok.length}</b> names ${flagged === 1 ? "carries" : "carry"} a flag: negative cultural beta, statistically clear, and corrected for testing ${ok.length} names at once.`;
      if (sc && sc.testable === false) {
        return `${head} A flag would also have to hold out of sample — and at this data vintage the scored weeks are frozen, so the flag count is structurally zero here rather than a clean screen. A flag, where one is possible, is a name where taste is a measurable headwind. It is <b>not</b> advice to trade, short or hedge — this desk measures exposure only.`;
      }
      return `${head} It also held out of sample. A flag is a name where taste is a measurable headwind. It is <b>not</b> advice to trade, short or hedge — this desk measures exposure only.`;
    })()}</p>
    <h2>What the taste arm costs to run</h2>
    ${budgetBlock()}
    <h2>Where the numbers come from</h2>
    <p>Any row opens its own evidence: the Qloo request, the cached response, and the exact window. The book's average taste gain is ${va ? num(va.meanDeltaR2) + " of r²" : "—"}; the replication verdict is on the Desk and Evidence pages, printed as computed.</p>
  </section>`;
}

/* ---------- analyst agent ---------- */
const ASK_SUGGESTIONS = [
  "Why is Disney not flagged?",
  "How is Gymshark trending on Qloo right now?",
  "Re-derive Disney's cultural beta live.",
  "What is in the media taste basket?",
  "Can the held-out test detect a taste effect?",
  "Is this just consumer confidence?",
  "Where does the Disney basket come from?",
];

// The freshness attestation is obtained by the server at answer time, so the page
// only ever prints what it was handed. An unchecked attestation prints the reason,
// never a date: there is no state in which a plausible-looking freshness date can be
// rendered without a Qloo response behind it.
const FRESH_WHY = {
  live_gate_off: "the live Qloo gate is off on this deployment",
  qloo_key_missing: "the server process has no Qloo key",
  budget_exhausted: "today's live Qloo budget is spent",
  no_reference_entity: "the panel has no committed reference entity to ask about",
  freshness_timeout: "the Qloo probe did not answer in time",
  harness_error: "the Qloo harness refused the probe",
  no_trend_points: "Qloo returned no weekly points for the reference entity",
  not_checked_yet: "no answer has been asked since this server started",
};

const hhmm = (iso) => (iso ? String(iso).slice(11, 16) + "Z" : "—");
const shortId = (s) => {
  const v = String(s ?? "");
  return v.length > 14 ? `${v.slice(0, 8)}…${v.slice(-4)}` : v;
};

function freshBlock(f, { standing = false } = {}) {
  if (!f || f.checked !== true) {
    const why = FRESH_WHY[f?.why] ?? (f?.why ? esc(String(f.why).slice(0, 60)) : "no attestation was returned with this answer");
    return `<div class="fresh off" data-audit="freshness" role="status">
      <span class="fresh-k">Freshness not checked</span>
      <span class="fresh-v">— ${why}${f?.harnessCode ? ` <code>${esc(String(f.harnessCode).slice(0, 40))}</code>` : ""}.</span>
    </div>`;
  }
  const newer = f.verdict === "qloo_has_a_newer_revision";
  const tail = `panel last revision ${esc(f.panel?.lastRevision ?? "—")}`;
  const line = [
    `asked ${esc(String(f.respondedAt ?? "").slice(0, 10) || "—")} ${hhmm(f.respondedAt ?? f.requestedAt)}`,
    `${esc(f.entityName ?? "reference entity")} (${esc(f.entityType ?? "entity")})`,
    f.latestWeek ? `newest week ${esc(f.latestWeek)}` : "no weekly point returned",
    f.latestRevision ? `last change ${esc(f.latestRevision)}` : `no change in the ${f.weeksPulled ?? 0} weeks pulled`,
    newer ? "NEWER THAN THE PANEL" : "nothing newer than the panel tail",
    tail,
    `${f.requests ?? 0} Qloo request${f.requests === 1 ? "" : "s"}`,
    f.fromCache ? `served from the ${Math.round((f.cachedSeconds ?? 0) / 60)}-minute attestation cache` : "",
    f.fromCachedPage ? `page cache replay${f.cachedResponseFetchedAt ? ` of the response fetched ${hhmm(f.cachedResponseFetchedAt)}` : ""}` : "",
  ].filter(Boolean).join(" · ");
  const set = Array.isArray(f.entities) ? f.entities : [];
  const setLine = set.length > 1
    ? `<ul class="fresh-set">${set.map((e) => `<li>${e.checked
      ? `<b>${esc(e.ticker ?? "—")}</b> · ${esc(e.name ?? "entity")} (${esc(e.type ?? "—")})${e.sector ? ` · ${esc(e.sector)}` : ""} · newest week ${esc(e.latestWeek ?? "—")} · ${e.verdict === "qloo_has_a_newer_revision" ? "CHANGED" : e.verdict === "newer_weeks_no_change" ? "no change" : "nothing newer"}`
      : `<b>${esc(e.ticker ?? "—")}</b> · ${esc(e.name ?? "entity")} · not read`}</li>`).join("")}</ul>`
    : "";
  return `<div class="fresh ${newer ? "warn" : "ok"}" data-audit="freshness" role="status">
    <span class="fresh-k">Qloo freshness ${standing ? "(last answer)" : "at answer time"}</span>
    <span class="fresh-v">${line}</span>
    ${setLine}
    ${f.correlationIds?.length ? `<span class="fresh-cid">correlation ${f.correlationIds.map((c) => `<code>${esc(shortId(c))}</code>`).join(" ")}</span>` : ""}
    <p class="fresh-plain">${esc(f.plain ?? "")}</p>
  </div>`;
}

// The three states are only useful if a first-time reader knows what they mean.
// One line each: what the state is, and what the desk does about it.
function gateLegend() {
  return `<div class="gate-legend" aria-label="What the three attestation states mean">
    <span><b>Pass</b> Qloo was read just now and nothing newer changed the panel. The numbers stand.</span>
      <span><b>Moved</b> Qloo has revised since this panel was built. The numbers predate the feed.</span>
    <span><b>Unattested</b> The check could not run. These are committed numbers, not a fresh reading.</span>
  </div>`;
}

function attestationBlock(att) {
  if (!att || !att.stamp) return "";
  const legend = gateLegend();
  if (att.state === "moved") {
    return `<div class="att att-moved" data-audit="attestation-gate" data-state="moved"><b>Attestation: moved.</b> ${esc(att.note ?? "")} <code>${esc(att.stamp)}</code>${legend}</div>`;
  }
  if (att.state === "unattested") {
    return `<div class="att att-none" data-audit="attestation-gate" data-state="unattested"><b>Attestation: unattested.</b> ${esc(att.note ?? "")} <code>${esc(att.stamp)}</code>${legend}</div>`;
  }
  return `<p class="att att-pass" data-audit="attestation-gate" data-state="pass"><b>Attestation: pass.</b> ${esc(att.note ?? "")} <code>${esc(att.stamp)}</code>${legend}</p>`;
}

function receiptLine(rc) {
  if (rc.kind === "panel") {
    return `<div class="rc"><b>panel</b><span>${esc(rc.file ?? "output/desk.json")} · revision ${esc(String(rc.revision ?? "").slice(0, 19))} · ${rc.rows ?? "—"} rows · window ${esc(rc.window?.start ?? "—")} → ${esc(rc.window?.end ?? "—")} (${rc.window?.weeks ?? "—"} weeks)</span></div>`;
  }
  if (rc.kind === "freshness") {
    if (!rc.checked) {
      return `<div class="rc"><b>freshness</b><span>not asked — ${esc(FRESH_WHY[rc.why] ?? String(rc.why ?? "unknown").slice(0, 60))}${rc.requests ? ` · ${rc.requests} request(s) spent before failing` : ""}</span></div>`;
    }
    return `<div class="rc"><b>freshness</b><span>${esc(rc.operation ?? "exec trends")} · entity <code>${esc(rc.entity ?? "—")}</code> (${esc(rc.entityName ?? "")})${rc.entities?.length > 1 ? ` · set ${rc.entities.map((e) => `${esc(e.ticker ?? "?")}:${e.checked ? esc(e.latestWeek ?? "—") : "not read"}`).join(" ")}` : ""} · ${rc.requests ?? 0} request${rc.requests === 1 ? "" : "s"} · correlation ${rc.correlationIds?.length ? rc.correlationIds.map((c) => `<code>${esc(c)}</code>`).join(" ") : "none returned"} · asked ${esc(String(rc.requestedAt ?? "").slice(0, 19))} · answered ${esc(String(rc.respondedAt ?? "").slice(0, 19))}${rc.fromAttestationCache ? ` · this attestation reused for ${rc.attestationCacheSeconds ?? 0}s of the 15-minute book cache` : ""}${rc.fromCachedPage ? " · replayed from the page cache" : ""} · panel tail ${esc(rc.panel?.lastRevision ?? "—")}${rc.panel?.windowEnd ? ` (window ends ${esc(rc.panel.windowEnd)})` : ""} · gate ${esc(rc.gate ?? "—")} <code>${esc(rc.stamp ?? "unsigned")}</code> · files ${rc.files?.length ? rc.files.map((f) => `<code>${esc(f)}</code>`).join(" ") : "—"}</span></div>`;
  }
  if (rc.kind === "live") {
    const ents = (rc.entities ?? []).slice(0, 6).map((e) => `<code>${esc(shortId(e))}</code>`).join(" ");
    return `<div class="rc"><b>live · ${esc(rc.tools?.join(", ") ?? rc.operation ?? "qloo")}</b><span>${esc(rc.operation ?? "exec trends")} · ${rc.entities?.length ?? 0} entity id(s) ${ents}${(rc.entities?.length ?? 0) > 6 ? ` +${rc.entities.length - 6} more` : ""} · ${rc.requests ?? 0} request(s)${rc.replayedPages ? `, ${rc.replayedPages} page(s) replayed from cache` : ""} · correlation ${rc.correlationIds?.length ? rc.correlationIds.map((c) => `<code>${esc(c)}</code>`).join(" ") : "none returned"} · requested ${esc(String(rc.requestedAt ?? "").slice(0, 19))} · files ${(rc.files ?? []).slice(0, 4).map((f) => `<code>${esc(f)}</code>`).join(" ")}${(rc.files?.length ?? 0) > 4 ? ` +${rc.files.length - 4} more` : ""}</span></div>`;
  }
  const files = (rc.files ?? []).map((f) => `<code>${esc(f)}</code>`).join(" ");
  return `<div class="rc"><b>committed · ${esc(rc.tools?.join(", ") ?? "panel tool")}</b><span>${esc(rc.ticker ?? "")} ${esc(rc.label ?? "")} · ${esc(rc.status ?? "")} · entity <code>${esc(rc.entity ?? "no Qloo entity")}</code>${rc.basketScope ? ` · basket ${esc(rc.basketScope)}` : ""} · request ${esc(rc.request?.operation ?? "—")}${rc.request?.path ? ` ${esc(rc.request.path)}` : ""}${rc.request?.types?.length ? ` [${rc.request.types.map(esc).join(", ")}]` : ""}${rc.request?.signals?.length ? ` · signals ${rc.request.signals.map((s) => shortId(s)).join(", ")}` : ""} · cached response ${files || "—"}</span></div>`;
}

function receiptBlock(list) {
  const rc = Array.isArray(list) ? list : [];
  if (!rc.length) return "";
  return `<div class="receipts" data-audit="receipts">
  <div class="rc-head">Qloo receipt for this answer · ${rc.length} entr${rc.length === 1 ? "y" : "ies"}</div>
  ${rc.map(receiptLine).join("")}
  <p class="rc-note">File names, entity ids and the harness's own correlation ids — never the contents of a cached response, and never a key: the Qloo key stays in the server's environment and is not sent to the browser.</p>
</div>`;
}

// Replay is opt-in and labelled where the question is asked. Off, the page is
// today's desk; on, the POST carries the ISO day the server slices for replay.
function replayToggle() {
  return `<div class="replay-row">
    <button type="button" id="replay-toggle" class="replay-toggle${ASK_REPLAY ? " on" : ""}" data-audit="replay-toggle" aria-pressed="${ASK_REPLAY}" ${ASK.busy ? "disabled" : ""}>
      <span class="replay-box" aria-hidden="true">${ASK_REPLAY ? "✓" : ""}</span>
      <span>Replay the desk as of ${REPLAY_ASOF} — before Qloo's December 2025 revision</span>
    </button>
    <span class="replay-state">${ASK_REPLAY ? `on · replay ${esc(REPLAY_ASOF)}` : "off · today's desk"}</span>
  </div>`;
}

// The banner is rendered only from the response's replay metadata, and it says in
// plain words what the reader is looking at: a vintage, not a revision today.
function replayBanner(rp) {
  if (!rp) return "";
  const asOf = esc(rp.asOf ?? "—");
  const rev = esc(rp.revisionWeek ?? "—");
  const through = esc(rp.through ?? "—");
  return `<div class="replay" data-audit="replay-banner" role="note">
    <span class="replay-k">Replay · not a live revision</span>
    <p><b>This is a replay, and not a claim that Qloo revised today.</b> It shows the desk as it stood on <b>${asOf}</b> — the vintage before Qloo's December 2025 revision (the gate dates the Disney-basket entity revisions to 2025-12-15; the baskets' last non-zero week is ${rev}), with the panel tail at ${through}. The pre-revision betas were recomputed offline from the committed series with the committed estimator. The live Qloo pull behind any re-estimate is a real request, never simulated data.</p>
  </div>`;
}

// A replay that returned no usable re-estimate degrades to one line: no empty
// table, and the reason is the server's own attestation, not a guess.
function reestNone(att, fresh) {
  const why = fresh?.why ? (FRESH_WHY[fresh.why] ?? String(fresh.why).slice(0, 60)) : "";
  const line = att?.state === "moved"
    ? "The freshness check saw the revision, but the re-estimate returned no result — no name moved, or the live tool was unavailable. The figures above are the replayed vintage."
    : att?.state === "unattested"
      ? `The re-estimate could not run: the freshness check was unattested${why ? ` — ${why}` : ""}. The figures above are the replayed vintage.`
      : "The re-estimate could not run, so the figures above are the replayed vintage.";
  return `<p class="reest-none" data-audit="reestimation-none">${esc(line)}</p>`;
}

function reestSection(re) {
  const results = Array.isArray(re?.results) ? re.results : [];
  const ok = results.filter((x) => x.ok);
  const failed = results.filter((x) => !x.ok);
  if (!ok.length) {
    const reason = re?.reason ? String(re.reason) : "";
    const errs = failed.map((x) => `${x.ticker ?? "—"}: ${x.error ?? "live_failed"}`).join("; ");
    return `<p class="reest-none" data-audit="reestimation-none">The re-estimate returned no number${errs ? ` (${esc(errs)})` : reason ? ` (${esc(reason)})` : ""}. The figures above are the replayed vintage.</p>`;
  }
  const cids = [...new Set(results.flatMap((x) => x.correlationIds ?? []))];
  const requests = results.reduce((n, x) => n + (Number(x.requests) || 0), 0);
  const rows = ok.map((x) => {
    const c = x.committed ?? {};
    const l = x.live ?? {};
    return `<tr><td class="reest-t">${esc(x.ticker ?? "—")}</td><td class="reest-v"><span>β ${nf(c.beta)} → ${nf(l.beta)}</span><span>t ${nf(c.t)} → ${nf(l.t)}</span><span>ΔR² ${ptsf(c.deltaR2)} → ${ptsf(l.deltaR2)} pts</span></td></tr>`;
  }).join("");
  return `<div class="reest" data-audit="reestimation">
    <span class="reest-k">Re-estimated live · the committed reading is unchanged</span>
    <table class="reest-table">
      <thead><tr><th>Ticker</th><th>Committed beta → re-estimated beta · t · ΔR²</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="reest-spend">${requests} Qloo request${requests === 1 ? "" : "s"} (${re.spent ?? 0} new, ${re.replayed ?? 0} page${Number(re.replayed) === 1 ? "" : "s"} replayed from the page cache) · correlation ${cids.length ? cids.map((c) => `<code>${esc(c)}</code>`).join(" ") : "ids: none returned"}</p>
    ${failed.length ? `<p class="reest-fail">Not re-estimated — ${failed.map((x) => `<b>${esc(x.ticker ?? "—")}</b>: ${esc(x.error ?? "live_failed")}`).join("; ")}</p>` : ""}
  </div>`;
}

function askView() {
  const ready = AGENT ? Boolean(AGENT.configured) : true;
  const disabled = ASK.busy || !DESK || !ready;
  const r = ASK.res;
  const meta = r ? [
    r.cached ? "cached answer" : `${r.toolCalls} tool call${r.toolCalls === 1 ? "" : "s"} · ${r.rounds} round${r.rounds === 1 ? "" : "s"} · ${(r.ms / 1000).toFixed(1)}s`,
    r.provider ? esc(r.provider) : "",
    r.model ? esc(r.model) : "",
  ].filter(Boolean).join(" · ") : "";
  const freshEl = r ? "" : freshBlock(FRESH, { standing: true });
  return `<div class="head">
    <div class="lede-col">
      <h1>Ask the <em>desk</em>.</h1>
      <p class="sub">An analyst that reads the committed panel${AGENT?.live?.enabled ? ", and may make one bounded live Qloo read per answer" : " and the Qloo responses behind it"}. Read-only: it cannot run the pipeline or move a number.${AGENT?.live?.enabled ? " Whether it is current is not its own claim: before each answer the server asks Qloo one bounded trend page per cited name (otherwise one per sub-sector) and prints what came back, checked or not." : ""}</p>
    </div>
    <div class="side">
      ${DESK ? windowPill(DESK.window) : ""}
      <div class="state ${ready ? "ok" : "warn"}">${ready ? (AGENT?.live?.enabled ? "read-only · one live Qloo read per answer · server freshness attestation on each" : "read-only · no Qloo spend") : "analyst not configured"}</div>
    </div>
  </div>
  ${!DESK ? `<div class="notice"><span class="dot"></span><span class="notice-text"><b>No panel to read.</b> This deployment has no Qloo data, and the analyst refuses rather than answer from a stub.</span></div>` : ""}
  ${DESK && !ready ? `<div class="notice"><span class="dot"></span><span class="notice-text"><b>The analyst model is not configured on this deployment.</b> The desk and every number on it are unaffected — set the <code>AGENT_*</code> variables on the server to enable this page.</span></div>` : ""}
  <section class="card ask">
    <form id="ask-form" autocomplete="off">
      <label class="ask-label" for="ask-q">Question</label>
      <div class="ask-row">
        <input id="ask-q" name="question" maxlength="400" placeholder="e.g. What is in the media taste basket?" value="${esc(ASK.q)}" ${disabled ? "disabled" : ""}>
        <button class="btn" type="submit" ${disabled ? "disabled" : ""}>${ASK.busy ? "Answering…" : "Ask"}</button>
      </div>
    </form>
    <div class="ask-chips">${ASK_SUGGESTIONS.map((s) => `<button class="qchip" type="button" data-q="${esc(s)}" ${disabled ? "disabled" : ""}>${esc(s)}</button>`).join("")}</div>
    ${ready ? replayToggle() : ""}
    ${freshEl}
    ${r ? "" : gateLegend()}
    ${ASK.err ? `<p class="ask-err">${esc(ASK.err)}</p>` : ""}
    ${r ? `<div class="ask-answer" data-audit="agent-answer">
      <p class="ask-q">${esc(ASK.q)}</p>
      ${r.replay ? replayBanner(r.replay) : ASK_REPLAY ? `<p class="reest-none" data-audit="replay-missing">Replay was requested, but the server returned no replay vintage; nothing below is a replay.</p>` : ""}
      ${r.replay && !r.reestimation ? reestNone(r.attestation, r.freshness) : ""}
      ${String(r.answer).split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("")}
      ${attestationBlock(r.attestation)}
      ${r.reestimation ? reestSection(r.reestimation) : ""}
      <p class="ask-meta">${meta}</p>
      <details class="receipt-details" data-audit="receipt-details">
        <summary><span>Show the Qloo receipt</span><small>freshness attestation · calls behind this answer · cached response files</small></summary>
        ${freshBlock(r.freshness)}
        ${receiptBlock(r.receipts)}
        ${r.trace?.length ? `<details class="trace"><summary>What the analyst read (${r.trace.length})</summary>${r.trace.map((t) => `<div class="tr"><b>${esc(t.name)}</b> <code>${esc(JSON.stringify(t.args))}</code><pre>${esc((JSON.stringify(t.result) || "").slice(0, 1600))}</pre></div>`).join("")}</details>` : ""}
      </details>
      <p class="ask-note">Generated from the tool results above, not from the estimator: the betas themselves have no model in them. Check any number against the <a href="#/evidence">evidence page</a>.${r.trace?.some((t) => String(t.name).startsWith("live_")) ? " A live Qloo read is listed in the trace; the rest of the answer is the committed panel." : ""}${r.freshness?.checked ? ` The attestation line above is the server's own Qloo ask, not the analyst's.` : ""}</p>
    </div>` : `<div class="ask-empty">${ASK.busy ? `<p class="ask-wait" data-audit="ask-busy"><b>Reading the panel</b> — <span class="ask-clock">0 s</span><span class="ask-stage"></span>. It picks its own tools, then writes from what they returned; the desk asks Qloo for its freshness attestation at the same moment. The calls it made are listed with the answer.</p>` : `<p>Answers are limited to what this book contains: a holding, a basket, a null, or the source of a number.</p>`}
      <p class="ask-tools"><b>Tools it chooses between</b> — desk summary · one holding · a sub-sector basket · the weekly taste series · the book-level nulls · Qloo provenance${AGENT?.live?.enabled ? " · a live brand read · a live beta re-run" : ""}. Every call and its result is shown with the answer. The estimator has no model in it; this page does.</p></div>`}
  </section>`;
}

/* ---------- router ---------- */
function setTabs(hash) {
  document.querySelectorAll(".tabs a").forEach((a) => {
    const on = (a.dataset.tab === "desk" && (hash === "#/" || hash.startsWith("#/holding/") || hash.startsWith("#/read")))
      || (hash.startsWith("#/map") && a.dataset.tab === "map")
      || (hash.startsWith("#/evidence") && a.dataset.tab === "evidence")
      || (hash.startsWith("#/ask") && a.dataset.tab === "ask")
      || (hash.startsWith("#/xray") && a.dataset.tab === "xray");
    a.classList.toggle("on", on);
    if (a.dataset.tab === "map") a.hidden = !DESK;
  });
}

function route() {
  let h = location.hash || "#/";
  document.body.dataset.mode = DESK ? "live" : "cold";
  const v = $("#view");
  // Nine JSON reads stand between an empty #view and the desk. Paint the frame and
  // the tab state on the first tick; a slow connection then reads "reading the panel"
  // instead of a blank page with no tabs marked.
  if (BOOTING) { v.innerHTML = bootView(); setTabs(h); return; }
  if (h.startsWith("#/xray")) window.xrayView(h);
  else if (DESK && h.startsWith("#/holding/")) v.innerHTML = holdingView(decodeURIComponent(h.split("/")[2] || ""));
  else if (DESK && h.startsWith("#/map")) v.innerHTML = mapView();
  else if (h.startsWith("#/read")) v.innerHTML = readView();
  else if (h.startsWith("#/ask")) {
    const pre = sessionStorage.getItem("cbPrefill");
    if (pre && !ASK.q) ASK.q = pre;
    sessionStorage.removeItem("cbPrefill");
    v.innerHTML = askView();
  }
  else if (h.startsWith("#/evidence")) v.innerHTML = evidenceView(DESK ? decodeURIComponent(h.split("/")[2] || "") : "");
  else v.innerHTML = deskView();
  const wk = $("#note-weeks");
  if (wk && DESK?.window?.weeks) wk.textContent = `${DESK.window.weeks} aligned`;
  setTabs(h);
  wire(h);
}

function wire(hash) {
  // The filter re-renders the table, so the caret is put back where it was; without
  // that, typing a second character would drop focus on every keystroke.
  const q = $("#book-q");
  if (q) {
    q.oninput = () => {
      bookQuery = q.value;
      const at = q.selectionStart;
      route();
      const again = $("#book-q");
      if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch { /* type=search ignores it in some browsers */ } }
    };
    q.onkeydown = (e) => { if (e.key === "Escape") { bookQuery = ""; route(); } };
  }
  document.querySelectorAll("[data-clear]").forEach((b) => b.onclick = () => { bookQuery = ""; route(); $("#book-q")?.focus(); });
  // "/" is the shortcut printed in the placeholder; bound once, because wire()
  // runs on every route and a listener per render would stack.
  if (!slashBound) {
    slashBound = true;
    document.addEventListener("keydown", (e) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const box = $("#book-q");
      if (!box) return;
      e.preventDefault();
      box.focus();
      box.select();
    });
  }
  document.querySelectorAll(".fchip").forEach((b) => b.onclick = () => {
    if (sectorFilter === b.dataset.sector) return;
    sectorFilter = b.dataset.sector;
    route();
  });
  const ms = $("#sort-key");
  if (ms) ms.onchange = () => {
    const [k, d] = ms.value.split(":");
    sortKey = k;
    sortDir = Number(d) || 1;
    route();
    const again = $("#sort-key");
    if (again) again.focus();
  };
  const openSector = (id) => { if (!id) return; sectorFilter = id; location.hash = "#/"; };
  document.querySelectorAll("svg .dot").forEach((g) => {
    g.onclick = () => openSector(g.dataset.sector);
    g.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSector(g.dataset.sector); } };
  });
  document.querySelectorAll("th.sort").forEach((th) => th.onclick = () => {
    const k = th.dataset.k;
    if (k === sortKey) sortDir *= -1; else { sortKey = k; sortDir = (k === "ticker" || k === "culturalQ") ? 1 : -1; }
    route();
  });
  document.querySelectorAll("tr.link").forEach((tr) => tr.onclick = (e) => {
    if (e.target.closest("a")) return;
    location.hash = tr.dataset.ev ? `#/evidence/${tr.dataset.ev}` : `#/holding/${tr.dataset.h}`;
  });
  const btn = $("#recompute");
  if (btn) btn.onclick = recompute;
  const replayBtn = $("#replay-toggle");
  if (replayBtn) replayBtn.onclick = () => {
    ASK_REPLAY = !ASK_REPLAY;
    // The previous answer was produced under the other mode; keeping it on screen
    // under a switched toggle would mislabel it.
    ASK = { ...ASK, res: null, err: null };
    route();
  };
  const askForm = $("#ask-form");
  if (askForm) {
    const run = async (q) => {
      const question = String(q ?? $("#ask-q")?.value ?? "").trim();
      if (!question || ASK.busy) return;
      ASK = { q: question, busy: true, res: null, err: null, started: Date.now() };
      route();
      // A silent spinner for fifty seconds reads as a hang. Count the wait out loud
      // and name the stage; nothing here claims progress the desk cannot see.
      const waitTimer = setInterval(() => {
        const el = document.querySelector(".ask-wait");
        if (!el || !ASK.busy) { clearInterval(waitTimer); return; }
        const secs = Math.round((Date.now() - (ASK.started ?? Date.now())) / 1000);
        const clock = el.querySelector(".ask-clock");
        if (clock) clock.textContent = `${secs} s`;
        const stage = el.querySelector(".ask-stage");
        const text = secs < 8 ? " · selecting a tool" : secs < 25 ? " · reading the rows it picked" : secs < 55 ? " · writing the answer" : " · still writing; a long think, not a hang";
        if (stage && stage.textContent !== text) stage.textContent = text;
      }, 1000);
      try {
        const r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ASK_REPLAY ? { question, replay: REPLAY_ASOF } : { question }) });
        clearInterval(waitTimer);
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          if (j.freshness) FRESH = j.freshness;
          ASK = { q: question, busy: false, res: j, err: null };
        } else ASK = {
          q: question, busy: false, res: null,
          err: j.error === "AGENT_NOT_CONFIGURED" ? "The analyst is not configured on this deployment. The desk is unaffected."
            : j.error === "RATE_LIMITED" ? `Slow down — try again in ${j.retryAfter}s.`
              : (j.message || j.error || "The analyst did not return an answer."),
        };
      } catch {
        clearInterval(waitTimer);
        ASK = { q: question, busy: false, res: null, err: "Could not reach the analyst endpoint." };
      }
      route();
    };
    askForm.onsubmit = (e) => { e.preventDefault(); run(); };
    document.querySelectorAll(".qchip").forEach((b) => b.onclick = () => run(b.dataset.q));
  }
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
    if (r.ok) {
      await load();
      // The desk never spends Qloo requests because a visitor pressed a button; say
      // which of the two things just happened.
      refreshNote(j.mode === "keyed"
        ? "Desk rebuilt from a fresh keyed Qloo run — the operator opted in, and the budget paid for it."
        : "Desk rebuilt from the Qloo responses already cached by the paid-for run. No new calls were made.");
    } else {
      DESK = null; SERIES = null; EVIDENCE = null;
      const m = await get("/api/market-only.json"); if (m.ok) MARKET = m.data;
      route();
      const err = ((j.log?.at(-1)?.err || "") + "").split("\n")[0].slice(0, 140);
      refreshNote("Re-derive refused: " + err);
    }
  } catch (e) { refreshNote("Recompute failed: " + e.message); }
  const again = $("#recompute");
  if (again) { again.disabled = false; again.textContent = "Re-derive the panel"; }
}

function refreshNote(text) {
  const el = $("#note-live"); if (el) el.textContent = text;
  const wk = $("#note-weeks");
  if (wk && DESK?.window?.weeks) wk.textContent = `${DESK.window.weeks} aligned`;
}

window.addEventListener("hashchange", route);
// "Start here" link 2 carries its question in a data attribute; the ask view
// reads it once. Never auto-submits: an ask spends a model call.
document.addEventListener("click", (e) => {
  const a = e.target instanceof Element ? e.target.closest("[data-prefill]") : null;
  if (a) sessionStorage.setItem("cbPrefill", a.getAttribute("data-prefill") || "");
});
// The boot frame is the first paint; load() replaces it when the files arrive.
route();
load();
