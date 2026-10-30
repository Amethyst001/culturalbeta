# Cold-start & warm-latency measurement

Reproducible with:

```bash
node scripts/cold-start.mjs                 # boot + warm routes + ask latency; spends ZERO Qloo requests
node scripts/cold-start.mjs --live \
     --base http://127.0.0.1:8811           # + observes the live freshness attestation (page-cache replay, 0 requests)
```

The script boots its own desk instances on an OS-assigned ephemeral port with
`AGENT_LIVE_QLOO=0`, so neither the boot prime nor `/api/ask` can reach Qloo; without
`--live` the output states that the live path was not exercised. Every number below is
the median of 3 unless a range is shown. Measured on the developer Windows box over
loopback against the committed `output/desk.json` (401,986 B) and `fixtures/qloo/` (728
cached pages). The shared desk at `127.0.0.1:8811` was never restarted; only throwaway
instances on 8813+ were used and stopped.

## Headline

A judge opening the hosted page does **not** wait tens of seconds: the desk answers the
first `/api/desk.json` byte in **~0.26–0.33 s from a cold process**, and every warm route
is sub-second. The "tens of seconds with no explanation" the review panel feared is not
the boot or the page load — it is the **analyst's first answer**, which is model-provider
inference measured here at **9 s (calm, primary provider) to 195 s (fallback provider
under contention), median ~82–98 s** in this environment. A repeat of the same question is
an answer-cache hit at **~12 ms**.

## 1. Process boot (own instance, live gate off)

| component | default run | `--live` run |
|---|---|---|
| module load — `spawn` → listen log line | 285 ms | 206 ms |
| boot block — listen callback's synchronous `JSON.parse(desk.json)` + tool build, which gates the first request | 50 ms | 49 ms |
| cold first byte — `spawn` → first `GET /api/desk.json` byte | **326 ms** | **255 ms** |
| warm first response — `/api/desk.json` once resident | 7 ms | 6 ms |
| `desk.json` read+parse isolated (`loadDesk` cost) | 6 ms | 3 ms |

`/api/desk.json` itself streams the raw 401 KB file and never parses it; the parse cost
above is what `loadAgentTools` pays once at boot and what `/api/v1/panel`, `/api/agent.json`
and `/api/v1/alerts` pay per call. The boot-to-first-byte number is the honest cold-start a
judge would see only if the process had just started; `systemd Restart=always` keeps it up,
so ordinary navigation pays the **warm** ~6 ms, not the boot.

## 2. Per-route warm latency (median of 3)

Page-load routes are fetched by `desk/app.js` in a single `Promise.all`:
`/api/desk.json`, `/api/series.json`, `/api/evidence.json`, `/api/market-only.json`,
`/api/budget.json`, `/api/agent.json`, `/api/freshness.json`. The static head is
`index.html` → `/app.css` → blocking `/app.js`.

| route | default (ms) | `--live` (ms) | bytes |
|---|---|---|---|
| `/api/budget.json` | 234.2 | 170.6 | 1,138 |
| `/api/market-only.json` | 30.6 | 26.3 | 37,775 |
| `/api/evidence.json` | 16.2 | 17.4 | 128,930 |
| `/api/series.json` | 2.9 | 3.4 | 53,557 |
| `/api/desk.json` | 6.9 | 5.9 | 401,986 |
| `/api/freshness.json` | 11.2 | 11.0 | 52 |
| `/api/agent.json` | 1.3 | 1.3 | 1,117 |
| `/api/v1/panel` *(not on load)* | 18.4 | 17.4 | 238,141 |
| `/api/v1/alerts` *(not on load)* | 11.1 | 11.1 | 47,030 |
| `/export/panel.csv` *(export)* | 15.2 | 15.2 | 59,753 |
| `/` static | 2.3 | 2.3 | 1,850 |
| `/app.css` static | 2.4 | 2.4 | 27,977 |
| `/app.js` static | 3.5 | 3.5 | 170,880 |

