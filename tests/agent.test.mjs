import test from "node:test";
import assert from "node:assert/strict";
import { createDeskTools, readProviders, askQuestion, collectReceipts, LIMITS } from "../src/agent.mjs";

const desk = {
  window: { start: "2024-10-14", end: "2026-10-26", weeks: 102 },
  index: { ticker: "SPY" },
  flagRule: "negative cultural beta, |t| >= 2, BH q <= 0.10",
  universe: { resolved: 2, unresolved: [{ ticker: "NOQ" }] },
  factorConstruction: { method: "time-series" },
  rows: [
    {
      ticker: "DIS", label: "Disney", sector: "media", sectorLabel: "Media", status: "ok",
      weeks: 102, activeWeeks: 30, marketBeta: 0.94, marketSE: 0.03, marketT: 31,
      culturalBeta: 43.81, culturalSE: 13.84, culturalT: 3.17, culturalP: 0.002, culturalQ: 0.16,
      flagged: false, deltaR2: 0.0673, r2: 0.4, r2Market: 0.36,
      oos: { deltaR2: -0.0582, testWeeks: 35 },
      oosFixed: { lo: -0.1256, hi: 0.0229 },
      oosRefit: { lo: -0.1551, hi: 0.0499 },
      basket: [{ name: "Youtube", type: "brand", weight: 0.1257, affinity: 0.9487 }],
      basketScope: "sector:media",
      qlooEntityId: "ENTITY-DIS",
      provenance: { entity: "fixtures/qloo/search-DIS.json", qlooRequest: { operation: "recommend", types: ["brand"] } },
    },
    {
      ticker: "ELF", label: "e.l.f. Beauty", sector: "beauty", sectorLabel: "Beauty", status: "ok",
      weeks: 102, activeWeeks: 25, marketBeta: 1.3, marketSE: 0.05, marketT: 26,
      culturalBeta: -8.1, culturalSE: 6.2, culturalT: -1.3, culturalP: 0.2, culturalQ: 0.6,
      flagged: false, deltaR2: 0.01, r2: 0.3, r2Market: 0.29,
      oos: { deltaR2: 0.01, testWeeks: 35 },
      basket: [], basketScope: "sector:beauty", provenance: {},
    },
    { ticker: "NOQ", label: "No Qloo Co", sector: "media", sectorLabel: "Media", status: "no Qloo entity", note: "no name match" },
  ],
  valueAdd: {
    meanDeltaR2: 0.0067173071,
    placebo: { real: 0.0067, p: 0.8977556, placeboMean: 0.0095, placeboP95: 0.0146, draws: 400 },
    permutation: { p: 0.7780548, pBlocked: 0.8304, blockWeeks: 6, placeboMean: 0.0088 },
    oos: {
      trainWeeks: 67, testWeeks: 35, meanDeltaR2: -0.0004779,
      ci90: [-0.005562, 0.002782], refit: { ci90: [-0.02124, 0.006448] },
      scoring: { testable: false, lastMove: "2025-12-22", testWeeks: 35, frozenWeeks: 35, frozenAfterWindow: 44 },
      cadence: { weeks: 58, median: -0.00487, sharePositive: 0.375, note: "diagnostic" },
    },
    dispersion: {
      variance: 805.19, samplingVariance: 1868.85, nullMean: 1352.11, p: 0.2119, pLow: 0.7905,
      readsAs: "uninformative", observedSd: 28.37, powerObserved: 0,
      power: [{ sd: 1, power: 0 }, { sd: 50, power: 1 }], note: "rotation null",
    },
    ablation: { oos: { meanTasteExtraR2: -0.004 }, scoring: { testable: false } },
    sentiment: { oos: { meanTasteExtraR2: 0.001 }, meanCorr: 0.03 },
    secondarySkip: "below the 100-week floor",
  },
};

const series = { DIS: { basket: [0.01, 0, -0.02], dates: ["2024-10-21", "2024-10-28", "2024-11-04"] } };
const tools = createDeskTools({ desk, series });

