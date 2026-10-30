// Entity resolution is the hidden cost of a hundred names: a loose match maps a
// ticker to the wrong brand and corrupts every number downstream. These pin the
// boundary rule and the shape of the book.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadUniverse, nameMatches, norm, searchAttempts } from "../src/universe.mjs";

test("the universe is a complete, unique, sector-labelled book", () => {
  const u = loadUniverse();
  assert.equal(u.sectors.length, 11);
  assert.ok(u.names.length >= 100, `expected 100+ names, got ${u.names.length}`);
  assert.equal(new Set(u.names.map((n) => n.ticker)).size, u.names.length, "tickers must be unique");
  for (const n of u.names) {
    assert.ok(n.query, `${n.ticker} has no Qloo query`);
    assert.ok(n.sector && n.sectorLabel, `${n.ticker} has no sector`);
  }
  assert.equal(u.featured.length, 7);
  assert.deepEqual(
    u.featured.map((n) => n.ticker).sort(),
    ["CMG", "DIS", "ELF", "LULU", "MCD", "NKE", "SBUX"],
  );
});

test("the match rule accepts a longer or qualified entity name, on word boundaries", () => {
  assert.ok(nameMatches("Nike", "Nike"));
  assert.ok(nameMatches("Nike, Inc.", "Nike"));
  assert.ok(nameMatches("Chipotle Mexican Grill", "Chipotle"));
  assert.ok(nameMatches("Starbucks Corporation", "Starbucks"));
  assert.ok(nameMatches("McDonald's Corporation", "McDonald's"));
});

test("the match rule refuses neighbours that merely contain the query", () => {
  assert.ok(!nameMatches("Nikkei 225", "Nike"));
  assert.ok(!nameMatches("Coty", "Cote"));
  assert.ok(!nameMatches("PF Chang's", "Chipotle"));
  assert.ok(!nameMatches("", "Nike"));
  assert.ok(!nameMatches("Nike", ""));
  // A query under four characters may only match exactly, or "K" would resolve
  // to anything with a K in its name.
  assert.ok(!nameMatches("Kellanova Holdings", "K"));
  assert.ok(nameMatches("K", "K"));
  assert.ok(!nameMatches("UGG Boots", "UGG"));
});

test("normalisation folds case, accents' punctuation and spacing", () => {
  assert.equal(norm("  Estée  Lauder, Inc. "), "est e lauder inc");
  assert.equal(norm("D.R. Horton"), "d r horton");
});

// Both of these were found against live Qloo responses, not invented: the
// possessive rule cost Hershey and Campbell their only match, and the suffix
// rule handed Genuine Parts (NAPA) to a Napa Valley winery.
test("a possessive clitic is not part of the brand core", () => {
  assert.equal(norm("Hershey's"), "hershey");
  assert.ok(nameMatches("The Hershey Company", "Hershey's"));
  assert.ok(nameMatches("Campbell Soup Company", "Campbell's"));
  assert.ok(nameMatches("Jack Daniels", "Jack Daniels"));
});

test("an entity only matches as a trailing token when an article is in front", () => {
  assert.ok(nameMatches("The Home Depot", "Home Depot"));
  assert.ok(!nameMatches("Mumm Napa", "NAPA"), "a winery must not answer for NAPA Auto Parts");
  assert.ok(!nameMatches("Grand Mumm", "Mumm"));
});

// The first pass gave every alternate query the same cache file, so a second
// alternate overwrote the first and the provenance pointed at the wrong request.
test("attempts are numbered per query, so two alternates never share a cache file", () => {
  const a = searchAttempts({ ticker: "X", query: "One", altQueries: ["Two", "Three"], placeQueries: ["Four"] });
  assert.deepEqual(a.map((x) => x.cacheName), ["search-X.json", "search-X-alt.json", "search-X-alt2.json", "search-X-place1.json"]);
  assert.deepEqual(a.map((x) => x.type), ["brand", "brand", "brand", "place"]);
  const files = loadUniverse().names.flatMap(searchAttempts).map((x) => x.cacheName);
  assert.equal(new Set(files).size, files.length, "cache names must be unique across the book");
});
