// Fetch one logo per priced ticker into desk/logos/, so the desk serves its own
// images: no third-party request at judge time, no layout that depends on a CDN.
//
// Source order is deliberate. Financial Modeling Prep's image endpoint is ticker-
// addressed and returns the largest file; Parqet is the fallback; CompaniesMarketCap
// is the last resort. A response is accepted only if it is a real PNG above a size
// floor, so an HTML error page or a 1x1 placeholder is rejected rather than shipped.
//
// These are third-party trademarks used for identification of the company a row is
// about. They are not Qloo data and carry no Qloo response. The desk renders a
// monogram underneath every image, so a missing or blocked logo degrades to type.
//
// Usage: node scripts/fetch-logos.mjs [--force]

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "output");
const DIR = resolve(ROOT, "desk/logos");
const force = process.argv.includes("--force");

const SOURCES = [
  (t) => `https://financialmodelingprep.com/image-stock/${encodeURIComponent(t)}.png`,
  (t) => `https://assets.parqet.com/logos/symbol/${encodeURIComponent(t)}?format=png`,
  (t) => `https://companiesmarketcap.com/img/company-logos/64/${encodeURIComponent(t)}.png`,
];

const MIN_BYTES = 300;
const isPng = (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

async function grab(ticker) {
  for (const source of SOURCES) {
    const href = source(ticker);
    try {
      const res = await fetch(href, { headers: { "user-agent": "culturalbeta-logo-fetch/1.0" }, redirect: "follow" });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < MIN_BYTES || !isPng(buf)) continue;
      return { buf, url: href };
    } catch {
      // try the next source
    }
  }
  return null;
}

const desk = JSON.parse(readFileSync(resolve(OUT, "desk.json"), "utf8"));
// All 101 names, not only the 80 priced ones: an unpriced row still has a company
// behind it, and a logo on every row is what makes the book read as a book.
const rows = desk.rows ?? [];
mkdirSync(DIR, { recursive: true });

let have = 0, fetched = 0, failed = [];
for (const r of rows) {
  const file = resolve(DIR, `${r.ticker}.png`);
  if (!force && existsSync(file) && statSync(file).size >= MIN_BYTES) { have++; continue; }
  const got = await grab(r.ticker);
  if (!got) { failed.push(r.ticker); continue; }
  writeFileSync(file, got.buf);
  fetched++;
  process.stdout.write(`  ${r.ticker} ${String(got.buf.length).padStart(6)} B  ${got.url.includes("financialmodelingprep") ? "fmp" : got.url.includes("parqet") ? "parqet" : "cmc"}\n`);
}
console.log(`\nlogos: ${have + fetched}/${rows.length} present (${fetched} fetched, ${have} already on disk)`);
if (failed.length) {
  console.log(`no usable PNG for ${failed.length}: ${failed.join(", ")}`);
  process.exitCode = 1;
}