test("desk_summary carries coverage and the frozen-slice warning", () => {
  const s = tools.get("desk_summary").run();
  assert.equal(s.window.weeks, 102);
  assert.equal(s.coverage.priced, 2);
  assert.equal(s.coverage.unresolved, 1);
  assert.equal(s.book.outOfSample.testable, false);
  assert.match(s.caveat, /35 scored weeks are frozen/);
});

test("get_holding returns the row, and an unknown ticker is an error rather than a guess", () => {
  const r = tools.get("get_holding").run({ ticker: "dis" });
  assert.equal(r.ticker, "DIS");
  assert.equal(r.cultural.beta, 43.81);
  assert.equal(r.flagged, false);
  assert.match(r.flagReason, /frozen/i);
  const miss = tools.get("get_holding").run({ ticker: "TSLA" });
  assert.match(miss.error, /not in the book/);
});

test("search_book filters by sector, flag state and text", () => {
  assert.equal(tools.get("search_book").run({ sector: "media" }).matches, 2);
  assert.equal(tools.get("search_book").run({ flagged: true }).matches, 0);
  assert.equal(tools.get("search_book").run({ query: "Disney" }).rows[0].ticker, "DIS");
});

test("get_basket exposes the Qloo members and scope", () => {
  const b = tools.get("get_basket").run({ ticker: "DIS" });
  assert.equal(b.scope, "sector:media");
  assert.equal(b.members[0].name, "Youtube");
  assert.equal(b.members[0].weight, 0.1257);
});

test("get_taste_series is only available where the weekly cache exists", () => {
  const hit = tools.get("get_taste_series").run({ ticker: "DIS" });
  assert.equal(hit.available, true);
  assert.equal(hit.nonZeroWeeks, 2);
  assert.equal(hit.recentMoves.length, 2);
  const miss = tools.get("get_taste_series").run({ ticker: "ELF" });
  assert.equal(miss.available, false);
});

test("get_provenance names the entity and the request", () => {
  const p = tools.get("get_provenance").run({ ticker: "DIS" });
  assert.equal(p.qlooEntityId, "ENTITY-DIS");
  assert.equal(p.request.operation, "recommend");
});

test("get_nulls reports the three nulls and the power curve", () => {
  const n = tools.get("get_nulls").run();
  assert.equal(n.placebo.p, 0.898);
  assert.equal(n.weekPermutation.pBlocked, 0.83);
  assert.equal(n.outOfSample.testable, false);
  assert.equal(n.dispersion.powerAtObservedSpread, 0);
});

test("rank_holdings answers a widest-interval question from the book, not from memory", () => {
  const out = tools.get("rank_holdings").run({ metric: "ci90_width_slope", limit: 2 });
  // DIS: 2*1.6449*13.84 = 45.5 slope units; ELF: 2*1.6449*6.2 = 20.4; NOQ is unpriced
  assert.deepEqual(out.ranked.map((r) => r.ticker), ["DIS", "ELF"]);
  assert.equal(out.ranked[0].value, 45.53);
  assert.match(out.units, /slope units/);
  assert.match(out.note, /not a ranking/);
  assert.equal(out.universe, 2, "an unpriced name is not ranked");
  assert.match(tools.get("rank_holdings").run({ metric: "made_up" }).error, /unknown metric/);
});

