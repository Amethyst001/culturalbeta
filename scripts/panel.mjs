// Multi-model review panel for the cultural beta desk.
// Three reviewer slots, each answered by the highest-tier model reachable right
// now. Reviewers run as a chain: each sees the earlier verdicts and must sharpen
// or disagree, not repeat. Keys are read from the AI Cockpit env file by name and
// never printed; requests carry no key in any saved artifact.
//
// usage: node scripts/panel.mjs --brief review/brief.md [--images a.png,b.png]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../src/env.mjs";

const envPath = process.env.PANEL_ENV || resolve(ROOT, ".env.panel");
const env = {};
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}
const keys = (...names) => names.map((n) => env[n]).filter((v) => v && v.length > 8);

const BASE = {
  oxion: env.OXION_BASE_URL || "https://oxionai.com/v1",
  zenmux: env.ZENMUX_BASE_URL || "https://zenmux.ai/api/v1",
  beatapi: env.BEATAPI_BASE_URL || "https://api.beatapi.io/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  groq: "https://api.groq.com/openai/v1",
  abhibots: "https://opus.abhibots.com/v1",
};

// Ordered best-first inside each slot. A slot is filled by the first model that
// returns usable text; the report records who actually answered and what failed.
// Alpme is excluded by standing instruction (probing stopped 2026-10-26). dahl
// MiniMax is excluded: on 2026-10-29 it returned 17.6k chars of a repeating
// chain-of-thought loop and never reached an answer. Abhibots is a free daily
// pass that serves 429 outside low-load hours, so it sits first and the live
// NVIDIA/Groq models backfill.
const ROSTER = [
  {
    slot: "reviewer-1 · structure",
    tie: "information architecture, hierarchy, what a judge sees in the first 15 seconds",
    candidates: [
      { label: "Abhibots · Claude Opus 5.5", provider: "abhibots", model: "claude-opus-5-5", keys: keys("ABHIBOTS_API_KEY", "OPUS_PROXY_KEY"), vision: true, timeout: 420000 },
      { label: "NVIDIA · Nemotron 3.5 Super VL 120B", provider: "nvidia", model: "nvidia/nemotron-3.5-super-vl-120b-a12b", keys: keys("NVIDIA_API_KEY"), vision: true },
      { label: "Groq · GPT-OSS 120B", provider: "groq", model: "openai/gpt-oss-120b", keys: keys("GROQ_API_KEY", "GROQ_API_KEY_2") },
      { label: "Groq · Qwen 3.8 27B", provider: "groq", model: "qwen/qwen3.8-27b", keys: keys("GROQ_API_KEY", "GROQ_API_KEY_2"), compact: true },
    ],
  },
  {
    slot: "reviewer-2 · product",
    tie: "does this read as a desk a consumer-equity PM would actually use; what is missing or bloated",
    candidates: [
      { label: "Abhibots · Claude Fable 5.1", provider: "abhibots", model: "claude-fable-5-1", keys: keys("ABHIBOTS_API_KEY", "OPUS_PROXY_KEY"), vision: true, timeout: 420000 },
      { label: "Groq · GPT-OSS 120B", provider: "groq", model: "openai/gpt-oss-120b", keys: keys("GROQ_API_KEY", "GROQ_API_KEY_2") },
      { label: "NVIDIA · Nemotron 3.5 Super VL 120B", provider: "nvidia", model: "nvidia/nemotron-3.5-super-vl-120b-a12b", keys: keys("NVIDIA_API_KEY"), vision: true },
      { label: "Groq · Qwen 3.8 27B", provider: "groq", model: "qwen/qwen3.8-27b", keys: keys("GROQ_API_KEY", "GROQ_API_KEY_2"), compact: true },
    ],
  },
  {
    slot: "reviewer-3 · craft",
    tie: "typography, colour, chart craft, mobile, and what looks amateur",
    candidates: [
      { label: "Abhibots · Claude Sonnet 5", provider: "abhibots", model: "claude-sonnet-5", keys: keys("ABHIBOTS_API_KEY", "OPUS_PROXY_KEY"), vision: true, timeout: 420000 },
      { label: "NVIDIA · Nemotron 3.5 Super VL 120B", provider: "nvidia", model: "nvidia/nemotron-3.5-super-vl-120b-a12b", keys: keys("NVIDIA_API_KEY"), vision: true },
      { label: "Groq · Qwen 3.8 27B", provider: "groq", model: "qwen/qwen3.8-27b", keys: keys("GROQ_API_KEY", "GROQ_API_KEY_2"), compact: true },
      { label: "Groq · GPT-OSS 120B", provider: "groq", model: "openai/gpt-oss-120b", keys: keys("GROQ_API_KEY", "GROQ_API_KEY_2"), compact: true },
    ],
  },
];

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const briefPath = arg("brief");
if (!briefPath) { console.error("usage: node scripts/panel.mjs --brief review/brief.md [--images a.png,b.png]"); process.exit(1); }
const brief = readFileSync(resolve(ROOT, briefPath), "utf8");
const imagePaths = (arg("images", "") || "").split(",").map((s) => s.trim()).filter(Boolean);

