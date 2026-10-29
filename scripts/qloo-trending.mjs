// Step 3a (Factor input): weekly taste time series per brand from /v2/trending.
// Real weekly population-rank velocity; 106+ weekly points require paging past take<=50.
// Response is ordered newest-first, so pages are merged, deduped and sorted here.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../src/env.mjs";
import { qlooGet } from "../src/qloo.mjs";

const book = JSON.parse(readFileSync(resolve(ROOT, "config/book.json"), "utf8"));
const entities = JSON.parse(readFileSync(resolve(ROOT, "fixtures/qloo/entities.json"), "utf8"));
const pricesFile = resolve(ROOT, "fixtures/prices.json");
const alignedDates = existsSync(pricesFile) ? JSON.parse(readFileSync(pricesFile, "utf8")).window.alignedDates : null;

const today = new Date();
const endDate = today.toISOString().slice(0, 10);
const startDate = new Date(today.getTime() - (book.weeks + 6) * 7 * 86400).toISOString().slice(0, 10);

const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekMonday = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

for (const row of entities) {
  if (!row.entityId) { console.error(`${row.ticker}: no entity id — run qloo-map first.`); continue; }
  const byDate = new Map();
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
    if (page === 1 && !batch.length) {
      console.error(`${row.ticker}: no trending rows — top-level keys: ${Object.keys(json).join(", ") || "empty"}; results keys: ${Object.keys(json.results ?? {}).join(", ") || "none"}`);
    }
    for (const p of batch) if (p?.date && !byDate.has(p.date)) byDate.set(p.date, p);
    if (batch.length < 50) break;
  }
  const points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  writeFileSync(resolve(ROOT, `fixtures/qloo/trending-${row.ticker}.json`), JSON.stringify({
    request: { path: "/v2/trending", "filter.type": "urn:entity:brand", entity: row.entityId, start_date: startDate, end_date: endDate, take: 50, pages: 3 },
    weeks: points.length,
    points,
  }, null, 1));

  const dows = {};
  for (const p of points) {
    const d = weekday[new Date(`${p.date}T00:00:00Z`).getUTCDay()];
    dows[d] = (dows[d] ?? 0) + 1;
  }
  const dowText = Object.entries(dows).sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d}:${n}`).join(" ");
  let aligned = "";
  if (alignedDates) {
    const keys = new Set(points.map((p) => weekMonday(p.date)));
    const hit = alignedDates.filter((d) => keys.has(d)).length;
    aligned = `, ${hit}/${alignedDates.length} aligned with the price window`;
  }
  console.log(`${row.ticker}: ${points.length} weekly points ${points[0]?.date.slice(0, 10)} → ${points.at(-1)?.date.slice(0, 10)} (${dowText}${aligned})`);
}
