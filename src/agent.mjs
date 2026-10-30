// The analyst agent. The estimator has no model in it; this is the layer that
// explains the committed panel. Every tool is read-only over output/desk.json and
// output/series.json, plus the two committed analyses in output/mde.json and
// output/basket-sensitivity.json, so a question cannot spend a Qloo request or move
// a number.
//
// The model is configured entirely from the environment (AGENT_* and optional
// AGENT_FALLBACK_n_*). There is no provider, endpoint or key in this file.

import { cleanAnswer } from "./answer.mjs";

export const LIMITS = { maxToolCalls: 6, maxRounds: 3, maxQuestionChars: 400, toolChars: 7000, answerChars: 6000 };
// The desk asks for 180 words; the rest of the budget is the model's own scratchpad,
// and an uncapped one is what turns a 40 s ask into a 90 s one.
const MAX_COMPLETION_TOKENS = 1200;
// One HTTP call, one provider's whole attempt, and the whole chain. Measured on the
// deployed host 2026-10-30: a live reasoning model needs ~11 s per round, the 120B
// primary never answered in 30 s, and a rate-limited fallback answers in 1 s. Without
// these bounds a dead model cost 60 s per ask before the next one was tried.
export const PROVIDER_TIMEOUT_MS = 25000;
export const PROVIDER_DEADLINE_MS = 55000;
export const ASK_DEADLINE_MS = 100000;

