// Fetch the consumer-sentiment index used by the exclusion check.
// Source: University of Michigan, via FRED (public, no key). Monthly, so the
// fixture records the coarseness rather than hiding it.
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../src/env.mjs";

const URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=UMCSENT";
const OUT = resolve(ROOT, "fixtures/sentiment.json");

const res = await fetch(URL, { headers: { "user-agent": "cultural-beta/1.0" } });
if (!res.ok) { console.error(`FRED refused: ${res.status}`); process.exit(1); }
const text = await res.text();
const rows = text.trim().split(/\r?\n/).slice(1);
const series = [];
for (const row of rows) {
  const [date, raw] = row.split(",");
  const value = Number(raw);
  if (!date || !Number.isFinite(value)) continue;
  series.push({ date, value });
}
if (series.length < 24) { console.error(`Only ${series.length} monthly observations — refusing to write a usable-looking fixture.`); process.exit(1); }
mkdirSync(resolve(ROOT, "fixtures"), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  series: "University of Michigan Consumer Sentiment Index",
  id: "UMCSENT",
  source: URL,
  fetched: new Date().toISOString().slice(0, 10),
  cadence: "monthly",
  note: "Monthly index level. Aligned to the weekly calendar as the month-over-month change, carried on weeks inside that month; not interpolated.",
  observations: series,
}, null, 2) + "\n");
console.log(`Wrote ${series.length} monthly observations (${series[0].date} → ${series.at(-1).date}) to fixtures/sentiment.json`);
