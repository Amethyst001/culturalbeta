// Weekly bars from Yahoo Chart API, aligned by ISO week (Monday key), returns
// computed on aligned dates only. Output is committed as a fixture: every
// displayed price number traces to this file + the request URL inside it.
//
// The window is judged per symbol, not per book: a ticker with a missing week is
// dropped and reported rather than shortening the calendar for all 100 names.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../src/env.mjs";
import { loadUniverse } from "../src/universe.mjs";

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
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 600 * attempt));
    try {
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
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

export async function buildPrices({ symbols, weeks, priorWeeks = 0, indexTicket }) {
  const list = symbols.map((s) => (typeof s === "string" ? { ticker: s, yahoo: s } : s));
  const per = {};
  const urls = {};
  const failed = [];
  for (const s of list) {
    try {
      const { map, url } = await weeklyCloses(s.yahoo);
      per[s.ticker] = map;
      urls[s.ticker] = url;
    } catch (err) {
      failed.push({ ticker: s.ticker, reason: err.message });
    }
  }
  const index = indexTicket ?? list[0].ticker;
  if (!per[index]) throw new Error(`Index ${index} could not be fetched — refusing to align against a missing calendar.`);
  const need = weeks + priorWeeks + 1;
  const calendar = [...per[index].keys()].sort();
  if (calendar.length < need) {
    throw new Error(`Alignment floor: the index has only ${calendar.length} weekly bars (< ${need} needed for ${weeks}${priorWeeks ? ` + ${priorWeeks} prior` : ""} returns).`);
  }
  const win = calendar.slice(-need);
  // Returns are disjoint even though the bars touch: the prior window's last
  // return ends where the primary window's first return begins.
  const primaryBars = win.slice(priorWeeks);
  const primaryDates = primaryBars.slice(1);

  const dropped = [...failed];
  const kept = [];
  for (const s of list) {
    if (!per[s.ticker]) continue;
    const missing = win.filter((w) => !per[s.ticker].has(w));
    if (missing.length) { dropped.push({ ticker: s.ticker, reason: `${missing.length} of ${win.length} weeks missing` }); continue; }
    kept.push(s.ticker);
  }
  if (kept.length < Math.ceil(list.length * 0.6)) {
    throw new Error(`Alignment floor: only ${kept.length}/${list.length} symbols have every week in the window. Refusing to price a fragment of the book.`);
  }

  const rets = (t, datesWin) => {
    const closes = datesWin.map((w) => per[t].get(w));
    const returns = [];
    for (let i = 1; i < datesWin.length; i++) returns.push(closes[i] / closes[i - 1] - 1);
    return { closes, returns };
  };
  const out = {
    window: { start: primaryBars[0], end: primaryBars.at(-1), weeks, alignedDates: primaryDates },
    symbols: {},
    dropped,
    source: { api: "https://query1.finance.yahoo.com/v8/finance/chart", requestUrls: urls, fetchedAt: new Date().toISOString() },
  };
  for (const t of kept) {
    out.symbols[t] = rets(t, primaryBars);
    if (priorWeeks) {
      const priorBars = win.slice(0, priorWeeks + 1);
      const p = rets(t, priorBars);
      out.symbols[t].priorCloses = p.closes;
      out.symbols[t].priorReturns = p.returns;
    }
  }
  if (priorWeeks) out.priorWindow = { start: win[0], end: win[priorWeeks], weeks: priorWeeks, alignedDates: win.slice(1, priorWeeks + 1) };
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith("fetch-prices.mjs");
if (isMain) {
  const book = JSON.parse(readFileSync(resolve(ROOT, "config/book.json"), "utf8"));
  const universe = loadUniverse();
  const symbols = [book.index.ticker, ...universe.names.map((n) => ({ ticker: n.ticker, yahoo: n.yahoo ?? n.ticker }))];
  const prices = await buildPrices({ symbols, weeks: book.weeks, priorWeeks: book.secondWindow?.weeks ?? 0, indexTicket: book.index.ticker });
  mkdirSync(resolve(ROOT, "fixtures"), { recursive: true });
  const file = resolve(ROOT, "fixtures/prices.json");
  writeFileSync(file, JSON.stringify(prices, null, 1));
  console.log(`Window ${prices.window.start} -> ${prices.window.end}; ${prices.window.alignedDates.length} aligned weekly returns.`);
  if (prices.priorWindow) console.log(`Prior window ${prices.priorWindow.start} -> ${prices.priorWindow.end}; ${prices.priorWindow.alignedDates.length} aligned weekly returns.`);
  console.log(`Priced ${Object.keys(prices.symbols).length} symbols${prices.dropped.length ? `, dropped ${prices.dropped.length}: ${prices.dropped.map((d) => d.ticker).join(", ")}` : ""}`);
  console.log(`Saved ${file}`);
}