Slowest three overall: **`/api/budget.json` (171–234 ms), `/api/market-only.json` (26–31 ms),
`/api/v1/panel` (17–18 ms)**.

Page-load critical path: because the 7 API fetches run concurrently, the ceiling is the
slowest of them — **`/api/budget.json` ≈ 0.17–0.23 s** — not their sum (303 ms if serialized).
Server-side, the whole page load is bounded by that. The judge-visible transfer is a
different matter: **`/api/budget.json` re-`JSON.parse`s all 728 cached `page-*.json` files on
every request** (`spentFromCache` in `src/budget.mjs`) — synchronous CPU/IO that also blocks the
event loop while the other six concurrent fetches wait. On the 1 vCPU Oracle VM with a cold
filesystem this is where a sub-second local route can become seconds.

Total uncompressed first-load wire (see fixes): ~200 KB static + ~625 KB page-load APIs
= **~825 KB**, every visit, because every response carries `cache-control: no-store`.

## 3. Analyst first answer vs repeat answer

Measured against a **gate-off** instance (no Qloo request is possible; the wall time is the
model round trip), plus a gate-on attestation read on `8811` under `--live`.

| case | latency | notes |
|---|---|---|
| first answer, new question | default [74 s, 195 s, 82 s] median 82 s; `--live` batch [98 s, 77 s, 105 s] median 98 s | provider `Nemotron 3.5 Super` / `fallback 2`; `fallback 2` was the slowest |
| earlier, calm, primary provider | 9–17 s | same code, uncontended box |
| repeat answer, same question (cache hit) | **11–13 ms** | `cached:true`, skips the model and the rate limiter |
| different question | another ~80–195 s | uncached → full model round trip |
| cache saving | ~81.5 s per repeat | |

Freshness attestation on a real answer (gate-on, `8811`, `--live`):
- The page-load poll of `/api/freshness.json` is **read-only**: `fromCache:true`, `requests:0`,
  `fromCachedPage:true`. Opening the page never spends a request.
- The answer carried `checked:true`, `requests:0`, `pages:1`, **`fromCachedPage:true`** — a
  **replay from the page cache, not a live read**. The checker's 15-minute memory had expired,
  so the probe re-ran, but the re-run hit the disk page cache (`fixtures/qloo/…2026-11-02.json`)
  and spent nothing.
- Measured probe wall time on replay = **5 ms**. The single cold-process exception is the first
  `qloo --version` subprocess spawn (~6.6 s, seen in the committed `requestedAt→respondedAt` of
  the boot attestation); `version()` is memoized per process, so every replay after that is ~5 ms.

**Qloo budget accounting** (`output/live-qloo-budget.json`, `{date, requests, ops}`):
- File read **38 requests** at session start; it rose to **40** during the session from
  concurrent shared-host activity on other desk instances (a boot prime on 8812) — not from me.
- Bracketing my `/api/ask` exercise and both full script runs: **requests 40 → 40 = delta 0**.
- `ops` 259 → 260 = **+1**: the accounting counts a page-cache *replay* as an operation, not a
  request (`settle` bumps `ops` by `calls.length` even when `spent:0`). **I spent 0 of the
  2-request allowance; the `--live` path rides the committed page cache.**

## 4. Freshness probe vs model call: concurrency in `/api/ask`

They **run concurrently**. The non-cached branch of `server/desk-server.mjs` starts the
attestation before awaiting the model and joins it after:

```js
const freshP = attestation(checker);          // probe starts
const out = await askQuestion({ question, tools, providers }); // model runs
const freshness = await freshP;               // only the remainder is waited on
```

(The cached branch awaits only the attestation — there is no model call to overlap.)

What it would cost if they did **not** overlap, quantified:

- warm answer, replayed probe: probe ≈ **5 ms** → concurrency saves ~**5 ms**; sequential
  answer = model + 5 ms (trivial). So concurrency earns nothing on the warm path — the warm
  probe is already free.
