// Step 3b (Factor input): shared-audience affinity between the book's brands.
// /v2/insights with brand A as signal and the other six as filter.results.entities
// returns affinity scores (0..1) of each target entity towards the input.
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../src/env.mjs";
import { qlooGet } from "../src/qloo.mjs";

const book = JSON.parse(readFileSync(resolve(ROOT, "config/book.json"), "utf8"));
const entities = JSON.parse(readFileSync(resolve(ROOT, "fixtures/qloo/entities.json"), "utf8"));

const matrix = {};
for (const row of entities) {
  if (!row.entityId) continue;
  const others = entities.filter((e) => e.entityId && e.ticker !== row.ticker);
  const json = await qlooGet("/v2/insights", {
    "filter.type": "urn:entity:brand",
    "signal.interests.entities": row.entityId,
    "filter.results.entities": others.map((e) => e.entityId).join(","),
    sort_by: "affinity",
    take: 50,
  }, { cacheName: `affinity-${row.ticker}.json` });
  // documented shape: { success, results: { entities: [...] } }; item fields are
  // untyped in the schema, so read the documented score name and its known aliases.
  const results = Array.isArray(json.results) ? json.results : (json.results?.entities ?? json.entities ?? []);
  const byTicker = {};
  for (const o of others) {
    const hit = results.find((r) => r.id === o.entityId);
    const score = hit?.affinity ?? hit?.score ?? hit?.query?.affinity ?? hit?.properties?.affinity ?? null;
    byTicker[o.ticker] = typeof score === "number" ? score : null;
  }
  const missing = Object.values(byTicker).filter((v) => v === null).length;
  if (missing) console.warn(`${row.ticker}: ${missing} affinity scores missing — inspect fixtures/qloo/affinity-${row.ticker}.json (item keys: ${Object.keys(results[0] ?? {}).join(", ") || "none returned"})`);
  matrix[row.ticker] = byTicker;
  console.log(`${row.ticker}: ${others.length - missing}/${others.length} affinity scores`);
}
writeFileSync(resolve(ROOT, "fixtures/qloo/affinity.json"), JSON.stringify({ request: { path: "/v2/insights", sort_by: "affinity" }, matrix }, null, 1));
console.log("Saved fixtures/qloo/affinity.json");
