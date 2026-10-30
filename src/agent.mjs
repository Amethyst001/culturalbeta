// The analyst agent. The estimator has no model in it; this is the layer that
// explains the committed panel. Every tool is read-only over output/desk.json and
// output/series.json, so a question cannot spend a Qloo request or move a number.
//
// The model is configured entirely from the environment (AGENT_* and optional
// AGENT_FALLBACK_n_*). There is no provider, endpoint or key in this file.

export const LIMITS = { maxToolCalls: 8, maxRounds: 5, maxQuestionChars: 400, toolChars: 7000, answerChars: 6000 };

const SYSTEM = `You are the analyst interface to the Cultural Beta desk, a research instrument that prices US consumer stocks against two factors: the market (SPY) and a taste basket built from Qloo's trending data for each sub-sector.

Rules, in order of importance:
1. Never state a number that is not in a tool result. If you need one, call a tool.
2. This is not investment advice. Never recommend buying, selling, shorting, hedging or sizing a position. You describe measured exposure and its uncertainty.
3. The desk's held-out slice may be frozen at this Qloo vintage. Check desk_summary before describing any out-of-sample result. If testable is false, say the held-out test is empty / in-sample at this vintage, and never describe a null result as evidence that taste has no effect.
4. If a ticker is not in the book, say so. Never substitute a similar name or invent a row.
5. Keep in-sample association, out-of-sample evidence, point estimates and intervals distinct. A beta with a wide interval is a reading, not a ranking. Never call a per-name result "significant" without its Benjamini-Hochberg q: if q > 0.10, say it does not survive the book-wide correction, even when its p is small.
6. The numbers are Qloo-derived. When asked where one comes from, call get_provenance and name the request type and the cached response.
7. Answer in at most 180 words of plain prose. No markdown tables, headings or bullet lists. Lead with the answer, then the qualification a careful reader needs.
8. If the question is outside the desk (forecasts, current prices, advice), say in one sentence what the desk can answer instead.
9. You cannot change the panel or run the pipeline. You may have two live Qloo tools. live_brand_trends resolves a brand and pulls its recent weekly percentile path; use it for a name outside the book or when asked whether Qloo still knows a brand. live_cultural_beta re-pulls a priced name's sub-sector basket and re-runs the same estimator at inference; use it when asked whether a number is reproducible now. At most ONE live tool call per answer, and only when the committed tools cannot answer. If a live tool returns an error, say the live read is unavailable and answer from the panel. Never present a live single-name |t| as significant: book-wide Benjamini-Hochberg q cannot be re-derived for one name.`;


const pct = (v, d = 1) => v == null ? null : Number((v * 100).toFixed(d));
const num = (v, d = 2) => v == null ? null : Number(v.toFixed(d));

function tool(name, description, properties, required, run) {
  return {
    def: { type: "function", function: { name, description, parameters: { type: "object", properties, required } } },
    run,
  };
}

function rowBrief(r) {
  return {
    ticker: r.ticker,
    label: r.label,
    sector: r.sectorLabel ?? r.sector ?? null,
    status: r.status,
    flagged: r.status === "ok" ? Boolean(r.flagged) : null,
    culturalBeta: r.status === "ok" ? num(r.culturalBeta, 2) : null,
    culturalT: r.status === "ok" ? num(r.culturalT, 2) : null,
    culturalQ: r.status === "ok" ? num(r.culturalQ, 3) : null,
  };
}

function flagReason(r, sc) {
  if (r.status !== "ok") return r.note ?? "not priced with a cultural beta";
  if (r.flagged) return "negative cultural beta, |t| >= 2, Benjamini-Hochberg q <= 0.10";
  if (sc && sc.testable === false) return `not flagged; the held-out slice is frozen at this vintage (last Qloo revision ${sc.lastMove}), so the flag rule cannot complete`;
  return "not flagged: does not meet negative beta with |t| >= 2 at q <= 0.10, or did not hold out of sample";
}