// Standing directive prepended to every reviewer's prompt. The wording is fixed
// by the team's instruction: "Exercise abstract thinking" must appear verbatim,
// and the review itself must be asked for in the prompt, not assumed.
const STANDING = `Exercise abstract thinking. Before scoring, reason about the entry at the level of its abstract claim, not only its screens: what exactly is being measured, what would falsify it, whether the instrument, the estimator and the control actually establish what the entry says they establish, and what the product is worth if the answer comes back negative. Then review: give a real critical review of the substance and the execution, not a summary of the brief, and answer every numbered request at the end of the brief.

---

`;

function contentFor(model, prior, withImages) {
  const parts = [];
  const priorText = prior.length
    ? "\n\n---\nEARLIER REVIEWERS (critique them: sharpen, disagree where you must, name who you agree with and why; do not restate them):\n" +
      prior.map((p) => `\n### ${p.label}\n${p.text}`).join("\n")
    : "";
  // The images go in as a block with one manifest before them. Interleaving a
  // caption between images made models bind the caption to the wrong picture and
  // describe the desk as the branch card, so the order is stated once and the
  // images follow unlabelled.
  const manifest = withImages
    ? "\n\n---\nSCREENSHOTS FOLLOW\n" + imagePaths.length + " images, in this order, with no captions between them:\n" +
      imagePaths.map((p, i) => `${i + 1}. ${p.split("/").pop()}`).join("\n") + "\n"
    : "";
  parts.push({ type: "text", text: STANDING + brief + priorText + manifest });
  if (withImages) {
    for (const p of imagePaths) {
      const b64 = readFileSync(resolve(ROOT, p)).toString("base64");
      parts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } });
    }
  }
  return parts;
}

// A reviewer that repeats the same 600-char block three times never reached a
// verdict; a 17.6k-char loop from MiniMax once shipped as an answer. Detect it.
function degenerate(text) {
  const norm = text.replace(/\s+/g, " ");
  const len = 600;
  for (let i = 0; i + len * 3 <= norm.length; i += 120) {
    const block = norm.slice(i, i + len);
    let count = 0;
    let at = norm.indexOf(block);
    while (at !== -1 && count < 3) { count++; at = norm.indexOf(block, at + len); }
    if (count >= 3) return true;
  }
  return false;
}

async function ask(cand, prior, timeoutMs = cand.timeout ?? 240000) {
  if (!cand.keys.length) return { ok: false, text: "no key" };
  const vision = Boolean(cand.vision && imagePaths.length);
  const opts = cand.compact ? { compact: true, maxTokens: 2200 } : {};
  let last = { ok: false, text: "no attempt" };
  for (const key of cand.keys) {
    const res = await attempt(cand, prior, vision, key, timeoutMs, opts);
    if (res.ok) return res;
    last = res;
    if (!/HTTP 40[12]|HTTP 429/.test(res.text)) break;
  }
  if (vision && /HTTP 400/.test(last.text)) {
    const res = await attempt(cand, prior, false, cand.keys[0], timeoutMs);
    if (res.ok) return { ...res, vision: false, note: "image rejected, answered text-only" };
  }
  if (/HTTP 413/.test(last.text)) {
    const res = await attempt(cand, prior, vision, cand.keys[0], timeoutMs, { compact: true, maxTokens: 2200 });
    if (res.ok) return { ...res, note: "prompt compacted after 413" };
  }
  return last;
}

