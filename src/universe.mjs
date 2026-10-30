// The consumer universe: every name the desk prices, grouped by the sub-sector
// whose taste basket it is measured against. Keeping the basket per sector rather
// than per name is what lets the book grow without multiplying Qloo calls.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./env.mjs";

// An apostrophe inside a word is part of the word, not a separator, but the
// possessive clitic is not brand meaning: "Jack Daniels" and "Jack Daniel's" are
// the same listing, and "The Hershey Company" must be reachable from "Hershey's"
// rather than from a token "hersheys" no entity uses.
export const norm = (s) => String(s ?? "")
  .toLowerCase()
  .replace(/[']s(?=\b)/g, "")
  .replace(/[’‘`]s(?=\b)/g, "")
  .replace(/['’`]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

// Every way a name is allowed to ask Qloo for itself, in order, each with the
// cache file that attempt lives in. The primary query is what a reader would
// call the brand; the alternates are what the live index calls it, learned from
// the previous pass rather than guessed. Cache names are per attempt — one file
// per query — because two alternates sharing a file silently overwrites the
// first answer and the provenance then points at the wrong request.
export function searchAttempts(name) {
  const attempts = [{ query: name.query, type: "brand", cacheName: `search-${name.ticker}.json` }];
  (name.altQueries ?? []).forEach((q, i) => attempts.push({
    query: q,
    type: "brand",
    // The first alternate keeps the historical `-alt` name so an already-paid
    // call is reused; later ones are numbered.
    cacheName: `search-${name.ticker}${i === 0 ? "-alt" : `-alt${i + 1}`}.json`,
  }));
  (name.placeQueries ?? []).forEach((q, i) => attempts.push({
    query: q,
    type: "place",
    cacheName: `search-${name.ticker}-place${i + 1}.json`,
  }));
  return attempts;
}

export function loadUniverse() {
  const file = JSON.parse(readFileSync(resolve(ROOT, "config/universe.json"), "utf8"));
  const names = [];
  for (const s of file.sectors) {
    for (const n of s.names) names.push({ ...n, sector: s.id, sectorLabel: s.label });
  }
  return {
    sectors: file.sectors,
    note: file.note,
    names,
    byTicker: Object.fromEntries(names.map((n) => [n.ticker, n])),
    featured: names.filter((n) => n.featured),
  };
}

// A resolved entity is accepted when its name is the query, starts with it, or
// contains it on a word boundary. Anything looser silently maps a ticker to the
// wrong brand, which corrupts every number downstream. The boundary form needs a
// query of at least four characters: "Nike, Inc." may match "Nike", but "K" or
// "UGG" must match exactly.
//
// Legal suffixes a listing is named with and a taste graph is not: the ticker's
// company is "Yum China Holdings", the brand in anyone's actual taste is "Yum
// China". Stripping these is safe because they carry no brand meaning; the rule
// deliberately strips nothing else, so "Dollar Tree" can never resolve to an
// entity called "Dollar".
const LEGAL_SUFFIXES = new Set([
  "inc", "llc", "ltd", "plc", "corp", "corporation", "co", "company", "companies",
  "holdings", "holding", "group", "sa", "ag", "nv", "bv", "se", "gmbh", "srl", "as", "ab",
]);

// An entity called "The Home Depot" is the ticker's brand; an entity that merely
// ends with the query — "Mumm Napa" for NAPA, a Napa Valley winery — is someone
// else's brand wearing the query as a suffix. Leading articles are the one prefix
// that carries no brand meaning, so they are the only thing allowed in front of a
// query that appears mid-name.
const LEADING_ARTICLES = new Set(["the", "a"]);

function stripLegalSuffix(words) {
  const out = [...words];
  while (out.length > 1 && LEGAL_SUFFIXES.has(out.at(-1))) out.pop();
  return out;
}

function stripLeadingArticle(words) {
  const out = [...words];
  while (out.length > 1 && LEADING_ARTICLES.has(out[0])) out.shift();
  return out;
}

export function nameMatches(candidateName, query) {
  const a = norm(candidateName), b = norm(query);
  if (!a || !b) return false;
  // Positional tests run on the article-free name: "The Home Depot" is reached by
  // "Home Depot", but nothing is reached by trailing its own name on a bare
  // query — that is how a winery called "Mumm Napa" answered for NAPA.
  const aw = stripLeadingArticle(a.split(" ")).join(" ");
  const bw = stripLeadingArticle(b.split(" ")).join(" ");
  if (aw === bw) return true;
  if (bw.length >= 4 && (aw.startsWith(`${bw} `) || aw.includes(` ${bw} `))) return true;
  // Either side reduced to its brand core, compared exactly.
  const ka = stripLegalSuffix(a.split(" ")).join(" ");
  const kb = stripLegalSuffix(b.split(" ")).join(" ");
  return ka.length >= 4 && kb.length >= 4 && ka === kb;
}