/* ---------- the loop ---------- */
const provider = (label) => ({ label, baseUrl: "https://example.test/v1", apiKey: "test", model: "test-model" });
const reply = (message) => ({ ok: true, json: async () => ({ choices: [{ message }] }) });
const call = (name, args, id = "c1") => ({ role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
const final = (content) => ({ role: "assistant", content });

test("the loop executes a tool call, feeds the result back, and returns the answer", async () => {
  const queue = [reply(call("get_holding", { ticker: "DIS" })), reply(final("Disney is not flagged."))];
  const seen = [];
  const fetchImpl = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    seen.push(body.messages.at(-1));
    return queue.shift();
  };
  const out = await askQuestion({ question: "Why is Disney not flagged?", tools, providers: [provider("one")], fetchImpl });
  assert.equal(out.answer, "Disney is not flagged.");
  assert.equal(out.trace.length, 1);
  assert.equal(out.trace[0].name, "get_holding");
  assert.equal(out.toolCalls, 1);
  assert.equal(out.provider, "one");
  assert.equal(seen.at(-1).role, "tool");
  assert.match(seen.at(-1).content, /43\.81/);
});

test("an unknown tool becomes a tool error the model can recover from", async () => {
  const queue = [reply(call("drop_table", {})), reply(final("That tool does not exist."))];
  const out = await askQuestion({ question: "x", tools, providers: [provider("one")], fetchImpl: async () => queue.shift() });
  assert.equal(out.trace[0].ok, false);
  assert.match(out.trace[0].result.error, /unknown tool/);
  assert.equal(out.answer, "That tool does not exist.");
});

test("the tool budget is enforced and a model that never answers is refused", async () => {
  const fetchImpl = async () => reply(call("desk_summary", {}));
  await assert.rejects(
    askQuestion({ question: "loop", tools, providers: [provider("one")], fetchImpl, limits: { maxRounds: 2, maxToolCalls: 1 } }),
    (e) => e.code === "AGENT_UNAVAILABLE" && /NO_FINAL_ANSWER/.test(e.details.join(" ")),
  );
});

test("a failing provider falls through to the next one", async () => {
  let n = 0;
  const fetchImpl = async () => (++n === 1 ? { ok: false, status: 503, json: async () => ({}) } : reply(final("answered by the fallback")));
  const out = await askQuestion({ question: "x", tools, providers: [provider("first"), provider("second")], fetchImpl });
  assert.equal(out.answer, "answered by the fallback");
  assert.equal(out.provider, "second");
});

test("a 429 is retried once on the same provider instead of dropping to the fallback", async () => {
  let n = 0;
  const fetchImpl = async () => {
    n++;
    if (n === 1) return { ok: false, status: 429, headers: { get: () => "0" }, text: async () => '{"error":"rate limited"}' };
    return reply(final("answered after the backoff"));
  };
  const out = await askQuestion({ question: "x", tools, providers: [provider("first"), provider("second")], fetchImpl });
  assert.equal(out.answer, "answered after the backoff");
  assert.equal(out.provider, "first");
  assert.equal(n, 2);
  assert.deepEqual(out.failures, []);
});

test("a model that keeps calling tools is made to answer on the last round", async () => {
  const choices = [];
  const fetchImpl = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    choices.push(body.tool_choice);
    return body.tool_choice === "none" ? reply(final("Answering from the evidence already returned.")) : reply(call("desk_summary", {}, "c" + choices.length));
  };
  const out = await askQuestion({ question: "x", tools, providers: [provider("one")], fetchImpl, limits: { maxRounds: 3 } });
  assert.deepEqual(choices, ["auto", "auto", "none"]);
  assert.equal(out.answer, "Answering from the evidence already returned.");
  assert.equal(out.rounds, 3);
});

test("a stalled call is retried on the same provider before the fallback is tried", async () => {
  let n = 0;
  const fetchImpl = async () => {
    n++;
    if (n === 1) {
      const e = new Error("The operation was aborted due to timeout");
      e.name = "TimeoutError";
      throw e;
    }
    return reply(final("answered after the stall"));
  };
  const out = await askQuestion({ question: "x", tools, providers: [provider("first"), provider("second")], fetchImpl });
  assert.equal(out.answer, "answered after the stall");
  assert.equal(out.provider, "first");
  assert.equal(n, 2);
});

test("the chain stops before a provider once its total budget is spent", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return reply(final("should not be reached")); };
  await assert.rejects(
    askQuestion({ question: "x", tools, providers: [provider("a"), provider("b")], fetchImpl, limits: { askDeadlineMs: 0 } }),
    (e) => e.code === "AGENT_UNAVAILABLE" && /a: ASK_DEADLINE/.test(e.details.join(" ")),
  );
  assert.equal(calls, 0);
});

