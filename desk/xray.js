/* Taste X-ray — a client-side reading of a pasted portfolio against the committed
 * panel. No estimator here and no Qloo call from the page: the only inputs are the
 * desk's own committed JSON (/api/desk.json, the revision-replay artifact, the
 * freshness peek), so every number shown can be traced to one of those files.
 * Anything the artifacts do not carry is printed as absent ("unsigned",
 * "not attested this session"), never invented. Exposure arithmetic only:
 * descriptive, not investment advice. */
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : "—");
  const pct = (n) => (Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—");

  /* ---------- parsing ---------- */
  // "DIS 40%, NKE 25%, SBUX 20%, AAPL 15%" · "DIS:40,NKE:25" · "DIS NKE SBUX"
  // (plain tickers take equal weights). One holding may also carry an optional
  // share of portfolio. A ticker repeated in the paste stacks its weights. A
  // weightless entry next to weighted ones takes weight 1 and is normalised with
  // the rest, so the paste is never silently re-balanced beyond that rule.
  function parseHoldings(text) {
    const list = [];
    const skipped = []; // [{ raw, why }] — printed back to the reader, never silently dropped
    const byTicker = new Map();
    const add = (rawTicker, w) => {
      const ticker = String(rawTicker ?? "").trim().toUpperCase().replace(/[^A-Z0-9.&~-]/g, "");
      if (!/^[A-Z][A-Z0-9.&~-]{0,9}$/.test(ticker)) return;
      if (Number.isFinite(w) && w < 0) { skipped.push({ raw: `${ticker} ${w}`, why: "short positions are not read; the X-ray is long-only" }); return; }
      const weight = Number.isFinite(w) && w > 0 ? w : null;
      if (byTicker.has(ticker)) {
        const prev = byTicker.get(ticker);
        if (weight !== null) prev.weight = (prev.weight ?? 0) + weight;
      } else {
        const h = { ticker, weight };
        byTicker.set(ticker, h);
        list.push(h);
      }
    };
    // Not tickers, however ticker-shaped they look once uppercased.
    const STOP = new Set(["THE", "AND", "OF", "IN", "AT", "TO", "OR", "FOR", "A"]);
    // Dollar amounts: "$40,000" is one number, not "$40" and "000".
    let t = String(text ?? "").replace(/\$/g, "");
    for (let i = 0; i < 3; i++) t = t.replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
    const TK = "([A-Za-z][A-Za-z0-9.&~-]{0,9})";
    const NUM = "(-?\\d+(?:\\.\\d+)?)";
    const re = new RegExp(`${TK}\\s*[:=]\\s*${NUM}\\s*%?|${TK}\\s*[:=]\\s*(\\S+)|${TK}\\s+${NUM}\\s*%?|${TK}`, "g");
    for (const chunk of t.split(/[,;\n]+/)) {
      const c = chunk.trim();
      if (!c) continue;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(c))) {
        if (m[1]) add(m[1], parseFloat(m[2]));                    // DIS:40 / DIS=-10
        else if (m[3]) skipped.push({ raw: `${m[3].toUpperCase()}:${m[4]}`, why: "the weight is not a number" }); // NKE:abc
        else if (m[5]) add(m[5], parseFloat(m[6]));               // DIS 40 / DIS 40%
        else if (m[7] && !STOP.has(m[7].toUpperCase())) add(m[7], null); // DIS
      }
    }
    list.skipped = skipped;
    list.mixed = list.some((h) => h.weight === null) && list.some((h) => h.weight !== null);
    return list;
  }

  const norm = (list) => {
    const total = list.reduce((a, h) => a + (h.weight ?? 1), 0);
    return total > 0 ? list.map((h) => ({ ...h, w: (h.weight ?? 1) / total })) : [];
  };

  // Canonical share link for a parsed list: weights as typed (weightless = 1),
  // whole numbers left whole, everything else trimmed to 2dp.
  function canonicalLink(list) {
    const q = list.map((h) => {
      const w = h.weight ?? 1;
      const s = Number.isInteger(w) ? String(w) : String(Math.round(w * 100) / 100);
      return `${h.ticker}:${s}`;
    }).join(",");
    return `#/xray?h=${q}`;
  }

  /* ---------- desk lookups ---------- */
  // Covered = the book lists the name and the estimator produced both betas
  // (status "ok"). Everything else is reported as what it is, never guessed.
  function classify(holding, desk) {
    const row = desk?.rows?.find((r) => String(r.ticker).toUpperCase() === holding.ticker);
    if (!row) return { kind: "unknown" };
    if (row.status === "ok" && Number.isFinite(row.culturalBeta) && Number.isFinite(row.marketBeta)) return { kind: "covered", row };
    return { kind: "listed", row };
  }

  /* ---------- exposure arithmetic ---------- */
  // Position-weighted averages over covered rows only; the same weights drive the
  // entity rollup, so the concentration sentence and the beta pair describe the
  // identical mass.
  function rollup(list, desk) {
    const covered = norm(list).map((h) => ({ ...h, ...classify(h, desk) })).filter((h) => h.kind === "covered");
    const mass = covered.reduce((a, h) => a + h.w, 0);
    if (!covered.length || mass <= 0) return { covered: [], cultural: null, market: null, entities: [], topShare: null };
    const weighted = covered.map((h) => ({ ...h, wn: h.w / mass }));
    const cultural = weighted.reduce((a, h) => a + h.wn * h.row.culturalBeta, 0);
    const market = weighted.reduce((a, h) => a + h.wn * h.row.marketBeta, 0);
    const acc = new Map();
    for (const h of weighted) {
      for (const b of h.row.basket ?? []) {
        if (!b?.name || !Number.isFinite(b.weight)) continue;
        acc.set(b.name, (acc.get(b.name) ?? 0) + h.wn * b.weight);
      }
    }
    const entities = [...acc.entries()].map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score);
    return { covered: weighted, coveredShare: mass, cultural, market, entities, topShare: entities.length ? entities[0].score : null };
  }

  /* ---------- freshness gate ---------- */
  // /api/freshness.json is a cache read of the server's last panel-wide Qloo
  // attestation. It attests basket entities, never individual holdings, and — as
  // shipped — it carries no stamp, so the stamp prints "unsigned" (the desk's own
  // word for an absent stamp) rather than a plausible-looking hash.
  function gateOf(fresh) {
    if (!fresh) return { state: "unattested", stamp: "unsigned", detail: "freshness endpoint did not answer" };
    if (!fresh.checked) return { state: "unattested", stamp: "unsigned", detail: String(fresh.why ?? "not checked") };
    const state = fresh.verdict === "qloo_has_a_newer_revision" ? "moved" : "pass";
    const stamp = typeof fresh.stamp === "string" && fresh.stamp.startsWith("att-") ? fresh.stamp : "unsigned";
    const bits = [];
    if (fresh.latestWeek) bits.push(`latest week ${fresh.latestWeek}`);
    if (fresh.at) bits.push(`read ${String(fresh.at).slice(0, 16).replace("T", " ")} UTC`);
    return { state, stamp, detail: bits.join(" · ") };
  }

  /* ---------- revision replay ---------- */
  // The replay artifact is the only source for "moved": a name re-estimated
  // across the 2025-12-01 vintage. The sentence is built from the artifact's own
  // numbers; without the artifact no movement is claimed at all.
  function moverLine(ticker, replay) {
    const m = replay?.movers?.find((x) => String(x.ticker).toUpperCase() === String(ticker).toUpperCase());
    if (!m || !Number.isFinite(m.betaBefore) || !Number.isFinite(m.betaAfter)) return null;
    // Every priced name is in the replay; only a material move is called one, so a
    // 0.2-point wobble from the shorter pre-revision window is not sold as news.
    if (Math.abs(m.betaAfter - m.betaBefore) < MOVE_MIN) return null;
    return `moved across Qloo's December 2025 revision: ${f2(m.betaBefore)} at the pre-revision vintage → ${f2(m.betaAfter)} today`;
  }

  const MOVE_MIN = 1; // |Δβ| in beta points
  const inReplay = (ticker, replay) => Boolean(replay?.movers?.some((x) => String(x.ticker).toUpperCase() === String(ticker).toUpperCase()));

  /* ---------- data loading (lazy, cached) ---------- */
  const get = async (p) => { try { const r = await fetch(p); return r.ok ? await r.json() : null; } catch { return null; } };
  let deskP = null, auxP = null;
  const deskOnce = () => (deskP ??= get("/api/desk.json"));
  const auxOnce = () => (auxP ??= Promise.all([get("/api/freshness.json"), get("/api/revision-replay.json")]));

  /* ---------- rendering ---------- */
  const tag = (cls, text) => `<span class="xray-tag ${cls}">${esc(text)}</span>`;

  function rowsHTML(parsed, desk, replay) {
    return parsed.map((h) => {
      const c = classify(h, desk);
      let name = h.ticker, status, note = "";
      if (c.kind === "covered") {
        const line = moverLine(h.ticker, replay);
        status = line ? tag("moved", "moved") : inReplay(h.ticker, replay) ? tag("stable", "stable") : tag("", "panel");
        if (line) note = `<div class="xray-move">${esc(line)}</div>`;
        name = `${esc(h.ticker)} <span class="xray-muted">${esc(c.row.label ?? "")}</span>`;
      } else if (c.kind === "listed") {
        status = tag("", "no reading");
        name = `${esc(h.ticker)} <span class="xray-muted">${esc(c.row.label ?? "")}</span>`;
      } else {
        status = tag("unknown", "not covered");
        name = esc(h.ticker);
      }
      return `<tr><td class="xray-name">${name}${note}</td><td class="xray-num" data-label="Cultural beta">${c.kind === "covered" ? f2(c.row.culturalBeta) : "—"}</td><td class="xray-num" data-label="Market beta">${c.kind === "covered" ? f2(c.row.marketBeta) : "—"}</td><td>${status}</td></tr>`;
    }).join("");
  }

  function outputHTML(parsed, desk, fresh, replay) {
    const r = rollup(parsed, desk);
    const gate = gateOf(fresh);
    const uncovered = parsed.filter((h) => classify(h, desk).kind === "unknown").map((h) => h.ticker);
    const listed = parsed.filter((h) => classify(h, desk).kind === "listed").map((h) => h.ticker);
    const link = canonicalLink(parsed);

    const stats = r.cultural === null
      ? `<p class="xray-line">Nothing in this paste has a taste reading in the committed panel, so there is no exposure to x-ray.</p>`
      : `<div class="xray-stats">
           <div class="stat"><b class="${r.cultural < 0 ? "neg" : "pos"}">${r.cultural > 0 ? "+" : ""}${f2(r.cultural)}</b><span>Blended cultural beta</span></div>
           <div class="stat"><b>${f2(r.market)}</b><span>Market beta, same weights</span></div>
         </div>
         <p class="xray-fine">Position-weighted over ${r.covered.length} covered name${r.covered.length === 1 ? "" : "s"} (${pct(r.coveredShare)} of the pasted weight). Names without a reading are left out and the covered names re-weighted to 100%, not counted as zero. Each name's cultural beta is measured against its own sub-sector's taste basket, so this is a blend across baskets, not a beta to one factor.</p>`;

    const top5 = r.entities.slice(0, 5).map((e) => e.name);
    const loves = top5.length
      ? `<p class="xray-line">Across your covered holdings, the audience baskets point most at ${esc(top5[0])}${top5.length > 1 ? `, then ${top5.slice(1).map(esc).join(", ")}` : ""}.</p>`
      : `<p class="xray-line">No basket entities to rank for this paste.</p>`;

    const conc = r.topShare !== null
      ? `<p class="xray-line">${pct(r.topShare)} of your position-weighted basket weight sits on one entity, ${esc(r.entities[0].name)}; the top five carry ${pct(r.entities.slice(0, 5).reduce((a, e) => a + e.score, 0))}.</p>`
      : "";

    const gateBits = [`Qloo freshness check: <b>${esc(gate.state)}</b>${gate.stamp !== "unsigned" ? ` · ${esc(gate.stamp)}` : ""}`];
    if (gate.detail) gateBits.push(esc(gate.detail));

    return `
      <h3>Portfolio betas</h3>${stats}
      <h3>What your audience loves</h3>${loves}
      <h3>Concentration</h3>${conc || `<p class="xray-line">No weighted mass to measure yet.</p>`}
      <h3>Gate status</h3>
      <p class="xray-gate">${gateBits.join(" · ")}</p>
      <table><thead><tr><th class="xray-th-l">Holding</th><th>Cultural β</th><th>Market β</th><th>State</th></tr></thead>
      <tbody>${rowsHTML(parsed, desk, replay)}</tbody></table>
      <p class="xray-fine">State per holding comes from the revision replay: <b>moved</b> means the name's cultural beta shifted by ${MOVE_MIN}.0 or more between the pre-revision vintage and today's panel; <b>stable</b> means less. The gate line above is the desk-wide Qloo freshness check, which attests basket entities rather than single holdings.</p>
      ${parsed.skipped?.length ? `<p class="xray-line"><b>Not read:</b> ${parsed.skipped.map((k) => `${esc(k.raw)} (${esc(k.why)})`).join("; ")}.</p>` : ""}
      ${parsed.mixed ? `<p class="xray-fine">Some holdings came without a weight next to weighted ones; each of those is read as weight 1 on the same scale as the others before normalising. Give every holding a weight to avoid this.</p>` : ""}
      ${listed.length ? `<p class="xray-line"><b>In the book, no taste reading:</b> ${listed.map(esc).join(", ")}.</p>` : ""}
      ${uncovered.length ? `<p class="xray-line"><b>Not covered yet:</b> ${uncovered.map(esc).join(", ")} — not in the committed 101-name book, so nothing is guessed for ${uncovered.length === 1 ? "it" : "them"}.</p>` : ""}
      <h3>Share this x-ray</h3>
      <div class="xray-share"><input class="xray-link" readonly value="${esc(link)}" aria-label="Share link"><button class="btn ghost xray-copy" type="button">Copy</button></div>
      <p class="xray-foot">Descriptive exposure, not investment advice.</p>`;
  }

  function frameHTML(pasted, busy) {
    return `
      <h1>Taste <span class="thin">X-ray</span></h1>
      <p class="sub">Paste a portfolio; the desk reads its taste exposure against the committed panel. Nothing is sent anywhere — the arithmetic runs in this page.</p>
      <div class="xray-card">
        <h3>Paste your holdings</h3>
        <textarea id="xray-in" class="xray-input" rows="3" placeholder="DIS 40%, NKE 25%, SBUX 20%, AAPL 15%" spellcheck="false">${esc(pasted)}</textarea>
        <div class="xray-row">
          <button id="xray-go" class="btn" type="button">Parse</button>
          <span class="xray-fine">Plain tickers take equal weights; percents, dollar amounts and DIS:40 forms also parse. Long positions only.</span>
        </div>
        <div id="xray-out">${busy ? `<p class="xray-line xray-muted">Reading the committed panel…</p>` : `<p class="xray-line xray-muted">Paste holdings and press Parse.</p>`}</div>
      </div>`;
  }

  async function render(out, pasted) {
    const parsed = parseHoldings(pasted);
    if (!parsed.length) {
      out.innerHTML = `<p class="xray-line xray-muted">Nothing parsed${parsed.skipped?.length ? ` (${parsed.skipped.map((k) => `${esc(k.raw)}: ${esc(k.why)}`).join("; ")})` : ""}. Try <code>DIS 40%, NKE 25%</code>.</p>`;
      return;
    }
    out.innerHTML = `<p class="xray-line xray-muted">Reading the committed panel…</p>`;
    const [desk, [fresh, replay]] = await Promise.all([deskOnce(), auxOnce()]);
    if (!desk?.rows) {
      out.innerHTML = `<p class="xray-notice">The committed panel is not available on this deployment, so there is nothing to read this paste against.</p>`;
      return;
    }
    out.innerHTML = outputHTML(parsed, desk, fresh, replay);
    const copy = out.querySelector(".xray-copy");
    if (copy) copy.onclick = async () => {
      try { await navigator.clipboard.writeText(`${location.origin}/${out.querySelector(".xray-link")?.value ?? ""}`); copy.textContent = "Copied"; }
      catch { copy.textContent = "Select + copy"; }
      setTimeout(() => { copy.textContent = "Copy"; }, 1600);
    };
  }

  function xrayView(hash) {
    const v = document.getElementById("view");
    if (!v) return;
    const q = new URLSearchParams(String(hash ?? "").split("?")[1] ?? "");
    const pre = q.get("h") ?? "";
    document.title = "Taste X-ray — Cultural beta";
    v.innerHTML = frameHTML(pre, Boolean(pre));
    const btn = document.getElementById("xray-go");
    const box = document.getElementById("xray-in");
    if (btn && box) btn.onclick = () => render(document.getElementById("xray-out"), box.value);
    if (pre) render(document.getElementById("xray-out"), pre);
  }

  const API = { parseHoldings, canonicalLink, rollup, classify, gateOf, moverLine };
  if (typeof window !== "undefined" && window) {
    window.xrayView = xrayView;
    window.__xray = API; // test seam: the parser and arithmetic are checked by tests/xray.test.mjs
  }
})();
