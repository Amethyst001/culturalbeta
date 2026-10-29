// Server-side Qloo client. Key from env only (never sent to the browser).
// Every call caches its raw response + request params so each displayed
// number traces to a file. The documented API carries no request id —
// provenance here is the cached fixture file + exact request parameters.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, requireEnv } from "./env.mjs";

export const QLOO_DIR = process.env.CULTURALBETA_QLOO_DIR
  ? resolve(process.env.CULTURALBETA_QLOO_DIR)
  : resolve(ROOT, "fixtures/qloo");

export function base() {
  return (process.env.QLOO_BASE_URL || "https://hackathon.api.qloo.com").replace(/\/+$/, "");
}

export async function qlooGet(path, params, { cacheName } = {}) {
  const key = requireEnv("QLOO_API_KEY");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const url = `${base()}${path}?${qs.toString()}`;
  const res = await fetch(url, { headers: { "X-Api-Key": key }, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { httpStatus: res.status, raw: text }; }
  if (!res.ok) {
    const err = new Error(`QLOO_HTTP_${res.status} on ${path}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  if (cacheName) {
    mkdirSync(QLOO_DIR, { recursive: true });
    writeFileSync(resolve(QLOO_DIR, cacheName), JSON.stringify({
      request: { url: url.replace(key, "<REDACTED_KEY>"), path, params },
      httpStatus: res.status,
      fetchedAt: new Date().toISOString(),
      response: json,
    }, null, 1));
  }
  return json;
}

export function readCache(name) {
  const f = resolve(QLOO_DIR, name);
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, "utf8"));
}