async function attempt(cand, prior, withImages, key, timeoutMs, opts = {}) {
  const priorFor = opts.compact ? prior.map((p) => ({ ...p, text: p.text.slice(0, 2000) })) : prior;
  const body = {
    model: cand.model,
    max_tokens: opts.maxTokens || 6000,
    ...(cand.provider === "zenmux" ? {} : { temperature: 0.3 }),
    messages: [{ role: "user", content: withImages ? contentFor(cand.model, priorFor, true) : contentFor(cand.model, priorFor, false).map((p) => p.text).join("\n") }],
  };
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE[cand.provider]}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = await r.text();
    if (!r.ok) return { ok: false, text: `HTTP ${r.status}: ${raw.slice(0, 240)}`, ms: Date.now() - t0 };
    let j;
    try { j = JSON.parse(raw); } catch { return { ok: false, text: "non-JSON response", ms: Date.now() - t0 }; }
    const msg = j.choices?.[0]?.message ?? {};
    const final = (msg.content || "").trim();
    const reasoning = (msg.reasoning_content || "").trim();
    const text = final || reasoning;
    if (!text) return { ok: false, text: "empty response", ms: Date.now() - t0 };
    if (degenerate(text)) return { ok: false, text: `degenerate loop (${text.length} chars, repeated block)`, ms: Date.now() - t0 };
    return { ok: true, text, ms: Date.now() - t0, usedReasoning: !final && Boolean(reasoning), vision: withImages };
  } catch (e) {
    return { ok: false, text: `ERROR ${e.message}`, ms: Date.now() - t0 };
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
mkdirSync(resolve(ROOT, "review"), { recursive: true });
const verdicts = [];
const log = [];

for (const slot of ROSTER) {
  let filled = null;
  for (const cand of slot.candidates) {
    const res = await ask(cand, verdicts);
    log.push(`${slot.slot} · ${cand.label}: ${res.ok ? "answered" : res.text.slice(0, 90)} (${res.ms ?? 0}ms)`);
    console.log(`${res.ok ? "OK " : "—  "} ${cand.label}: ${res.ok ? `${res.text.length} chars in ${res.ms}ms` : res.text.slice(0, 120)}`);
    if (res.ok) { filled = { ...cand, ...res }; break; }
  }
  if (!filled) { log.push(`${slot.slot}: no model answered`); continue; }
  verdicts.push({
    slot: slot.slot,
    tie: slot.tie,
    label: filled.label,
    provider: filled.provider,
    model: filled.model,
    vision: Boolean(filled.vision && imagePaths.length),
    usedReasoning: Boolean(filled.usedReasoning),
    note: filled.note || null,
    ms: filled.ms,
    text: filled.text,
  });
}

const header = `# Review panel — ${new Date().toISOString()}\n\nImages: ${imagePaths.length ? imagePaths.join(", ") : "none"}\nBrief: ${briefPath}\n\n## Standing directive (prepended to every reviewer)\n${STANDING.trim().split("\n---")[0]}\n\n## Attempts\n${log.map((l) => "- " + l).join("\n")}\n`;
const body = verdicts.map((v) => `\n---\n\n## ${v.slot}\n**Model:** ${v.label} (${v.provider}/${v.model})${v.vision ? " · saw the screenshots" : " · text only"}${v.usedReasoning ? " · answer taken from reasoning channel" : ""}${v.note ? ` · ${v.note}` : ""}\n**Charter:** ${v.tie}\n**Latency:** ${v.ms} ms\n\n${v.text}\n`).join("");
const outMd = resolve(ROOT, `review/panel-${stamp}.md`);
writeFileSync(outMd, header + body);
writeFileSync(resolve(ROOT, `review/panel-${stamp}.json`), JSON.stringify({ stamp, images: imagePaths, attempts: log, verdicts }, null, 1));
console.log(`\nSaved ${outMd} (${verdicts.length}/3 reviewers)`);
