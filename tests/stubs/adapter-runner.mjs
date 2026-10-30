// Exercises the real adapters in src/qloo.mjs against the stub harness. Run as a
// child process because the harness binary is chosen when the module loads.
import { qlooSearch, searchResults, qlooRecommend, qlooSeries } from "../../src/qloo.mjs";

const out = {};
try {
  const search = await qlooSearch("e.l.f. Cosmetics", { take: 5, cacheName: "search-TEST.json" });
  // The real CLI prints a bare array keyed by entity_id; the parser is the only
  // place that shape is allowed to be understood.
  out.searchRawIsArray = Array.isArray(search);
  out.search = searchResults(search)[0] ?? null;
} catch (e) { out.searchError = { code: e.code, message: e.message }; }

try {
  const rec = await qlooRecommend("urn:entity:brand:q-elf", "movie", { limit: 10, cacheName: "recommend-TEST.json" });
  out.recommend = {
    count: rec.results?.length ?? 0,
    first: rec.results?.[0] ?? null,
    correlationId: rec.execution?.correlation_id ?? null,
    surface: rec.surface ?? "exec recommend",
    fallbackFrom: rec.fallbackFrom ?? null,
  };
} catch (e) { out.recommendError = { code: e.code, message: e.message }; }

try {
  const ser = await qlooSeries(
    ["urn:entity:brand:q-a", "urn:entity:brand:q-b", "urn:entity:movie:q-c"],
    "brand",
    { start: "2024-01-01", end: "2025-01-06", cacheName: "series-TEST.json" },
  );
  out.series = {
    calls: ser.calls.length,
    limits: ser.calls.map((c) => c.input.limit),
    entitiesPerCall: ser.calls.map((c) => c.input.entities.length),
    pointsPerCall: ser.calls.map((c) => c.points),
    weeks: [...ser.byEntity.values()].map((p) => p.length),
    first: [...ser.byEntity.values()][0]?.[0]?.date ?? null,
    last: [...ser.byEntity.values()][0]?.at(-1)?.date ?? null,
  };
} catch (e) { out.seriesError = { code: e.code, message: e.message }; }

try {
  const ten = Array.from({ length: 10 }, (_, i) => `urn:entity:brand:sig-${i}`);
  const rec = await qlooRecommend(ten, "brand", { limit: 3, cacheName: "recommend-ten.json" });
  out.signals = { count: rec.results?.length ?? 0, sent: ten.length };
} catch (e) { out.signalsError = { code: e.code, message: e.message }; }

try {
  await qlooRecommend(Array.from({ length: 11 }, (_, i) => `urn:entity:brand:sig-${i}`), "brand", { limit: 3 });
  out.eleven = "no error";
} catch (e) { out.elevenError = { code: e.code, message: e.message }; }

try {
  await qlooSeries(["a", "b", "c", "d", "e", "f"], "brand", { start: "2024-01-01", end: "2024-02-01" });
  out.batch = "no error";
} catch (e) { out.batchError = { code: e.code, message: e.message }; }

process.stdout.write(JSON.stringify(out));