- cold first answer of a new grid week (no disk page yet) → the probe is a real live read,
  documented at **~13–26 s** (`createFreshnessChecker`/`prime` comments) with a hard cap of
  **45 s** (`FRESHNESS.timeoutMs`; `output/desk-8812.log` shows a cold probe hitting the 45 s
  `freshness_timeout`). Concurrent: wait ≈ `max(model, probe)` ≈ the model round trip, probe
  hidden behind it. Sequential: wait ≈ `model + (13…45 s)` added to that first answer.

So the value of the concurrency + the boot-time `prime()` is entirely on the **cold first
answer**: it is what keeps a 13–45 s live read off the critical path. Do not serialize it.

## What is unavoidable for a judge vs ours

Unavoidable (not our code):
- **Model inference** on an uncached first answer (9–195 s here). The only lever we hold is
  cache warmth and provider choice, not the LLM's latency itself.
- **A genuine live Qloo read** on the first answer of a *new grid week* (page cache is keyed to
  the Monday grid date; a fresh week has no cached page) — ~13–26 s, capped 45 s. Mitigated to
  "off the critical path" by the concurrency + boot prime above, and to "0 requests within the
  same week" by shipping `fixtures/qloo/`.
- **Node cold start** (~0.2–0.3 s) — but only on a deploy/restart; `systemd` keeps the process
  up, so opening the page pays ~0 of it.

Ours to fix (avoidable):
- No gzip and `cache-control: no-store` on every response → ~825 KB re-fetched, uncompressed,
  every visit.
- `/api/budget.json` re-parsing 728 cache files on the critical path, blocking the event loop.
- A cold answer cache → the judge's first question eats the full model latency instead of a
  ~12 ms hit.
- Provider fallback to a slow provider on the first answer.

## Prioritised fixes

| # | fix | latency it saves | code or config | avoidable? |
|---|---|---|---|---|
| 1 | **Pre-warm the answer cache** before the judge arrives: on boot (and/or a keep-warm job) `POST /api/ask` the likely opening questions so a judge's first real question is a cache hit. | turns a **9–195 s** first answer into **~12 ms** for the questions a judge is likely to ask | code (a small boot warm-list) — no Qloo spent, only model calls | ours, and the single biggest judge-facing win |
| 2 | **Enable `gzip` in the nginx vhost** (`deploy/install.sh` has none) for `text/html, css, js, json, csv`. | ~825 KB → ~130 KB on first paint; the first-transfer win over WAN to the judge | deployment config only | ours |
| 3 | **Drop `no-store` for cacheable responses** — static assets and the immutable committed panel/series/evidence JSON with an `ETag`/`max-age` (the `send()` helper in `server/desk-server.mjs` stamps `no-store` on everything). | removes the full ~825 KB on every repeat navigation | code (per-route headers) | ours |
| 4 | **Memoize `/api/budget.json`'s `spentFromCache`** by `(dir, file count, newest mtime)`, or precompute the spent count at pipeline time and read it. | ~0.17–0.23 s here; likely seconds on the 1 vCPU VM, and it un-blocks the six concurrent page-load fetches | code | ours |
| 5 | **Order/timeout the providers** so a fallback to the slow `fallback 2` provider is bounded or avoided on the first answer (`.env` provider list). | removes the 105–195 s tail vs the 9–17 s primary-provider path | deployment config | ours |
| 6 | **Keep the freshness probe concurrent + boot-primed, and ship `fixtures/qloo/`.** | keeps a 13–45 s cold live read off the answer's critical path and makes within-week attestations cost 0 requests | already implemented — do not regress | mitigation of an unavoidable cost |

Not on the table: anything that reduces the model's own inference time or removes the need for
a first live read of a brand-new grid week — those are inherent to the analyst answering a cold
question, and #1 is the way we make them invisible to the judge rather than actually cheaper.