export function createDeskTools({ desk, series }) {
  if (!desk || !Array.isArray(desk.rows)) throw new Error("createDeskTools needs a desk with rows");
  const seriesBook = series && typeof series === "object" ? series : {};
  const sc = desk.valueAdd?.oos?.scoring ?? null;
  const byTicker = new Map(desk.rows.map((r) => [String(r.ticker).toUpperCase(), r]));
  const find = (ticker) => byTicker.get(String(ticker ?? "").trim().toUpperCase());

  const tools = new Map();

  tools.set("desk_summary", tool(
    "desk_summary",
    "Window, coverage, the flag rule, the book-level headline numbers, and whether the held-out slice can test anything. Call this before a book-wide answer.",
    {},
    [],
    () => {
      const priced = desk.rows.filter((r) => r.status === "ok");
      const unresolved = desk.universe?.unresolved ?? [];
      return {
        window: { start: desk.window.start, end: desk.window.end, weeks: desk.window.weeks },
        index: desk.index?.ticker ?? "SPY",
        coverage: {
          names: desk.rows.length,
          priced: priced.length,
          resolvedQloo: desk.universe?.resolved ?? null,
          unresolved: unresolved.length,
        },
        flagRule: desk.flagRule,
        flagged: priced.filter((r) => r.flagged).length,
        book: {
          meanDeltaR2Pts: pct(desk.valueAdd?.meanDeltaR2, 2),
          placeboP: num(desk.valueAdd?.placebo?.p, 3),
          weekPermutationP: num(desk.valueAdd?.permutation?.p, 3),
          blockPermutationP: num(desk.valueAdd?.permutation?.pBlocked, 3),
          outOfSample: {
            trainWeeks: desk.valueAdd?.oos?.trainWeeks ?? null,
            testWeeks: desk.valueAdd?.oos?.testWeeks ?? null,
            testable: sc ? sc.testable !== false : null,
            lastQlooRevision: sc?.lastMove ?? null,
            frozenScoredWeeks: sc?.frozenWeeks ?? null,
            frozenAfterWindow: sc?.frozenAfterWindow ?? null,
          },
          dispersionReadsAs: desk.valueAdd?.dispersion?.readsAs ?? null,
          dispersionPowerAtObservedSpread: desk.valueAdd?.dispersion?.powerObserved ?? null,
        },
        factorConstruction: desk.factorConstruction?.method ?? desk.factorConstruction?.note ?? null,
        caveat: sc && sc.testable === false
          ? `All ${sc.testWeeks} scored weeks are frozen: no name's basket moves in the scored slice, so the held-out test has no power at any effect size.`
          : null,
      };
    },
  ));

  tools.set("search_book", tool(
    "search_book",
    "Find holdings by ticker, label, sub-sector or flag state. Returns at most 15 rows.",
    {
      query: { type: "string", description: "Ticker, company name, or sub-sector label" },
      sector: { type: "string", description: "Sub-sector id or label (e.g. media, beauty)" },
      flagged: { type: "boolean", description: "Only flagged (true) or only unflagged (false)" },
    },
    [],
    ({ query, sector, flagged } = {}) => {
      const q = String(query ?? "").trim().toLowerCase();
      const s = String(sector ?? "").trim().toLowerCase();
      let rows = desk.rows;
      if (q) rows = rows.filter((r) => String(r.ticker).toLowerCase() === q || String(r.label).toLowerCase().includes(q) || String(r.sector ?? "").toLowerCase() === q || String(r.sectorLabel ?? "").toLowerCase().includes(q));
      if (s) rows = rows.filter((r) => String(r.sector ?? "").toLowerCase() === s || String(r.sectorLabel ?? "").toLowerCase().includes(s));
      if (typeof flagged === "boolean") rows = rows.filter((r) => Boolean(r.flagged) === flagged);
      const out = rows.slice(0, 15).map(rowBrief);
      return { matches: rows.length, shown: out.length, rows: out, note: rows.length > out.length ? "Narrow the query; only the first 15 are shown." : null };
    },
  ));

  tools.set("get_holding", tool(
    "get_holding",
    "The full reading for one holding: market and cultural betas with errors, ΔR², intervals, flag state and reason.",
    { ticker: { type: "string", description: "Ticker, e.g. DIS" } },
    ["ticker"],
    ({ ticker } = {}) => {
      const r = find(ticker);
      if (!r) return { error: `not in the book: ${ticker ?? "(missing ticker)"}`, hint: "search_book can check the ticker" };
      const ok = r.status === "ok";
      return {
        ticker: r.ticker,
        label: r.label,
        sector: r.sectorLabel ?? r.sector,
        status: r.status,
        windowWeeks: r.weeks ?? null,
        activeWeeks: r.activeWeeks ?? null,
        market: ok ? { beta: num(r.marketBeta, 3), se: num(r.marketSE, 3), t: num(r.marketT, 2) } : null,
        cultural: ok ? { beta: num(r.culturalBeta, 2), se: num(r.culturalSE, 2), t: num(r.culturalT, 2), p: num(r.culturalP, 4), bhQ: num(r.culturalQ, 3) } : null,
        r2: ok ? num(r.r2, 4) : null,
        r2Market: ok ? num(r.r2Market, 4) : null,
        deltaR2: ok ? num(r.deltaR2, 4) : null,
        outOfSample: ok && r.oos ? {
          deltaR2: num(r.oos.deltaR2, 4),
          testWeeks: r.oos.testWeeks,
          testable: sc ? sc.testable !== false : null,
          ci90Fixed: [pct(r.oosFixed?.lo, 2), pct(r.oosFixed?.hi, 2)],
          ci90Refit: [pct(r.oosRefit?.lo, 2), pct(r.oosRefit?.hi, 2)],
          claimInterval: (r.oosRefit?.hi - r.oosRefit?.lo) > (r.oosFixed?.hi - r.oosFixed?.lo) ? "refit per draw" : "fixed coefficients",
        } : null,
        flagged: ok ? Boolean(r.flagged) : null,
        flagReason: flagReason(r, sc),
        basketScope: r.basketScope ?? null,
        note: r.note ?? null,
        provenance: r.provenance?.entity ?? null,
      };
    },
  ));

  tools.set("get_basket", tool(
    "get_basket",
    "The taste basket a holding is priced against: members, types, weights and Qloo affinities.",
    { ticker: { type: "string", description: "Ticker, e.g. DIS" } },
    ["ticker"],
    ({ ticker } = {}) => {
      const r = find(ticker);
      if (!r) return { error: `not in the book: ${ticker ?? "(missing ticker)"}` };
      const members = (r.basket ?? []).map((m) => ({ name: m.name, type: m.type, weight: num(m.weight, 4), affinity: num(m.affinity, 4) }));
      return {
        ticker: r.ticker,
        scope: r.basketScope,
        members,
        audienceBasket: r.audience ? { beta: num(r.audience.culturalBeta, 2), t: num(r.audience.culturalT, 2), members: (r.audience.members ?? []).slice(0, 8).map((m) => ({ name: m.name, type: m.type, weight: num(m.weight, 4) })) } : null,
        construction: "one basket per sub-sector, from Qloo recommend signalled by up to ten resolved entities of that sector; every name in the book is excluded by id and by normalised name",
      };
    },
  ));

  tools.set("get_taste_series", tool(
    "get_taste_series",
    "A compact view of the weekly taste-basket return series, when the weekly cache exists for this name (the seven featured names).",
    { ticker: { type: "string", description: "Ticker, e.g. DIS" } },
    ["ticker"],
    ({ ticker } = {}) => {
      const t = String(ticker ?? "").toUpperCase();
      const s = seriesBook[t];
      if (!s || !Array.isArray(s.basket)) return { ticker: t, available: false, reason: "the weekly basket series is cached for the seven featured names only; the holding's active-week count is the available summary" };
      const dates = s.dates ?? [];
      const nz = s.basket.map((v, i) => ({ date: dates[i] ?? null, r: v })).filter((p) => Math.abs(p.r) > 1e-12);
      const mean = s.basket.reduce((a, b) => a + b, 0) / s.basket.length;
      const sd = Math.sqrt(s.basket.reduce((a, b) => a + (b - mean) ** 2, 0) / s.basket.length);
      return {
        ticker: t,
        available: true,
        weeks: s.basket.length,
        nonZeroWeeks: nz.length,
        firstMove: nz[0]?.date ?? null,
        lastMove: nz[nz.length - 1]?.date ?? null,
        meanWeekly: num(mean, 6),
        sdWeekly: num(sd, 6),
        recentMoves: nz.slice(-8).map((p) => ({ date: p.date, r: num(p.r, 6) })),
        note: "these are the basket's weekly log returns; zero weeks are Qloo's carry-forward, not a flat basket",
      };
    },
  ));

  tools.set("get_nulls", tool(
    "get_nulls",
    "The book-level falsification tests: rotation placebo, week and block permutation, out-of-sample scoring, dispersion with its power curve, peer ablation and sentiment control.",
    {},
    [],
    () => {
      const va = desk.valueAdd ?? {};
      const d = va.dispersion ?? {};
      return {
        placebo: va.placebo ? { realPts: pct(va.placebo.real, 2), p: num(va.placebo.p, 3), nullMeanPts: pct(va.placebo.placeboMean, 2), p95Pts: pct(va.placebo.placeboP95, 2), draws: va.placebo.draws } : null,
        weekPermutation: va.permutation ? { p: num(va.permutation.p, 3), blockWeeks: va.permutation.blockWeeks, pBlocked: num(va.permutation.pBlocked, 3), nullMeanPts: pct(va.permutation.placeboMean, 2) } : null,
        outOfSample: va.oos ? {
          trainWeeks: va.oos.trainWeeks, testWeeks: va.oos.testWeeks,
          meanDeltaR2Pts: pct(va.oos.meanDeltaR2, 2),
          ci90FixedPts: [pct(va.oos.ci90?.[0], 2), pct(va.oos.ci90?.[1], 2)],
          ci90RefitPts: [pct(va.oos.refit?.ci90?.[0], 2), pct(va.oos.refit?.ci90?.[1], 2)],
          testable: va.oos.scoring ? va.oos.scoring.testable !== false : null,
          lastQlooRevision: va.oos.scoring?.lastMove ?? null,
          cadenceDiagnostic: va.oos.cadence ? { weeks: va.oos.cadence.weeks, medianDeltaR2Pts: pct(va.oos.cadence.median, 2), sharePositive: va.oos.cadence.sharePositive, note: va.oos.cadence.note } : null,
        } : null,
        dispersion: va.dispersion ? {
          variance: Math.round(d.variance), samplingVariance: Math.round(d.samplingVariance),
          nullMean: Math.round(d.nullMean), p: num(d.p, 3), pLow: num(d.pLow, 3), readsAs: d.readsAs,
          observedSd: num(d.observedSd, 1), powerAtObservedSpread: d.powerObserved,
          powerCurve: (d.power ?? []).map((x) => ({ sd: x.sd, power: x.power })),
          note: d.note,
        } : null,
        peerAblation: va.ablation ? {
          inSamplePts: pct(va.ablation.oos?.meanTasteExtraR2, 2),
          testable: va.ablation.scoring ? va.ablation.scoring.testable !== false : null,
          note: "taste against the equal-weight weekly return of the other names in the same sub-sector; the peer control uses no Qloo data",
        } : null,
        sentiment: va.sentiment ? { extraR2Pts: pct(va.sentiment.oos?.meanTasteExtraR2, 2), meanCorr: num(va.sentiment.meanCorr, 3), note: "University of Michigan consumer sentiment, monthly change carried on the weeks inside each month" } : null,
        secondWindow: va.secondarySkip ?? (va.secondary ? "computed" : null),
        maxOfPRule: "a positive claim must clear Rotation, week permutation and block permutation; the friendliest p is never used alone",
      };
    },
  ));

  tools.set("get_provenance", tool(
    "get_provenance",
    "Where one holding's numbers come from: the Qloo entity, the request that built its basket, and the cached response files.",
    { ticker: { type: "string", description: "Ticker, e.g. DIS" } },
    ["ticker"],
    ({ ticker } = {}) => {
      const r = find(ticker);
      if (!r) return { error: `not in the book: ${ticker ?? "(missing ticker)"}` };
      const p = r.provenance ?? {};
      return {
        ticker: r.ticker,
        qlooEntityId: r.qlooEntityId ?? null,
        prices: p.prices ?? null,
        tasteSeries: p.series ?? null,
        basketResponse: p.basket ?? null,
        entitySearchResponse: p.entity ?? null,
        request: p.qlooRequest ?? null,
        note: "every request went through the official @qloo/qloo-harness CLI against the hackathon endpoint",
      };
    },
  ));

  return tools;
}

