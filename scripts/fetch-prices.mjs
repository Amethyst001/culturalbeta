// Weekly bars from Yahoo Chart API, aligned by ISO week (Monday key),
// returns computed on aligned dates only. Output is committed as a fixture:
// every displayed price number traces to this file + the request URL inside it.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../src/env.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

function mondayKey(epochSeconds) {
  const d = new Date(epochSeconds * 1000);
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = utc.getUTCDay(); // 0=Sun
  utc.setUTCDate(utc.getUTCDate() - ((dow + 6) % 7)); // back to Monday
  return utc.toISOString().slice(0, 10);
}

async function weeklyCloses(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1wk&range=5y`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  const json = await res.json();
  const r = json.chart?.result?.[0];
  if (!r) throw new Error(`Yahoo ${symbol}: no chart result (${json.chart?.error?.description ?? "unknown"})`);
  const ts = r.timestamp ?? [];
  const closes = r.indicators?.quote?.[0]?.close ?? [];
  const map = new Map();
  for (let i = 0; i < ts.length; i++) {
    if (typeof closes[i] === "number" && Number.isFinite(closes[i])) map.set(mondayKey(ts[i]), closes[i]);
  }
  return { map, url };
}

export async function buildPrices({ symbols, weeks }) {
  const per = {};
  const urls = {};
  for (const s of symbols) {
    const { map, url } = await weeklyCloses(s);
    per[s] = map;
    urls[s] = url;
  }
  // weeks where every symbol has a close
  const common = [...per[symbols[0]].keys()].filter((w) => symbols.every((s) => per[s].has(w)));
  common.sort();
  if (common.length < weeks + 1) {
    throw new Error(`Alignment floor: only ${common.length} fully-aligned weeks (< ${weeks + 1} needed for ${weeks} returns).`);
  }
  const window = common.slice(-(weeks + 1));
  const out = { window: { start: window[0], end: window.at(-1), weeks, alignedDates: window.slice(1) }, symbols: {}, source: { api: "https://query1.finance.yahoo.com/v8/finance/chart", requestUrls: urls, fetchedAt: new Date().toISOString() } };
  for (const s of symbols) {
    const closes = window.map((w) => per[s].get(w));
    const returns = [];
    for (let i = 1; i < window.length; i++) returns.push(closes[i] / closes[i - 1] - 1);
    out.symbols[s] = { closes, returns };
  }
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith("fetch-prices.mjs");
if (isMain) {
  const book = JSON.parse(readFileSync(resolve(ROOT, "config/book.json"), "utf8"));
  const symbols = [book.index.ticker, ...book.holdings.map((h) => h.ticker)];
  const prices = await buildPrices({ symbols, weeks: book.weeks, endDate: new Date().toISOString().slice(0, 10) });
  mkdirSync(resolve(ROOT, "fixtures"), { recursive: true });
  const file = resolve(ROOT, "fixtures/prices.json");
  writeFileSync(file, JSON.stringify(prices, null, 1));
  const n = prices.window.alignedDates.length;
  console.log(`Window ${prices.window.start} -> ${prices.window.end}; ${n} aligned weekly returns per name.`);
  for (const s of symbols) console.log(`  ${s}: ${prices.symbols[s].returns.length} returns`);
  console.log(`Saved ${file}`);
}
