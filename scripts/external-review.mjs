// External review panel: sends one brief to independent model families, sequentially,
// and writes each raw answer plus a parsed JSON verdict so opinions can be aggregated.
// Keys are read from the fleet env file and never printed.
//
// usage: node scripts/external-review.mjs <brief.md> [--panel free|full] [--out review]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { ROOT } from "../src/env.mjs";

const FLEET_ENV = process.env.FLEET_ENV || resolve(ROOT, ".env.panel");
const env = {};
if (existsSync(FLEET_ENV)) {
  for (const line of readFileSync(FLEET_ENV, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[t.slice(0, i).trim()] = v;
  }
}

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const briefPath = process.argv[2];
if (!briefPath || briefPath.startsWith("--")) { console.error("usage: node scripts/external-review.mjs <brief.md> [--panel free|full]"); process.exit(2); }
const brief = readFileSync(resolve(briefPath), "utf8");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = resolve(ROOT, arg("out", "review"), `panel-${stamp}`);

const FREE = [
  {
    id: "nemotron-3.5-super",
    label: "NVIDIA NIM / Nemotron 3.5 Super VL 120B",
    endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
    keyVar: "NVIDIA_API_KEY",
    model: "nvidia/nemotron-3.5-super-vl-120b-a12b",
    maxTokens: 12000,
    gap: 5000,
  },
  {
    id: "glm-5.3-flash",
    label: "BeatAPI / GLM 5.3 Flash (free)",
    endpoint: "https://api.beatapi.io/v1/chat/completions",
    keyVar: "BEATAPI_API_KEY",
    model: "glm-5.3-flash-free",
    maxTokens: 8000,
    gap: 65000,
  },
  {
    id: "minimax-m2.7",
    label: "dahl / MiniMax M2.7",
    endpoint: "https://inference.dahl.global/v1/chat/completions",
    keyVar: "DAHL_API_KEY",
    model: "MiniMaxAI/MiniMax-M2.7",
    maxTokens: 8000,
    gap: 20000,
  },
];
// Verified 2026-10-30 with GET /v1/models: opus.abhibots.com serves
// claude-opus-5-5, claude-fable-5-1, claude-opus-5. oxionai.com answers 526 and
// no longer serves a model, so it is out of the panel rather than a silent failure.
const FULL = [
  {
    id: "claude-opus-5-5",
    label: "Abhibots / Claude Opus 5.5",
    endpoint: "https://opus.abhibots.com/v1/chat/completions",
    keyVar: "ABHIBOTS_API_KEY",
    model: "claude-opus-5-5",
    maxTokens: 8000,
    gap: 20000,
    extraHeaders: {},
  },
  {
    id: "claude-fable-5-1",
    label: "Abhibots / Claude Fable 5.1",
    endpoint: "https://opus.abhibots.com/v1/chat/completions",
    keyVar: "ABHIBOTS_API_KEY",
    model: "claude-fable-5-1",
    maxTokens: 8000,
    gap: 20000,
    extraHeaders: {},
  },
  {
    id: "claude-opus-5",
    label: "Abhibots / Claude Opus 5",
    endpoint: "https://opus.abhibots.com/v1/chat/completions",
    keyVar: "ABHIBOTS_API_KEY",
    model: "claude-opus-5",
    maxTokens: 8000,
    gap: 20000,
    extraHeaders: {},
  },
  {
    id: "minimax-m2.7",
    label: "dahl / MiniMax M2.7",
    endpoint: "https://inference.dahl.global/v1/chat/completions",
    keyVar: "DAHL_API_KEY",
    model: "MiniMaxAI/MiniMax-M2.7",
    maxTokens: 8000,
    gap: 20000,
  },
  {
    id: "glm-5.3-flash",
    label: "BeatAPI / GLM 5.3 Flash (free)",
    endpoint: "https://api.beatapi.io/v1/chat/completions",
    keyVar: "BEATAPI_API_KEY",
    model: "glm-5.3-flash-free",
    maxTokens: 8000,
    gap: 65000,
  },
];
const PANEL = arg("panel", "free") === "full" ? FULL : FREE;

const SYSTEM = [
  "You are an independent reviewer for a hackathon submission. You have no stake in it and no",
  "knowledge of the author. Judge what is actually described, not what you would like it to be.",
  "Be blunt and specific. Prefer a concrete objection over encouragement.",
  "Return a single JSON object and nothing else — no markdown fence, no commentary before or after.",
].join("\n");

function parseVerdict(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

async function ask(entry) {
  const key = env[entry.keyVar];
  if (!key) return { ...entry, ok: false, error: `missing ${entry.keyVar}` };
  const started = Date.now();
  const attempt = async (tokens) => {
    const res = await fetch(entry.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "x-api-key": key, ...(entry.extraHeaders ?? {}) },
      body: JSON.stringify({ model: entry.model, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: brief }], temperature: 0.2, max_tokens: tokens, stream: false }),
      signal: AbortSignal.timeout(300000),
    });
    const body = await res.text();
    if (!res.ok) return { status: res.status, error: body.slice(0, 300).replaceAll(key, "[KEY]") };
    let json;
    try { json = JSON.parse(body); } catch { return { error: "non-JSON: " + body.slice(0, 200) }; }
    const msg = json.choices?.[0]?.message ?? {};
    const content = (msg.content ?? "").trim() || (msg.reasoning_content ?? msg.reasoning ?? "").trim();
    return { content, finish: json.choices?.[0]?.finish_reason, usage: json.usage };
  };
  try {
    let r = await attempt(entry.maxTokens);
    if (!r.error && (!r.content || r.finish === "length")) r = await attempt(Math.min(entry.maxTokens * 2, 24000));
    if (r.error) return { ...entry, ok: false, status: r.status, error: r.error, ms: Date.now() - started };
    if (!r.content) return { ...entry, ok: false, error: "empty content after retry", ms: Date.now() - started };
    return { ...entry, ok: true, content: r.content, verdict: parseVerdict(r.content), finish: r.finish, usage: r.usage, ms: Date.now() - started };
  } catch (err) {
    return { ...entry, ok: false, error: String(err?.message ?? err), ms: Date.now() - started };
  }
}

