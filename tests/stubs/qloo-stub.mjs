// Stand-in for the `qloo` harness, used only by tests. It speaks the same argv
// and stdin shape as the real CLI, emits the same envelopes, and rejects the same
// out-of-schema inputs the real executor rejects (trends: 1–5 entities, 20 points
// max per call; recommend: 20 results max). That way a test failure here is the
// same failure the live harness would raise before spending a Qloo call.
const args = process.argv.slice(2);

const MAX_POINTS = 20;
const MAX_ENTITIES = 5;
const MAX_SIGNALS = 10;
const TYPES = new Set(["artist", "book", "brand", "movie", "person", "place", "podcast", "tv_show", "videogame"]);

if (args[0] === "--version") {
  process.stdout.write("0.1.26\n");
  process.exit(0);
}

const readStdin = () => new Promise((ok) => {
  let b = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => { b += c; });
  process.stdin.on("end", () => ok(b));
});

const MODE = process.env.STUB_MODE || "ok";
const CAP = Number(process.env.STUB_CAP || 0);
const COLLIDE = (process.env.STUB_BASKET_COLLIDE || "").split(",").filter(Boolean);

function rangeWeeks(start, end) {
  const out = [];
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  for (; d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 7)) out.push(d.toISOString().slice(0, 10));
  return out;
}

function reject(operation, message) {
  process.stdout.write(JSON.stringify({
    error: { code: "TOOL_INPUT", layer: "tool_input", retryable: false, recovery: message },
    operation,
    correlation_id: `exec-stub-${operation}`,
  }));
  process.exit(1);
}

// The real CLI prints the bare workflow result by default, and with --jsonl a
// `started` line plus a `completed` line that wraps the result and carries the
// correlation id (dist/exec.js:248-273). The stub matches both shapes so a test
// cannot pass against an envelope the live harness never sends.
const JSONL = args.includes("--jsonl");
const NL = "\n";
let emitSeq = 0;
function emit(operation, result) {
  if (!JSONL) { process.stdout.write(JSON.stringify(result)); return; }
  const id = `exec-stub-${operation}`;
  process.stdout.write(JSON.stringify({ schema_version: "1.0", event: "started", sequence: ++emitSeq, operation, correlation_id: id, transport: "direct" }) + NL);
  process.stdout.write(JSON.stringify({ schema_version: "1.0", event: "completed", sequence: ++emitSeq, operation, correlation_id: id, duration_ms: 1, result }) + NL);
}

function checkDates(operation, input) {
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");
  if (!ok(input.start_date) || !ok(input.end_date) || input.start_date > input.end_date) {
    reject(operation, `Invalid ${operation} input: dates must be YYYY-MM-DD with start on or before end.`);
  }
}

if (MODE === "auth" && args[0] !== "api") {
  process.stdout.write(JSON.stringify({ error: { code: "QLOO_AUTH", layer: "qloo", retryable: false, recovery: "Set QLOO_API_KEY, then retry." }, operation: args[1], correlation_id: "exec-stub-auth" }));
  process.exit(1);
}

