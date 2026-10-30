// Step 3b (Sector basket): the taste basket every name in a sub-sector is priced
// against.
//
// One `qloo exec recommend` call per sector per creative type, signalled by up to
// ten of that sector's resolved entities (the harness accepts at most ten). The
// result is the cultural neighbourhood of a sub-sector's audience, not of one
// brand, so the same factor is comparable across every name in the book — and the
// call count grows with sectors, not with names.
//
// Every name in the universe is removed from every result by id and by normalised
// name: a consumer sub-sector cannot explain itself with consumer stocks.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { ROOT } from "../src/env.mjs";
import { qlooRecommend, readCache, QLOO_DIR } from "../src/qloo.mjs";
import { norm } from "../src/universe.mjs";

const book = JSON.parse(readFileSync(resolve(ROOT, "config/book.json"), "utf8"));
const all = readCache("entities.json");
if (!all) { console.error("fixtures/qloo/entities.json missing — run qloo-map first."); process.exit(2); }
const cfg = book.basket;

const universeIds = new Set(all.map((e) => e.entityId).filter(Boolean));
const universeNames = new Set(all.flatMap((e) => [norm(e.label), norm(e.query)]).filter(Boolean));

function isUniverseName(entity) {
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

const sectors = new Map();
for (const row of all) {
  if (!row.sector || !row.entityId) continue;
  if (!sectors.has(row.sector)) sectors.set(row.sector, []);
  sectors.get(row.sector).push(row);
}

const fetchedAt = new Date().toISOString();
let refused = 0;

for (const [sector, members] of sectors) {
  const signals = members.slice(0, 10).map((m) => m.entityId);
  const collected = [];
  const calls = [];
  for (const type of cfg.types) {
    let env;
    try {
      env = await qlooRecommend(signals, type, {
        limit: cfg.candidatesPerType,
        cacheName: `recommend-sector-${sector}-${type}.json`,
      });
    } catch (err) {
      console.error(`${sector}/${type}: ${err.code ?? "ERROR"} — ${err.message}`);
      if (err.code === "QLOO_AUTH") process.exit(2);
      refused++;
      continue;
    }
    const results = env.results ?? [];
    const kept = results
      .filter((e) => !isUniverseName(e) && typeof e.affinity === "number" && e.affinity > 0)
      .slice(0, cfg.perType)
      .map((e) => ({ id: e.id, name: e.name ?? e.id, type, affinity: e.affinity, explainability: e.explainability ?? null }));
    calls.push({
      type,
      surface: env.surface ?? "exec recommend",
      request: { operation: "recommend", target_type: type, signals, limit: cfg.candidatesPerType },
      returned: results.length,
      excluded: results.filter(isUniverseName).length,
      kept: kept.length,
      correlationId: env.execution?.correlation_id ?? null,
      cache: `fixtures/qloo/recommend-sector-${sector}-${type}.json`,
    });
    collected.push(...kept);
  }

  const seen = new Set();
  const unique = collected.filter((m) => (seen.has(m.id) ? false : seen.add(m.id)));
  const total = unique.reduce((s, m) => s + m.affinity, 0);
  if (unique.length < cfg.minMembers || total <= 0) {
    console.error(`${sector}: only ${unique.length} usable basket members (floor ${cfg.minMembers}) — refusing to write a basket.`);
    refused++;
    continue;
  }
  const basket = unique.map(({ id, name, type, affinity, explainability }) => ({
    id, name, type, affinity,
    weight: affinity / total,
    ...(explainability ? { explainability } : {}),
  }));

  writeFileSync(resolve(QLOO_DIR, `basket-sector-${sector}.json`), JSON.stringify({
    sector,
    signalEntityIds: signals,
    signalNames: members.slice(0, 10).map((m) => `${m.ticker} ${m.label}`),
    namesPricedAgainstIt: members.map((m) => m.ticker),
    config: { types: cfg.types, perType: cfg.perType, candidatesPerType: cfg.candidatesPerType },
    fetchedAt,
    calls,
    members: basket,
    excludedByConstruction: all.map((h) => ({ ticker: h.ticker, entityId: h.entityId ?? null })),
  }, null, 1));

  const byType = cfg.types.map((t) => `${t} ${basket.filter((m) => m.type === t).length}`).join(" · ");
  console.log(`${sector}: ${basket.length} members (${byType}) — ${basket.slice(0, 3).map((m) => m.name).join(", ")}${basket.length > 3 ? ", …" : ""} · prices ${members.length} names`);
}

if (refused) {
  console.error(`${refused} sector/type calls refused — inspect the cache before running qloo-series.`);
  process.exitCode = 1;
}
