// Step 3a (Factor input): weekly taste time series per brand from /v2/trending.
// Real weekly population-rank velocity; 106+ weekly points require paging past take<=50.
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../src/env.mjs";
import { qlooGet } from "../src/qloo.mjs";

const book = JSON.parse(readFileSync(resolve(ROOT, "config/book.json"), "utf8"));
const entities = JSON.parse(readFileSync(resolve(ROOT, "fixtures/qloo/entities.json"), "utf8"));

const today = new Date();
const endDate = today.toISOString().slice(0, 10);
const startDate = new Date(today.getTime() - (book.weeks + 6) * 7 * 86400).toISOString().slice(0, 10);

for (const row of entities) {
  if (!row.entityId) { console.error(`${row.ticker}: no entity id — run qloo-map first.`); continue; }
  const weeks = [];
  for (let page = 1; page <= 3; page++) {
    const json = await qlooGet("/v2/trending", {
      "filter.type": "urn:entity:brand",
      "signal.interests.entities": row.entityId,
      "filter.start_date": startDate,
      "filter.end_date": endDate,
      take: 50,
      page,
    }, { cacheName: `trending-${row.ticker}-p${page}.json` });
    const batch = json.results?.trending ?? [];
    weeks.push(...batch);
    if (batch.length < 50) break;
  }
  writeFileSync(resolve(ROOT, `fixtures/qloo/trending-${row.ticker}.json`), JSON.stringify({
    request: { path: "/v2/trending", "filter.type": "urn:entity:brand", entity: row.entityId, start_date: startDate, end_date: endDate, take: 50, pages: 3 },
    weeks: weeks.length,
    points: weeks,
  }, null, 1));
  console.log(`${row.ticker}: ${weeks.length} weekly points (${startDate} -> ${endDate})`);
}