test("a provider that misses its deadline is abandoned without spending the next round", async () => {
  let slowCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes("slow.example")) {
      slowCalls++;
      await new Promise((r) => setTimeout(r, 60));
      return reply(call("desk_summary", {}));
    }
    return reply(final("answered by the provider that answers"));
  };
  const slow = { ...provider("slow"), baseUrl: "https://slow.example/v1" };
  const fast = { ...provider("fast"), baseUrl: "https://fast.example/v1" };
  const out = await askQuestion({ question: "x", tools, providers: [slow, fast], fetchImpl, limits: { providerDeadlineMs: 40 } });
  assert.equal(out.answer, "answered by the provider that answers");
  assert.equal(out.provider, "fast");
  assert.equal(slowCalls, 1, "no second round is spent on a provider past its deadline");
  assert.match(out.failures.join(" "), /slow: PROVIDER_DEADLINE/);
});

test("all providers failing is AGENT_UNAVAILABLE, with no provider detail in the public error", async () => {
  await assert.rejects(
    askQuestion({ question: "x", tools, providers: [provider("a"), provider("b")], fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) }),
    (e) => e.code === "AGENT_UNAVAILABLE" && /a: MODEL_HTTP_500/.test(e.details.join(" ")),
  );
});

test("question guards", async () => {
  await assert.rejects(askQuestion({ question: "  ", tools, providers: [provider("a")], fetchImpl: async () => reply(final("x")) }), (e) => e.code === "EMPTY_QUESTION");
  await assert.rejects(askQuestion({ question: "x".repeat(LIMITS.maxQuestionChars + 1), tools, providers: [provider("a")], fetchImpl: async () => reply(final("x")) }), (e) => e.code === "QUESTION_TOO_LONG");
  await assert.rejects(askQuestion({ question: "x", tools, providers: [], fetchImpl: async () => reply(final("x")) }), (e) => e.code === "AGENT_NOT_CONFIGURED");
});

test("the trace an answer ran becomes its receipt list", async () => {
  const queue = [
    reply(call("get_holding", { ticker: "DIS" })),
    reply(final("Disney is not flagged.")),
  ];
  const out = await askQuestion({ question: "Why is Disney not flagged?", tools, providers: [provider("one")], fetchImpl: async () => queue.shift() });
  const receipts = collectReceipts({ desk, revision: "rev-1", trace: out.trace, freshness: { checked: false, why: "live_gate_off" } });
  assert.equal(receipts[0].kind, "panel");
  assert.equal(receipts[0].revision, "rev-1");
  const fresh = receipts.find((r) => r.kind === "freshness");
  assert.equal(fresh.checked, false);
  assert.equal(fresh.why, "live_gate_off");
  assert.equal(fresh.latestWeek, undefined, "an unchecked attestation contributes no date to the receipt");
  for (const k of ["latestRevision", "verdict", "panel", "cachedResponseFetchedAt"]) {
    assert.equal(fresh[k], undefined, `an unchecked receipt must not carry a ${k} field at all`);
  }
  const committed = receipts.find((r) => r.kind === "committed");
  assert.equal(committed.ticker, "DIS");
  assert.deepEqual(committed.files, ["fixtures/qloo/search-DIS.json"]);
  assert.equal(committed.entity, "ENTITY-DIS");
  assert.equal(committed.request.operation, "recommend");
  assert.ok(!JSON.stringify(receipts).includes("QLOO_API_KEY"), "a receipt names files and ids, never credentials");
});

test("readProviders only accepts complete, non-empty configuration", () => {
  assert.equal(readProviders({}).length, 0);
  assert.equal(readProviders({ AGENT_BASE_URL: "https://x/v1", AGENT_API_KEY: "k", AGENT_MODEL: "m" }).length, 1);
  assert.equal(readProviders({ AGENT_BASE_URL: "https://x/v1", AGENT_API_KEY: "", AGENT_MODEL: "m" }).length, 0);
  const chain = readProviders({
    AGENT_BASE_URL: "https://x/v1/", AGENT_API_KEY: "k", AGENT_MODEL: "m",
    AGENT_FALLBACK_1_BASE_URL: "https://y/v1", AGENT_FALLBACK_1_API_KEY: "k2", AGENT_FALLBACK_1_MODEL: "m2",
  });
  assert.equal(chain.length, 2);
  assert.equal(chain[0].baseUrl, "https://x/v1");
});
