// Step 3a (Audience basket): what each featured name's own audience wants next.
//
// One `qloo exec recommend` call per featured name per creative type, signalled
// by that name's own entity. Every name in the universe is removed from every
// result by id and by normalised name, so a name's basket is the cultural
// neighbourhood around it and can never be the rest of the book.
//
// Weights are the affinity scores Qloo ranked the recommendations by, normalised
// to 1 within each basket. A member without an affinity is dropped rather than
// given an invented weight.
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../src/env.mjs";
import { qlooRecommend, readCache, QLOO_DIR } from "../src/qloo.mjs";

const book = JSON.parse(readFileSync(resolve(ROOT, "config/book.json"), "utf8"));
const all = readCache("entities.json");
if (!all) { console.error("fixtures/qloo/entities.json missing — run qloo-map first."); process.exit(2); }
const cfg = book.basket;

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const universeIds = new Set(all.map((e) => e.entityId).filter(Boolean));
const universeNames = new Set(all.flatMap((e) => [norm(e.label), norm(e.query)]).filter(Boolean));

function isHolding(entity) {
  if (!entity?.id) return true;
  if (universeIds.has(entity.id)) return true;
  const name = norm(entity.name);
  if (!name) return true;
  if (universeNames.has(name)) return true;
  return all.some((h) => {
    const q = norm(h.query);
    return q.length >= 4 && (name === q || name.startsWith(`${q} `) || name.endsWith(` ${q}`));
  });
}

const entities = all.filter((e) => e.featured && e.entityId);
const missing = all.filter((e) => e.featured && !e.entityId);
if (missing.length) {
  console.error(`featured names unresolved: ${missing.map((e) => e.ticker).join(", ")} — run qloo-map first.`);
  process.exit(2);
}

const fetchedAt = new Date().toISOString();
let refused = 0;

for (const row of entities) {
  const members = [];
  const calls = [];
  for (const type of cfg.types) {
    let env;
    try {
      env = await qlooRecommend(row.entityId, type, {
        limit: cfg.candidatesPerType,
        cacheName: `recommend-${row.ticker}-${type}.json`,
      });
    } catch (err) {
      console.error(`${row.ticker}/${type}: ${err.code ?? "ERROR"} — ${err.message}`);
      if (err.code === "QLOO_AUTH") process.exit(2);
      refused++;
      continue;
    }
    const results = env.results ?? [];
    const kept = results
      .filter((e) => !isHolding(e) && typeof e.affinity === "number" && e.affinity > 0)
      .slice(0, cfg.perType)
      .map((e) => ({ id: e.id, name: e.name ?? e.id, type, affinity: e.affinity, explainability: e.explainability ?? null }));
    calls.push({
      type,
      request: { operation: "recommend", target_type: type, signals: [row.entityId], limit: cfg.candidatesPerType },
      returned: results.length,
      excluded: results.filter(isHolding).length,
      kept: kept.length,
      correlationId: env.execution?.correlation_id ?? null,
      cache: `fixtures/qloo/recommend-${row.ticker}-${type}.json`,
    });
    members.push(...kept);
  }

  const seen = new Set();
  const unique = members.filter((m) => (seen.has(m.id) ? false : seen.add(m.id)));
  const total = unique.reduce((s, m) => s + m.affinity, 0);
  if (unique.length < cfg.minMembers || total <= 0) {
    console.error(`${row.ticker}: only ${unique.length} usable basket members (floor ${cfg.minMembers}) — refusing to write a basket.`);
    refused++;
    continue;
  }
  const basket = unique.map(({ id, name, type, affinity, explainability }) => ({
    id, name, type, affinity,
    weight: affinity / total,
    ...(explainability ? { explainability } : {}),
  }));

  writeFileSync(resolve(QLOO_DIR, `basket-${row.ticker}.json`), JSON.stringify({
    ticker: row.ticker,
    signalEntityId: row.entityId,
    config: { types: cfg.types, perType: cfg.perType, candidatesPerType: cfg.candidatesPerType },
    fetchedAt,
    calls,
    members: basket,
    excludedByConstruction: all.map((h) => ({ ticker: h.ticker, entityId: h.entityId ?? null })),
  }, null, 1));

  const byType = cfg.types.map((t) => `${t} ${basket.filter((m) => m.type === t).length}`).join(" · ");
  console.log(`${row.ticker}: ${basket.length} members (${byType}) — ${basket.slice(0, 4).map((m) => m.name).join(", ")}${basket.length > 4 ? ", …" : ""}`);
}

if (refused) {
  console.error(`${refused} holding/type calls refused — inspect the cache before running qloo-series.`);
  process.exitCode = 1;
}