mkdirSync(outDir, { recursive: true });
const results = [];
for (const entry of PANEL) {
  process.stdout.write(`-> ${entry.label} ... `);
  const r = await ask(entry);
  results.push(r);
  writeFileSync(resolve(outDir, `${r.id}.txt`), r.content ?? `ERROR: ${r.error ?? ""}`);
  console.log(r.ok ? `ok ${r.ms}ms` : `FAIL ${r.status ?? ""} ${r.error ?? ""}`.replaceAll("\n", " ").slice(0, 200));
  if (entry !== PANEL[PANEL.length - 1]) await new Promise((res) => setTimeout(res, entry.gap ?? 20000));
}

const meta = results.map(({ content, ...rest }) => rest);
writeFileSync(resolve(outDir, "index.json"), JSON.stringify(meta, null, 2));

const lines = [`# External review panel — ${stamp}`, "", `Brief: \`${briefPath}\``, ""];
for (const r of results) {
  lines.push(`## ${r.label}`, "");
  if (!r.ok) { lines.push(`_Unavailable: ${r.status ?? ""} ${r.error ?? ""}_`, ""); continue; }
  if (!r.verdict) { lines.push("_No parsable JSON verdict; raw answer in the .txt file._", ""); continue; }
  const v = r.verdict;
  lines.push(`- verdict: **${v.verdict ?? "?"}** · total **${v.score_total ?? "?"}/100**`);
  if (v.scores) lines.push(`- scores: TI ${v.scores.technological_implementation}/25 · Design ${v.scores.design}/25 · Impact ${v.scores.potential_impact}/25 · Idea ${v.scores.quality_of_idea}/25`);
  lines.push(`- fatal: ${v.fatal ?? "—"}`);
  lines.push(`- best next construction: ${v.best_next_model_construction ?? "—"}`);
  lines.push(`- headline rewrite: ${v.headline_rewrite ?? "—"}`);
  lines.push(`- judge in 60s: ${v.judge_60s ?? "—"}`);
  for (const k of ["must_fix", "method_objections", "overstatements"]) {
    if (!Array.isArray(v[k]) || !v[k].length) continue;
    lines.push(`- ${k}:`);
    for (const s of v[k]) lines.push(`  - ${s}`);
  }
  lines.push("");
}
writeFileSync(resolve(outDir, "summary.md"), lines.join("\n"));
console.log(`\nwrote ${outDir}`);
for (const r of results) {
  console.log(`\n=== ${r.label} ===`);
  console.log(r.verdict ? `${r.verdict.verdict} ${r.verdict.score_total}/100 · fatal: ${r.verdict.fatal}` : `(no verdict) ${(r.content ?? r.error ?? "").slice(0, 300)}`);
}
