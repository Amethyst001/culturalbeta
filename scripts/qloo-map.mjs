// Step 2 (Map): brand entity -> ticker via /search, one row per holding with
// the chosen Qloo entity id and all candidates retained for provenance review.
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../src/env.mjs";
import { qlooGet, QLOO_DIR } from "../src/qloo.mjs";
import { mkdirSync } from "node:fs";

const book = JSON.parse(readFileSync(resolve(ROOT, "config/book.json"), "utf8"));
mkdirSync(QLOO_DIR, { recursive: true });

const rows = [];
for (const h of book.holdings) {
  const json = await qlooGet("/search", { query: h.qlooQuery, types: "urn:entity:brand", take: 5 }, { cacheName: `search-${h.ticker}.json` });
  const entities = (json.entities ?? json.results?.entities ?? []).map((e) => ({ id: e.id, name: e.name }));
  const exact = entities.find((e) => e.name?.toLowerCase() === h.qlooQuery.toLowerCase()) ?? entities[0] ?? null;
  rows.push({
    ticker: h.ticker,
    label: h.label,
    query: h.qlooQuery,
    entityId: exact?.id ?? null,
    entityName: exact?.name ?? null,
    candidates: entities,
    needsReview: !exact || exact.name?.toLowerCase() !== h.qlooQuery.toLowerCase(),
    provenance: `fixtures/qloo/search-${h.ticker}.json`,
  });
  console.log(`${h.ticker}: ${exact ? `${exact.name} (${exact.id})` : "NO MATCH"}${rows.at(-1).needsReview ? "  <-- review" : ""}`);
}
writeFileSync(resolve(QLOO_DIR, "entities.json"), JSON.stringify(rows, null, 1));
console.log(`Saved ${rows.length} mapping rows -> fixtures/qloo/entities.json`);
const unresolved = rows.filter((r) => !r.entityId).length;
if (unresolved) { console.error(`${unresolved} holdings unresolved — fix queries before proceeding.`); process.exitCode = 1; }