const SYSTEM = `You are the analyst interface to the Cultural Beta desk, a research instrument that prices US consumer stocks against two factors: the market (SPY) and a taste basket built from Qloo's trending data for each sub-sector.

Rules, in order of importance:
1. Never state a number that is not in a tool result. If you need one, call a tool.
2. This is not investment advice. Never recommend buying, selling, shorting, hedging or sizing a position. You describe measured exposure and its uncertainty.
3. The desk's held-out slice may be frozen at this Qloo vintage. Check desk_summary before describing any out-of-sample result. If testable is false, say the held-out test is empty / in-sample at this vintage, and never describe a null result as evidence that taste has no effect. When asked whether that null means anything, call get_detectability and quote its detectable-effect bound and its basket-construction verdict; never reason about power or robustness from the flag count alone.
4. If a ticker is not in the book, say so. Never substitute a similar name or invent a row.
5. Keep in-sample association, out-of-sample evidence, point estimates and intervals distinct. A beta with a wide interval is a reading, not a ranking. Never call a per-name result "significant" without its Benjamini-Hochberg q: if q > 0.10, say it does not survive the book-wide correction, even when its p is small.
6. The numbers are Qloo-derived. When asked where one comes from, call get_provenance and name the request type and the cached response. The desk prints a server-side Qloo freshness attestation and a per-answer receipt with every answer, whether or not you asked for one: never claim the data is current or stale yourself — that attestation is the record of it.
7. Answer in at most 180 words of plain prose. No markdown tables, headings or bullet lists. Lead with the answer, then the qualification a careful reader needs. Write only the answer: no scratchpad, no reasoning tags, no preamble about what you are about to do — anything outside the answer is stripped before a reader sees it.
8. For any widest, narrowest, largest, smallest or strongest question, call rank_holdings and answer from its ranked rows and stated units. Never choose the name yourself from rows you happened to read: two runs would then disagree.
9. If the question is outside the desk (forecasts, current prices, advice), say in one sentence what the desk can answer instead.
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

export function createDeskTools({ desk, series, mde = null, basketSensitivity = null }) {
  if (!desk || !Array.isArray(desk.rows)) throw new Error("createDeskTools needs a desk with rows");
  const seriesBook = series && typeof series === "object" ? series : {};
  const sc = desk.valueAdd?.oos?.scoring ?? null;
  const byTicker = new Map(desk.rows.map((r) => [String(r.ticker).toUpperCase(), r]));
  const find = (ticker) => byTicker.get(String(ticker ?? "").trim().toUpperCase());
  const findNamed = (rows, ticker) => (rows ?? []).find((r) => String(r.ticker).toUpperCase() === String(ticker ?? "").trim().toUpperCase());

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

  // "Which name has the widest interval" is the question a judge asks first, and every
  // model answered it from whichever row it happened to read. This ranks the book by a
  // stated quantity instead, so the answer is the same for every model and every run.
  tools.set("rank_holdings", tool(
    "rank_holdings",
    "Rank priced holdings by one stated quantity. Use this for any widest / narrowest / largest / smallest / strongest question instead of picking a name yourself. Returns the top rows with the exact quantity and its units.",
    {
      metric: {
        type: "string",
        enum: ["ci90_width_slope", "abs_cultural_beta", "abs_cultural_t", "delta_r2", "oos_ci90_width"],
        description: "ci90_width_slope: width of culturalBeta +/- 1.645*SE in slope units (in-sample). abs_cultural_beta and abs_cultural_t: magnitude. delta_r2: in-sample increment over the market-only fit. oos_ci90_width: width of the fixed-coefficient held-out interval in R^2 points.",
      },
      limit: { type: "integer", description: "How many rows to return, default 5, max 10" },
      sector: { type: "string", description: "Optional sub-sector id or label" },
    },
    ["metric"],
    ({ metric = "ci90_width_slope", limit = 5, sector } = {}) => {
      const ok = desk.rows.filter((r) => r.status === "ok" && Number.isFinite(r.culturalBeta) && Number.isFinite(r.culturalSE));
      const s = String(sector ?? "").trim().toLowerCase();
      const rows = s ? ok.filter((r) => String(r.sector ?? "").toLowerCase() === s || String(r.sectorLabel ?? "").toLowerCase().includes(s)) : ok;
      const value = (r) => {
        switch (metric) {
          case "ci90_width_slope": return 2 * 1.6449 * r.culturalSE;
          case "abs_cultural_beta": return Math.abs(r.culturalBeta);
          case "abs_cultural_t": return Math.abs(r.culturalT);
          case "delta_r2": return r.deltaR2;
          case "oos_ci90_width": return Number.isFinite(r.oosFixed?.lo) && Number.isFinite(r.oosFixed?.hi) ? r.oosFixed.hi - r.oosFixed.lo : null;
          default: return null;
        }
      };
      if (value(rows[0] ?? {}) === null && metric !== "delta_r2") return { error: `unknown metric: ${metric}`, allowed: ["ci90_width_slope", "abs_cultural_beta", "abs_cultural_t", "delta_r2", "oos_ci90_width"] };
      const n = Math.max(1, Math.min(10, Number.isInteger(limit) ? limit : 5));
      const scored = rows.map((r) => ({ r, v: value(r) })).filter((x) => Number.isFinite(x.v)).sort((a, b) => b.v - a.v);
      if (!scored.length) return { error: `no priced name has ${metric}${s ? ` in ${sector}` : ""}` };
      const units = {
        ci90_width_slope: "slope units (the interval is culturalBeta +/- 1.645*SE, in sample)",
        abs_cultural_beta: "slope units",
        abs_cultural_t: "t-statistic",
        delta_r2: "R^2 points (in sample)",
        oos_ci90_width: "R^2 points (held-out, fixed coefficients)",
      }[metric];
      return {
        metric,
        units,
        universe: rows.length,
        ranked: scored.slice(0, n).map(({ r, v }) => ({
          ticker: r.ticker,
          label: r.label,
          sector: r.sectorLabel ?? r.sector,
          value: num(v, metric === "ci90_width_slope" ? 2 : 3),
          culturalBeta: num(r.culturalBeta, 2),
          culturalSE: num(r.culturalSE, 2),
          culturalT: num(r.culturalT, 2),
          bhQ: num(r.culturalQ, 3),
          activeWeeks: r.activeWeeks ?? null,
          flagged: Boolean(r.flagged),
        })),
        note: "A wide interval is a reading, not a ranking: it says the book cannot pin the slope, not that the name is more exposed. Never present this order as a league table of cultural risk.",
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

  tools.set("get_detectability", tool(
    "get_detectability",
    "What this design could have seen, in numbers: the minimum detectable effect (the ΔR² a name would need for the pre-registered rule to flag it 80% of the time) and the basket-construction sensitivity (the same estimator re-run under seven alternative taste baskets). Call this before saying whether a null result is informative. Optional ticker gives that name's bound and its spread across baskets.",
    { ticker: { type: "string", description: "Optional ticker, e.g. DIS" } },
    [],
    ({ ticker } = {}) => {
      const missing = [];
      if (!mde) missing.push("output/mde.json");
      if (!basketSensitivity) missing.push("output/basket-sensitivity.json");
      if (missing.length === 2) return { available: false, note: `not computed on this build: ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} absent. Neither analysis is a live request — regenerate with node scripts/mde.mjs and node scripts/basket-sensitivity.mjs.` };
      const t = String(ticker ?? "").trim().toUpperCase();
      const out = { available: true, notComputed: missing.length ? missing : null };

      if (mde) {
        const b = mde.book ?? {};
        const o = b.observed ?? {};
        const s = mde.source ?? {};
        const obs = (r) => r ? {
          ticker: r.ticker, beta: num(r.beta, 2), t: num(r.t, 3), q: num(r.q, 3),
          deltaR2ObservedPts: num(r.deltaR2Pts, 2), shareOfRequiredEffect: num(r.shareOfMde, 3),
          flagProbabilityAtThatEffect: num(r.powerAtObserved, 3),
        } : null;
        out.mde = {
          question: "the smallest effect the pre-registered rule would flag with 80% probability, on each name's own design",
          design: { weeks: mde.method?.weeks ?? null, df: mde.method?.df ?? null, namesInCorrection: b.names ?? null, powerTarget: mde.method?.powerTarget ?? null, singleDiscoveryLevel: mde.method?.singleDiscoveryLevel ?? null, tCrit: num(mde.method?.tCrit, 4), requiredNoncentrality: num(mde.method?.ncpMDE, 4) },
          book: {
            deltaR2MdePts: { median: num(b.medianDeltaR2Pts, 2), iqr: [num(b.iqr?.[0], 2), num(b.iqr?.[1], 2)], min: num(b.minDeltaR2Pts, 2), max: num(b.maxDeltaR2Pts, 2) },
            medianBetaMde: num(b.medianBetaMDE, 2),
            partialR2MdePts: num(b.partialR2MDEpts, 2),
            minPartialCorrelation: num(b.minPartialCorrelation, 3),
          },
          observed: {
            meanDeltaR2Pts: num(o.meanDeltaR2Pts, 2),
            flaggedNames: o.flaggedNames ?? null,
            largestAbsT: obs(o.largestAbsT),
            largestNegativeAbsT: obs(o.largestNegativeAbsT),
            powerAtMedianObserved: num(b.powerAtMedianObserved, 4),
          },
          weeksNeededFor80PercentDetection: (mde.designRequirement?.rows ?? []).map((r) => ({ effectPts: num(r.deltaR2Pts, 2), weeks: r.weeks, years: r.years, multipleOfThisPanel: r.multipleOfCurrentPanel, label: r.label })),
          heldOutSlice: mde.frozenSlice ? { computable: mde.frozenSlice.computable, scoredWeeks: mde.frozenSlice.weeks, nonzeroRegressorWeeks: mde.frozenSlice.nonzeroRegressorWeeks, reason: mde.frozenSlice.reason } : null,
          simulatedVsAnalytic: (mde.simulation?.analyticVsSimulated ?? []).map((r) => ({ alternative: r.alternative, analytic: num(r.analytic, 4), iidSimulated: num(r.iid, 4), blockSimulated: num(r.block, 4), draws: r.draws })),
          postHoc: (mde.method?.postHocFields ?? []).length ? `the informative-sub-period cut and the design-requirement effect grid are post-hoc; the split and the flag rule were pre-registered` : null,
          provenance: {
            file: "output/mde.json", generatedAt: mde.generatedAt ?? null, panelRevision: s.deskRevision ?? null,
            panelWindow: s.deskWindow ?? null, rebuiltDesignsMatchingPublishedFit: s.integrity?.rebuiltDesignsMatchPublishedFit ?? null,
            qlooRequestsMade: s.qlooRequests ?? null, note: "re-derived from the committed panel and cached responses; no new Qloo request",
          },
        };
        if (t) {
          const r = findNamed(mde.perName, t);
          out.mde.forTicker = r ? {
            ticker: r.ticker, se: num(r.se, 2), betaMde: num(r.betaMDE, 2), deltaR2MdePts: num(r.deltaR2MDEpts, 2),
            marketR2: num(r.marketR2, 3), observedDeltaR2Pts: num(r.observed?.deltaR2Pts, 2), observedT: num(r.observed?.t, 3),
            observedAbsTvsRequired: num(r.observed?.absTvsNcpMDE, 3), powerAtObserved: num(r.observed?.powerAtObserved, 4),
          } : `not in the priced book: ${t}`;
        }
      }

      if (basketSensitivity) {
        const bs = basketSensitivity;
        out.basketSensitivity = {
          question: "does the null survive the basket construction? same estimator, same 102-week cut calendar, only the construction varies",
          gate: { reproducedCommittedPanel: bs.gate?.reproduced ?? null, namesChecked: bs.gate?.namesChecked ?? null, maxAbsDBetaVsDesk: bs.gate?.maxAbsDBetaVsDesk ?? null, maxAbsDTVsDesk: bs.gate?.maxAbsDTVsDesk ?? null },
          constructions: (bs.constructions ?? []).map((c) => ({ id: c.id, label: c.label })),
          coverage: Object.fromEntries(Object.entries(bs.coverage ?? {}).map(([k, v]) => [k, { fitted: v.fitted, degenerate: v.degenerate ?? 0, medianWeeksUsed: v.medianWeeksUsed ?? null }])),
          vsCommitted: Object.fromEntries(Object.entries(bs.comparisons ?? {}).map(([k, v]) => [k, {
            medianAbsDBeta: num(v.medianAbsDBeta, 2), p90AbsDBeta: num(v.p90AbsDBeta, 2),
            medianAbsDT: num(v.medianAbsDT, 3), p90AbsDT: num(v.p90AbsDT, 3), maxAbsDT: num(v.maxAbsDT, 3),
            spearmanOfBeta: num(v.rankCorrSpearman, 3), pearsonOfBeta: num(v.rankCorrPearson, 3),
            clearsScreenBeforeBh: (v.screenPassesBeforeBH ?? []).map((s) => ({ ticker: s.ticker, t: num(s.t, 2), q: num(s.q, 3) })),
            flaggedAfterBh: v.flaggedVariant ?? [], flagFlips: v.flagFlips ?? [],
          }])),
          verdict: {
            namesFlaggedUnderCommittedBasket: bs.totals?.baselineFlagged?.length ?? null,
            namesFlaggedUnderAnyBasket: bs.totals?.someConstructionFlagsAName ?? null,
            flagFlipsAcrossAllVariants: bs.totals?.flipsAcrossAllVariants?.length ?? null,
            reading: "the inference is construction-insensitive (no construction flags a name at q <= 0.10); the per-name beta magnitude is construction-dependent",
          },
          provenance: {
            file: "output/basket-sensitivity.json", qlooRequestsMade: bs.provenance?.qlooRequestsMade ?? null,
            cacheFilesRead: (bs.provenance?.cacheFilesRead ?? []).length, window: bs.window ?? null,
            method: bs.provenance?.method ?? null,
          },
        };
        if (t) {
          const r = findNamed(bs.perName, t);
          out.basketSensitivity.forTicker = r ? {
            ticker: r.ticker, committedBeta: num(r.committedBeta, 2), committedT: num(r.committedT, 2),
            variants: Object.fromEntries(Object.entries(r).filter(([k]) => k !== "ticker" && k !== "sector" && !k.startsWith("committed") && k !== "baseline")
              .map(([k, v]) => [k, { beta: num(v?.beta, 2), t: num(v?.t, 2), q: num(v?.q, 3), flagged: v?.flagged ?? null, status: v?.status ?? null }])),
          } : `not in the priced book: ${t}`;
        }
      }
      return out;
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

/* ---------- per-answer Qloo receipts ---------- */
// A reader of an answer is owed the provenance of what they just read, so every
// answer carries it: the live calls with the harness's own correlation ids, and for
// the committed panel the cached response file plus the request that produced it.
// Only file names, entity ids, operations and timestamps go in — never a key, and
// never the contents of a cache file, which is why fixtures/qloo stays out of the
// payload by construction.
const RECEIPT_TICKER_TOOLS = new Set(["get_holding", "get_basket", "get_taste_series", "get_provenance"]);
const RECEIPT_MAX_ROWS = 6;

export function redactSecrets(value, env = process.env) {
  const secrets = [
    env.QLOO_API_KEY, env.AGENT_API_KEY,
    env.AGENT_FALLBACK_1_API_KEY, env.AGENT_FALLBACK_2_API_KEY, env.AGENT_FALLBACK_3_API_KEY,
  ].map((s) => String(s ?? "").trim()).filter((s) => s.length >= 8);
  const clean = (v, depth = 0) => {
    if (depth > 6 || v == null) return v ?? null;
    if (typeof v === "string") return secrets.some((s) => v.includes(s)) ? "[redacted]" : v.slice(0, 300);
    if (typeof v === "number" || typeof v === "boolean") return v;
    if (Array.isArray(v)) return v.slice(0, 24).map((x) => clean(x, depth + 1));
    if (typeof v === "object") {
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        if (/key|token|secret|authorization|bearer|env/i.test(k)) continue;
        out[k] = clean(x, depth + 1);
      }
      return out;
    }
    return String(v).slice(0, 300);
  };
  return clean(value);
}

function committedReceipt(row, tool) {
  const p = row.provenance ?? {};
  const req = p.qlooRequest ?? null;
  return {
    kind: "committed",
    tools: [tool],
    ticker: row.ticker,
    label: row.label ?? null,
    status: row.status ?? null,
    entity: row.qlooEntityId ?? req?.entity ?? null,
    basketScope: row.basketScope ?? null,
    files: [p.entity, p.basket, p.series, p.prices].filter(Boolean),
    request: req ? { operation: req.operation ?? null, path: req.path ?? null, types: req.types ?? null, signals: (req.signals ?? []).slice(0, 10) } : null,
  };
}

export function collectReceipts({ desk, revision = null, trace = [], freshness = null } = {}) {
  const receipts = [];
  if (freshness) {
    const receipt = {
      kind: "freshness",
      checked: Boolean(freshness.checked),
      why: freshness.checked ? null : freshness.why ?? "unknown",
      operation: freshness.operation ?? "exec trends",
      entity: freshness.entity?.id ?? null,
      entityName: freshness.entity?.name ?? null,
      entityType: freshness.entity?.type ?? null,
      requestedAt: freshness.requestedAt ?? freshness.at ?? null,
      respondedAt: freshness.respondedAt ?? null,
      fromCachedPage: Boolean(freshness.fromCachedPage),
      requests: freshness.requests ?? 0,
      correlationIds: freshness.correlationIds ?? [],
      files: freshness.files ?? [],
      fromAttestationCache: Boolean(freshness.fromCache),
      attestationCacheSeconds: freshness.cachedSeconds ?? null,
    };
    // A reading only exists if a Qloo page actually answered, so a failed check cannot
    // even put a null-shaped date field in front of a renderer to guess at.
    if (receipt.checked) {
      receipt.cachedResponseFetchedAt = freshness.cachedResponseFetchedAt ?? null;
      receipt.verdict = freshness.verdict ?? null;
      receipt.latestWeek = freshness.latestWeek ?? null;
      receipt.latestRevision = freshness.latestRevision ?? null;
      receipt.panel = freshness.panel ?? null;
    }
    receipts.push(receipt);
  }
  for (const step of trace) {
    const res = step?.result ?? {};
    if (!res.qloo) continue;
    receipts.push({
      kind: "live",
      tools: [step.name],
      operation: res.qloo.operation ?? "exec trends",
      entity: res.entity?.id ?? res.ticker ?? null,
      entities: res.qloo.entities ?? [],
      correlationIds: res.qloo.correlationIds ?? [],
      requestedAt: res.qloo.requestedAt ?? null,
      requests: res.qloo.requests ?? 0,
      pages: res.qloo.pages ?? null,
      replayedPages: res.qloo.replayedPages ?? null,
      files: res.qloo.files ?? [],
      window: res.window ?? null,
    });
  }
  const byTicker = new Map((desk?.rows ?? []).map((r) => [String(r.ticker).toUpperCase(), r]));
  const seen = new Map();
  for (const step of trace) {
    const tool = step?.name ?? "";
    if (!RECEIPT_TICKER_TOOLS.has(tool)) continue;
    const ticker = String(step.args?.ticker ?? step.result?.ticker ?? "").toUpperCase();
    const row = byTicker.get(ticker);
    if (!row) continue;
    const existing = seen.get(ticker);
    if (existing) {
      if (!existing.tools.includes(tool)) existing.tools.push(tool);
      continue;
    }
    const receipt = committedReceipt(row, tool);
    seen.set(ticker, receipt);
    receipts.push(receipt);
  }
  const panel = { kind: "panel", file: "output/desk.json", revision, rows: desk?.rows?.length ?? null, window: desk?.window ? { start: desk.window.start, end: desk.window.end, weeks: desk.window.weeks } : null };
  const live = receipts.filter((r) => r.kind !== "panel");
  const committed = live.filter((r) => r.kind === "committed").slice(0, RECEIPT_MAX_ROWS);
  return redactSecrets([panel, ...live.filter((r) => r.kind !== "committed"), ...committed]);
}

export function readProviders(env = process.env) {
  const out = [];
  const add = (base, key, model, label) => {
    const b = String(base ?? "").trim().replace(/\/+$/, "");
    const k = String(key ?? "").trim();
    const m = String(model ?? "").trim();
    if (b && k && m) out.push({ label: String(label ?? "").trim() || `provider ${out.length + 1}`, baseUrl: b, apiKey: k, model: m, timeoutMs: Number(env.AGENT_TIMEOUT_MS) || PROVIDER_TIMEOUT_MS });
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
    try {
      res = await fetchImpl(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify({ model: provider.model, temperature: 0.2, max_tokens: MAX_COMPLETION_TOKENS, tools: messages.tools, tool_choice: messages.toolChoice ?? "auto", messages: messages.msgs }),
        signal: AbortSignal.timeout(provider.timeoutMs ?? PROVIDER_TIMEOUT_MS),
      });
    } catch (e) {
      // A shared inference pool stalls for a whole call and then answers normally.
      // One retry on the same provider beats handing the question to a worse model;
      // the caller's deadline still bounds the total.
      if (attempt === 0 && e?.name === "TimeoutError") continue;
      throw e;
    }
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
  const started = Date.now();
  const deadline = limits.providerDeadlineMs ?? PROVIDER_DEADLINE_MS;
  for (let round = 0; round < limits.maxRounds; round++) {
    // The last round is an answer, not another tool call: a model that keeps
    // exploring otherwise ends in NO_FINAL_ANSWER with every fact it needed already
    // in the transcript.
    const last = round === limits.maxRounds - 1;
    // A provider that answers slowly enough to blow the deadline once will blow it on
    // every round; the chain must reach a live provider instead of timing out three
    // times on a dead one. Measured 2026-10-30: a 120B model that never answered cost
    // 60 s per ask before the fallback was tried.
    const left = deadline - (Date.now() - started);
    if (left < Math.min(2000, deadline)) {
      const e = new Error(`provider missed its ${Math.round(deadline / 1000)}s deadline`);
      e.code = "PROVIDER_DEADLINE";
      throw e;
    }
    const msgsForRound = last ? [...msgs, { role: "user", content: "Answer now from the tool results already returned. Do not call another tool." }] : msgs;
    const msg = await chat(
      { ...provider, timeoutMs: Math.min(provider.timeoutMs ?? PROVIDER_TIMEOUT_MS, left) },
      { tools: defs, msgs: msgsForRound, toolChoice: last ? "none" : "auto" },
      fetchImpl,
    );
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
    const answer = cleanAnswer(raw);
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
  const chainStart = Date.now();
  const askDeadline = L.askDeadlineMs ?? ASK_DEADLINE_MS;
  for (const p of providers) {
    const left = askDeadline - (Date.now() - chainStart);
    if (left < 5000) {
      failures.push(`${p.label}: ASK_DEADLINE`);
      break;
    }
    try {
      tools.liveReset?.();
      const out = await runProvider(p, q, tools, fetchImpl, { ...L, providerDeadlineMs: Math.min(L.providerDeadlineMs ?? PROVIDER_DEADLINE_MS, left) });
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