if (args[0] === "exec") {
  const operation = args[1];
  const input = JSON.parse(await readStdin());

  if (operation === "trends") {
    if (!Array.isArray(input.entities) || input.entities.length < 1 || input.entities.length > MAX_ENTITIES) {
      reject(operation, `Invalid trends input: entities: must contain 1 to ${MAX_ENTITIES} items`);
    }
    if (!TYPES.has(input.entity_type)) reject(operation, `Invalid trends input: entity_type: must be a Qloo Insights entity type`);
    if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_POINTS)) {
      reject(operation, `Invalid trends input: limit: must be <= ${MAX_POINTS}`);
    }
    checkDates(operation, input);
    const take = Math.min(input.limit ?? 10, CAP || MAX_POINTS);
    // Verified against hackathon.api.qloo.com on 2026-10-30: the endpoint returns
    // the LAST `limit` weekly points ending at end_date, and returns nothing for a
    // window that opens less than about 180 days before its end. The stub mirrors
    // that behaviour, because a pager tested against a friendlier fiction is a
    // pager that buys empty pages live.
    const lookbackDays = (Date.parse(`${input.end_date}T00:00:00Z`) - Date.parse(`${input.start_date}T00:00:00Z`)) / 86400000;
    const series = input.entities.map((id) => ({
      entity: { entityId: id, name: "Stub Entity", type: input.entity_type },
      points: lookbackDays < 180 ? [] : rangeWeeks(input.start_date, input.end_date).slice(-take).map((date) => ({
        date,
        // The level is the field the pipeline reads: it varies week to week, and
        // the velocity pair below is the shape the live endpoint actually returns —
        // identical to each other, and zero on the weeks Qloo has not refreshed.
        population_percentile: 0.5 + (date.charCodeAt(9) % 7 - 3) / 100,
        velocity_fold_change: 1 + (date.charCodeAt(9) % 7 - 3) / 200,
        population_percent_delta: 0.4,
      })),
    }));
    emit(operation, {
      status: "ok",
      summary: "stub trends",
      interpretation: { entity_type: input.entity_type, start_date: input.start_date, end_date: input.end_date },
      series,
      result_count: series.length,
      provenance: { source: "stub", endpoint: "/v2/trending", documentation: "stub", requests: [{ method: "GET", path: "/v2/trending", query: input }] },
    });
    process.exit(0);
  }

  if (operation === "recommend") {
    if (MODE === "needsinput") {
      emit(operation, { status: "needs_input", summary: "Choose or correct the unresolved Qloo inputs.", resolution: { issues: [{ input: input.signals?.[0] ?? "x", status: "not_found" }] }, results: [] });
      process.exit(0);
    }
    if (!TYPES.has(input.target_type)) reject(operation, `Invalid recommend input: target_type: must be a Qloo Insights entity type`);
    if (input.signals && (input.signals.length < 1 || input.signals.length > MAX_SIGNALS)) {
      reject(operation, `Invalid recommend input: signals: must contain 1 to ${MAX_SIGNALS} items`);
    }
    if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_POINTS)) {
      reject(operation, `Invalid recommend input: limit: must be <= ${MAX_POINTS}`);
    }
    const signal = input.signals?.[0] ?? "none";
    const slug = String(signal).toLowerCase().replace(/\W+/g, "-");
    const results = [
      ...COLLIDE.map((id) => ({ entity_id: id, name: id, type: `urn:entity:${input.target_type}`, affinity: 0.99 })),
      ...Array.from({ length: input.limit ?? 10 }, (_, i) => ({
        entity_id: `urn:entity:${input.target_type}:stub-${slug}-${i}`,
        name: `Stub ${input.target_type} ${i}`,
        type: `urn:entity:${input.target_type}`,
        affinity: Number((0.6 - i / 100).toFixed(3)),
      })),
    ];
    emit(operation, {
      status: "ok",
      interpretation: { target_type: input.target_type, signals: input.signals },
      results,
      result_count: results.length,
      provenance: { source: "stub", endpoint: "/v2/insights", documentation: "stub", requests: [{ method: "GET", path: "/v2/insights", query: input }] },
    });
    process.exit(0);
  }

  reject(operation, `stub does not implement ${operation}`);
}

if (args[0] === "api") {
  if (args[1] === "insights") {
    const take = Number(args[args.indexOf("--take") + 1] || 3);
    // Shape verified against the live hackathon endpoint on 2026-10-30: a bare
    // array, `type: "urn:entity"`, the real type in `subtype`, and affinity at
    // query.affinity rather than top level.
    process.stdout.write(JSON.stringify(Array.from({ length: take }, (_, i) => ({
      name: `Stub Insight ${i}`,
      entity_id: `0D76344A-EF22-4FDF-95B0-24C471B24FB${i}`,
      type: "urn:entity",
      subtype: "urn:entity:brand",
      popularity: 0.9,
      query: { affinity: Number((0.95 - i / 100).toFixed(4)) },
    }))));
    process.exit(0);
  }
  if (args[1] === "search") {
    const q = args[args.indexOf("--query") + 1];
    // The real CLI prints the entity array itself, keyed by entity_id
    // (dist/router.js:3168/3179) — not a { success, results } envelope.
    process.stdout.write(JSON.stringify([{ entity_id: `urn:entity:brand:stub-${q.toLowerCase().replace(/\W+/g, "-")}`, name: q, type: "urn:entity:brand", subtype: "urn:entity:brand" }]));
    process.exit(0);
  }
}

process.stderr.write(`stub: unhandled ${JSON.stringify(args)}\n`);
process.exit(3);
