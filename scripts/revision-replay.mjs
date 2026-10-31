// Offline replay of the desk around Qloo's last catalogue revision.
//
// Usage: node scripts/revision-replay.mjs
// Reads only cached Qloo levels (fixtures/qloo/), committed prices
// (fixtures/prices.json) and the committed desk/series (output/). Never calls
// Qloo, never needs a key, never starts a server.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../src/env.mjs";
import { loadCulturalInputs } from "../src/factor.mjs";
import { loadUniverse } from "../src/universe.mjs";
import {
  computeReplay, verifyCommittedBetas, verifyCommittedBaskets, REVISION_WEEK,
} from "../src/revision-replay.mjs";

const book = JSON.parse(readFileSync(resolve(ROOT, "config/book.json"), "utf8"));
const OUT = process.env.CULTURALBETA_OUTPUT_DIR ? resolve(process.env.CULTURALBETA_OUTPUT_DIR) : resolve(ROOT, "output");
const pricesFile = process.env.CULTURALBETA_PRICES_FILE
  ? resolve(process.env.CULTURALBETA_PRICES_FILE)
  : resolve(ROOT, "fixtures/prices.json");
const deskFile = resolve(OUT, "desk.json");
const seriesFile = resolve(OUT, "series.json");

if (!existsSync(deskFile)) {
  console.error(`No committed desk at ${deskFile}; run npm run compute-betas first.`);
  process.exit(1);
}
if (!existsSync(pricesFile)) {
  console.error(`No prices at ${pricesFile}; run npm run fetch-prices first.`);
  process.exit(1);
}

const desk = JSON.parse(readFileSync(deskFile, "utf8"));
const prices = JSON.parse(readFileSync(pricesFile, "utf8"));
const cultural = loadCulturalInputs(book, loadUniverse());

const computed = computeReplay({
  desk,
  prices,
  cultural,
  book,
  generatedAt: new Date().toISOString(),
});
const replay = computed.replay;

// The replay is only evidence if its "after" side is the committed desk. Both
// checks are exact reconstructions, not tolerance exercises.
const betaCheck = verifyCommittedBetas(computed.after, desk.rows);
const committedSeries = existsSync(seriesFile) ? JSON.parse(readFileSync(seriesFile, "utf8")) : null;
const basketCheck = committedSeries ? verifyCommittedBaskets(cultural, committedSeries, desk.window.alignedDates) : null;
const betaOk = betaCheck.checked > 0 && betaCheck.maxBetaDiff <= 1e-9 && betaCheck.maxTDiff <= 1e-9 && betaCheck.maxDeltaR2Diff <= 1e-9;
const basketOk = !basketCheck || (basketCheck.checked > 0 && basketCheck.exact === basketCheck.checked);
if (!betaOk) {
  throw new Error(`revision replay does not reproduce the committed desk: max |Δbeta| ${betaCheck.maxBetaDiff} across ${betaCheck.checked} names`);
}
if (!basketOk) {
  throw new Error(`revision replay does not reproduce the committed baskets: ${basketCheck.exact}/${basketCheck.checked} exact`);
}

mkdirSync(OUT, { recursive: true });
const outFile = resolve(OUT, "revision-replay.json");
writeFileSync(outFile, JSON.stringify(replay, null, 1));

const f = (v, d = 3) => (v === null || v === undefined || !Number.isFinite(v) ? String(v) : v.toFixed(d));
const pad = (v, n) => String(v).padEnd(n);
const lpad = (v, n) => String(v).padStart(n);

console.log(`Revision replay: real ${REVISION_WEEK} Qloo catalogue revision (offline, cached data)`);
console.log(`Before (through ${replay.vintageBefore.through}): ${replay.vintageBefore.weeks} weeks, ${replay.vintageBefore.priced} priced, ${replay.vintageBefore.flagCount} flagged`);
console.log(`After  (through ${replay.vintageAfter.through}): ${replay.vintageAfter.weeks} weeks, ${replay.vintageAfter.priced} priced, ${replay.vintageAfter.flagCount} flagged`);
console.log(`Integrity: ${betaCheck.checked} post-vintage names reproduce desk.json (max |Δbeta| ${betaCheck.maxBetaDiff.toExponential(1)}); ${basketCheck ? `${basketCheck.exact}/${basketCheck.checked} featured baskets reproduce series.json exactly` : "series.json absent, basket cross-check skipped"}`);
console.log("");
console.log("Top 10 movers by |Δbeta| (Δbeta = after - before)");
console.log(`${pad("ticker", 8)}${pad("sector", 13)}${lpad("betaBefore", 12)}${lpad("betaAfter", 11)}${lpad("deltaBeta", 11)}${lpad("tBefore", 9)}${lpad("tAfter", 9)}${lpad("flagB", 7)}${lpad("flagA", 7)}`);
for (const m of replay.movers.slice(0, 10)) {
  console.log(
    pad(m.ticker, 8) + pad(m.sector, 13)
    + lpad(f(m.betaBefore), 12) + lpad(f(m.betaAfter), 11) + lpad(f(m.deltaBeta), 11)
    + lpad(f(m.tBefore, 2), 9) + lpad(f(m.tAfter, 2), 9)
    + lpad(String(m.flagBefore), 7) + lpad(String(m.flagAfter), 7),
  );
}
const s = replay.summary;
console.log("");
console.log(`Summary: names compared ${s.namesCompared}; median |Δbeta| ${f(s.medianAbsDeltaBeta)}; p90 ${f(s.p90AbsDeltaBeta)}; max ${f(s.maxAbsDeltaBeta)}; flips ${s.flips}${s.flipTickers.length ? ` (${s.flipTickers.join(", ")})` : ""}`);
console.log(`Saved ${outFile}`);