export function readProviders(env = process.env) {
  const out = [];
  const add = (base, key, model, label) => {
    const b = String(base ?? "").trim().replace(/\/+$/, "");
    const k = String(key ?? "").trim();
    const m = String(model ?? "").trim();
    if (b && k && m) out.push({ label: String(label ?? "").trim() || `provider ${out.length + 1}`, baseUrl: b, apiKey: k, model: m, timeoutMs: 60000 });
  };
  add(env.AGENT_BASE_URL, env.AGENT_API_KEY, env.AGENT_MODEL, env.AGENT_LABEL);
  for (let i = 1; i <= 3; i++) {
    add(env[`AGENT_FALLBACK_${i}_BASE_URL`], env[`AGENT_FALLBACK_${i}_API_KEY`], env[`AGENT_FALLBACK_${i}_MODEL`], env[`AGENT_FALLBACK_${i}_LABEL`]);
  }
  return out;
}

export function toolDefs(tools) {
  return [...tools.values()].map((t) => t.def);
}

const RETRYABLE = new Set([429]);

async function chat(provider, messages, fetchImpl, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetchImpl(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({ model: provider.model, temperature: 0.2, max_tokens: 2000, tools: messages.tools, tool_choice: "auto", messages: messages.msgs }),
      signal: AbortSignal.timeout(provider.timeoutMs ?? 60000),
    });
    if (res.ok || attempt >= 1 || !RETRYABLE.has(res.status)) break;
    // Providers rate-limit per minute; one backoff beats dropping to the fallback.
    const after = Number(res.headers?.get?.("retry-after"));
    const wait = Number.isFinite(after) ? Math.min(Math.max(after, 0) * 1000, 8000) : 2000;
    await sleep(wait);
  }
  if (!res.ok) {
    const detail = await res.text?.().catch?.(() => "") ?? "";
    const e = new Error(`provider HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 200)}` : ""}`);
    e.code = `MODEL_HTTP_${res.status}`;
    throw e;
  }
  const j = await res.json();
  const msg = j?.choices?.[0]?.message;
  if (!msg) {
    const e = new Error("provider returned no message");
    e.code = "MODEL_EMPTY";
    throw e;
  }
  return msg;
}

async function runTool(tools, name, args) {
  const t = tools.get(name);
  if (!t) return { error: `unknown tool: ${name}` };
  try {
    const out = await t.run(args ?? {});
    return out === undefined ? { error: `tool ${name} returned nothing` } : out;
  } catch (e) {
    return { error: `tool ${name} failed: ${e.message}` };
  }
}

async function runProvider(provider, question, tools, fetchImpl, limits) {
  const defs = toolDefs(tools);
  const msgs = [{ role: "system", content: SYSTEM }, { role: "user", content: question }];
  const trace = [];
  let calls = 0;
  for (let round = 0; round < limits.maxRounds; round++) {
    const msg = await chat(provider, { tools: defs, msgs }, fetchImpl);
    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    if (toolCalls.length) {
      msgs.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });
      for (const c of toolCalls) {
        const name = c.function?.name ?? "";
        let args = {};
        try { args = JSON.parse(c.function?.arguments || "{}"); } catch { args = {}; }
        let result;
        if (calls >= limits.maxToolCalls) {
          result = { error: "tool budget exhausted; answer with the evidence already returned" };
        } else {
          calls++;
          result = await runTool(tools, name, args);
        }
        const text = JSON.stringify(result);
        trace.push({ name, args, ok: !result?.error, result });
        msgs.push({ role: "tool", tool_call_id: c.id ?? `call_${trace.length}`, content: text.slice(0, limits.toolChars) });
      }
      continue;
    }
    const raw = String(msg.content ?? "").trim();
    // Reasoning models sometimes put their scratchpad in content. It is not the answer.
    const answer = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim() || raw;
    if (!answer) {
      const e = new Error("provider returned an empty answer");
      e.code = "MODEL_EMPTY_ANSWER";
      throw e;
    }
    return { answer: answer.slice(0, limits.answerChars), trace, provider: provider.label, model: provider.model, rounds: round + 1, toolCalls: calls, grounded: true };
  }
  const e = new Error("the model kept calling tools and never answered");
  e.code = "NO_FINAL_ANSWER";
  throw e;
}

export async function askQuestion({ question, tools, providers, fetchImpl = fetch, limits = {} }) {
  const L = { ...LIMITS, ...limits };
  const q = String(question ?? "").trim();
  if (!q) { const e = new Error("empty question"); e.code = "EMPTY_QUESTION"; throw e; }
  if (q.length > L.maxQuestionChars) { const e = new Error(`question longer than ${L.maxQuestionChars} characters`); e.code = "QUESTION_TOO_LONG"; throw e; }
  if (!providers?.length) { const e = new Error("no analyst model configured"); e.code = "AGENT_NOT_CONFIGURED"; throw e; }
  const failures = [];
  for (const p of providers) {
    try {
      tools.liveReset?.();
      const out = await runProvider(p, q, tools, fetchImpl, L);
      return { ...out, failures };
    } catch (e) {
      failures.push(`${p.label}: ${e.code ?? e.message}`);
    }
  }
  const e = new Error("every analyst provider failed");
  e.code = "AGENT_UNAVAILABLE";
  e.details = failures;
  throw e;
}
