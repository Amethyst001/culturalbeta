// Every Qloo request goes through the event harness (@qloo/qloo-harness), the
// only surface the hackathon supports: `qloo exec` for the validated trends
// workflow, `qloo api` for search and insights. This module owns process
// spawning, argument quoting and error mapping so callers only see JSON.
//
// The key never touches this process's arguments: the harness reads it from
// QLOO_API_KEY in the inherited environment (set from .env, never committed).
import { spawn } from "node:child_process";

const BIN = process.env.QLOO_BIN || "qloo";
// Test double: point QLOO_BIN_JS at a script and it runs under this node binary,
// which keeps the argv path identical on every platform.
const BIN_JS = process.env.QLOO_BIN_JS || null;
const DEFAULT_TIMEOUT_MS = 120000;

// cmd.exe re-parses the command line before the shim runs, so each argument is
// quoted and inner quotes are escaped once. Verified against --dry-run output.
function winQuote(arg) {
  return `"${String(arg).replace(/"/g, '\\"')}"`;
}

function commandFor(args) {
  if (BIN_JS) return { command: process.execPath, argv: [BIN_JS, ...args], shell: false };
  if (process.platform !== "win32") return { command: BIN, argv: args, shell: false };
  // cmd.exe reparses the line, so it is built as one pre-quoted string and handed
  // to the shell form; spawning the .cmd shim with an argv array re-quotes each
  // element and the JSON argument arrives mangled (verified both ways).
  const line = [BIN, ...args].map(winQuote).join(" ");
  return { command: line, argv: [], shell: true };
}

export function harness(args, { input = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const { command, argv, shell } = commandFor(args);
  return new Promise((resolve) => {
    const child = spawn(command, argv, { shell, env: process.env, windowsHide: true });
    let out = "";
    let err = "";
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; resolve(result); } };
    const timer = setTimeout(() => { child.kill(); done({ code: -1, stdout: out, stderr: `${err}\nTIMEOUT after ${timeoutMs}ms`, ms: timeoutMs }); }, timeoutMs);
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { err += c; });
    child.on("error", (e) => { clearTimeout(timer); done({ code: -1, stdout: out, stderr: `${err}\nSPAWN ${e.message}`, ms: 0 }); });
    child.on("close", (code) => { clearTimeout(timer); done({ code, stdout: out, stderr: err, ms: 0 }); });
    if (input !== null && input !== undefined) child.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
    else child.stdin.end();
  });
}

function parseJson(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

export class HarnessError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "HarnessError";
    this.code = code;
    Object.assign(this, detail);
  }
}

// One operation. Returns the parsed JSON on success; throws a HarnessError that
// carries the harness's own error code and recovery text on failure.
export async function harnessJson(args, opts = {}) {
  const res = await harness(args, opts);
  const json = parseJson(res.stdout);
  if (res.code !== 0) {
    const envelope = json && json.error ? json : parseJson(res.stdout);
    const detail = envelope?.error ?? {};
    const code = detail.code || `QLOO_HARNESS_EXIT_${res.code}`;
    const message = [detail.recovery, res.stderr.trim().split("\n").filter(Boolean).slice(-2).join(" ")]
      .filter(Boolean).join(" · ") || `harness exited ${res.code}`;
    throw new HarnessError(code, message, { retryable: Boolean(detail.retryable), stderr: res.stderr.slice(0, 600), correlationId: envelope?.correlation_id ?? null });
  }
  if (json === null) {
    throw new HarnessError("QLOO_HARNESS_OUTPUT", `harness returned non-JSON: ${res.stdout.slice(0, 200)}`, { stderr: res.stderr.slice(0, 600) });
  }
  return json;
}

// `qloo exec <operation>` reads its input from stdin when --input is omitted,
// so no JSON ever sits in an argument list (and no shell ever sees it).
//
// --jsonl is not optional here. Verified against @qloo/qloo-harness 0.1.26
// (dist/exec.js:273): the default single-line output is the bare workflow result
// and carries no correlation id, while the jsonl stream emits a `completed` event
// wrapping that result with `correlation_id` and `duration_ms`. Without the flag
// the desk would cache a null id for every call and still claim one.
export async function execOperation(operation, input, opts = {}) {
  const res = await harness(["exec", operation, "--jsonl"], { ...opts, input });
  const events = res.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
  const done = events.find((e) => e.event === "completed");
  const failed = events.find((e) => e.event === "failed") ?? (res.code !== 0 ? events.at(-1) : null);
  if (res.code !== 0 || failed || !done) {
    const detail = failed?.error ?? {};
    const code = detail.code || `QLOO_HARNESS_EXIT_${res.code}`;
    const tail = res.stderr.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(" ");
    const message = [detail.recovery, tail].filter(Boolean).join(" · ") || `harness exited ${res.code}`;
    throw new HarnessError(code, message, {
      retryable: Boolean(detail.retryable),
      stderr: res.stderr.slice(0, 600),
      correlationId: failed?.correlation_id ?? done?.correlation_id ?? null,
    });
  }
  const result = done.result ?? {};
  // `transport` is on the started event only (dist/exec.js:248-256); the
  // completed event carries correlation_id and duration_ms.
  const started = events.find((e) => e.event === "started");
  result.execution = {
    transport: started?.transport ?? "direct",
    correlation_id: done.correlation_id ?? null,
    duration_ms: done.duration_ms ?? null,
  };
  return result;
}

export function apiCall(args, opts = {}) {
  return harnessJson(["api", ...args, "--json"], opts);
}

export async function harnessVersion() {
  const res = await harness(["--version"]);
  return res.stdout.trim();
}
