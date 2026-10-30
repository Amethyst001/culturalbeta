// Step 2 (Map): name -> Qloo entity for every name in the consumer universe.
// A result is accepted only when its name matches the query on a word boundary;
// anything else stays unresolved and is reported, because a silently misresolved
// brand corrupts the taste basket for its whole sub-sector.
//
// Every attempt is cached under its own file and reused when the recorded request
// matches, so re-running this script after adding an alternate query spends only
// the new query. `--refresh` ignores the cache and pays for the whole pass again.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { qlooSearch, searchArgv, searchResults, QLOO_DIR } from "../src/qloo.mjs";
import { loadUniverse, nameMatches, searchAttempts } from "../src/universe.mjs";

const REFRESH = process.argv.includes("--refresh");
// `--dry` re-scores every cached response under the current match rule without
// making a request. Acceptance is a code decision, so it must be reviewable
// against data already paid for rather than against a fresh spend.
const DRY = process.argv.includes("--dry");
const universe = loadUniverse();
mkdirSync(QLOO_DIR, { recursive: true });

// A cached response is reusable only when its recorded argv is exactly the request
// this attempt would make: a query edited since the file was written must be
// re-spent rather than matched against an answer to a different question.
function cachedAttempt(cacheName, args) {
  if (REFRESH) return null;
  const file = resolve(QLOO_DIR, cacheName);
  if (!existsSync(file)) return null;
  let cache;
  try {
    cache = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (JSON.stringify(cache?.request?.argv ?? null) !== JSON.stringify(args)) return null;
  return cache.response;
}

let spent = 0;
let reused = 0;
const rows = [];
for (const name of universe.names) {
  // A listing is often named one thing and loved as another: the ticker is
  // LULU/"lululemon athletica", the entity in anyone's taste is "lululemon". The
  // attempts are tried in order and stop at the first accepted match.
  const log = [];
  let hit = null, entities = [], usedAttempt = null, failed = [];
  for (const attempt of searchAttempts(name)) {
    const args = searchArgv(attempt.query, { take: 10, type: attempt.type });
    let json = cachedAttempt(attempt.cacheName, args);
    if (json == null) {
      if (DRY) {
        log.push({ query: attempt.query, type: attempt.type, cacheName: attempt.cacheName, results: null, accepted: null, uncached: true });
        continue;
      }
      try {
        json = await qlooSearch(attempt.query, { take: 10, type: attempt.type, cacheName: attempt.cacheName });
        spent += 1;
      } catch (err) {
        if (err.code === "QLOO_AUTH") {
          console.error(`${name.ticker}: ${err.code} — ${err.message}`);
          process.exit(2);
        }
        failed.push(`${attempt.query} (${attempt.type}): ${err.code ?? "ERROR"}`);
        continue;
      }
    } else {
      reused += 1;
    }
    const found = searchResults(json);
    const accepted = found.find((e) => nameMatches(e.name, attempt.query)) ?? null;
    log.push({ query: attempt.query, type: attempt.type, cacheName: attempt.cacheName, results: found.length, accepted: accepted?.name ?? null });
    entities = found;
    usedAttempt = attempt;
    if (accepted) {
      hit = accepted;
      break;
    }
  }
  const usedQuery = usedAttempt?.query ?? name.query;
  if (!hit) {
    rows.push({
      ...name,
      attempts: log,
      searchedTypes: [...new Set(log.map((l) => l.type))],
      entityId: null,
      entityName: null,
      candidates: entities,
      unresolved: failed.length ? `request failed: ${failed.join("; ")}` : log.length ? "no boundary match" : "no response",
    });
    continue;
  }
  rows.push({
    ticker: name.ticker,
    label: name.label,
    query: name.query,
    matchedQuery: usedQuery,
    matchedType: usedAttempt.type,
    altUsed: usedQuery !== name.query || usedAttempt.type !== "brand",
    sector: name.sector,
    featured: Boolean(name.featured),
    entityId: hit.id,
    entityName: hit.name,
    attempts: log,
    searchedTypes: [...new Set(log.map((l) => l.type))],
    candidates: entities,
    exact: Boolean(hit.name?.toLowerCase() === String(usedQuery).toLowerCase()),
    provenance: `fixtures/qloo/${usedAttempt.cacheName}`,
  });
}

const resolved = rows.filter((r) => r.entityId);
const unresolved = rows.filter((r) => !r.entityId);
if (!DRY) writeFileSync(resolve(QLOO_DIR, "entities.json"), JSON.stringify(rows, null, 1));
console.log(`${DRY ? "[dry: cache only, entities.json untouched] " : ""}Saved ${rows.length} mapping rows (${resolved.length} resolved, ${unresolved.length} unresolved) -> fixtures/qloo/entities.json`);
console.log(`Qloo calls: ${spent} spent, ${reused} reused from cache${REFRESH ? " (--refresh on: cache ignored)" : ""}`);
if (unresolved.length) console.log(`Unresolved: ${unresolved.map((r) => `${r.ticker}[${r.searchedTypes.join("+")}]`).join(", ")}`);
const review = rows.filter((r) => r.entityId && !r.exact);
if (review.length) console.log(`Needs review (accepted on a boundary match, not exact): ${review.map((r) => `${r.ticker}=${r.entityName}`).join(", ")}`);

if (!DRY && resolved.length / rows.length < 0.7) {
  console.error("REFUSING TO CONTINUE: fewer than 70% of the universe resolved. Fix the queries rather than pricing a partial book.");
  process.exit(1);
}
