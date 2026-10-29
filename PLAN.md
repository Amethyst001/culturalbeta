# Cultural Beta — Study & Costed Build Plan

Status: **RESEARCH COMPLETE — AWAITING OWNER APPROVAL**
Date: 2026-10-29

## 1. Verdict

The idea is **sound and the needed data exists**. Qloo has a real weekly time-series endpoint
that is a natural fit for a "cultural beta" factor. One acceptance requirement in the original
brief (per-row request id) is **not supported by the documented API schema and must be adapted**;
two facts (key issuance, quota) can only be confirmed once we hold the real hackathon key.

**Green light is CONDITIONAL**: obtain the real key (takes days), probe it, then build.

## 2. What the research verified (from live Qloo docs, not assumptions)

### 2.1 Access model — how you actually get the data
- Hackathon API key is requested via Google Form, emailed manually **within a few business days**.
  Form: https://forms.gle/zz12orkLHTAneLGz6
- Key is valid ONLY against `https://hackathon.api.qloo.com` (NOT staging/production).
- Auth = `X-Api-Key` header (NOT Bearer, NOT query param).
- Quota/rate limits: published only as "high enough for typical hackathon projects"; can be raised
  per-user via the Discord `#api-help`. Exact numbers require the live key.
- Keys stay active through judging, then deactivated.

### 2.2 The decisive data product — weekly time series EXISTS
`GET /v2/trending` — confirmed from the official OpenAPI schema (docs MCP `get-endpoint`):
- Params: `filter.type` (required; brands = `urn:entity:brand`), `filter.start_date`,
  `filter.end_date` (ISO YYYY-MM-DD), `signal.interests.entities` (comma-separated entity UUIDs),
  `take` (≤50, default 20), `page`/`offset` (pagination).
- Response (per entity, per week): `date`, `population_percentile`, `population_rank`,
  `population_rank_velocity`, `velocity_fold_change`, `population_percent_delta`.
- This is a genuine **weekly taste-popularity time series** per brand — exactly the raw material
  for weekly taste momentum as a factor.

### 2.3 Supporting endpoints (for entity mapping + provenance)
- `GET /search` — entity lookup by name. Params: `query`, `types` (incl. `urn:entity:brand`),
  `take`, `page`, `sort_by`, optional `filter.location`/`filter.radius`.
- `GET /v2/insights` — taste insights; `filter.type` incl. `urn:entity:brand`; has a **`bias.trends`**
  parameter (how much trends alter results) — trends are native to the Insights API.
- Legacy `/recommendations` and `/recs` are **NOT** supported; use `/v2/insights`.
- `urn:entity:audience` is deprecated for `filter.type`.

### 2.4 Constraint discovered (adapts acceptance test 1)
The documented `/v2/trending` 200 response schema is:
`{ success, duration, results: { trending: [ { date, population_percentile, population_rank,
   population_rank_velocity, velocity_fold_change, population_percent_delta } ] } }`
- **There is NO `requestId`/`request_id` field anywhere** in the documented API schema.
- So "every cultural-beta row carries the Qloo request id" (brief test 1) cannot be met as written.
- **Adaptation:** every cultural-beta row instead traces to the committed fixture file + the
  `duration`/`success` envelope and the exact request parameters. Provenance = request params +
  stored response file. This is honest traceability (the docs themselves carry no request id).

## 3. Team / codex decisions (adopt / adapt / reject)

| Decision | Verdict | Why |
|---|---|---|
| `/v2/trending` as the factor source | **ADOPT** | Real weekly time series exists; directly matches "weekly taste momentum." |
| `urn:entity:brand` entity type | **ADOPT** | Supported; our 7 holdings are consumer brands. |
| Shortlist = exactly 7 holdings | **ADOPT** | Fixed by brief; no portfolio builder. |
| Market beta (index) from weekly closes | **ADOPT** | Standard regression on 106 weeks. |
| Snapshot method (compare/rank) fallback | **ADAPT → fallback only** | Only if trends can't give 106 weekly points for a name. |
| Per-row request id | **REJECT (not in API)** | Replace with provenance = fixture file + params + envelope. |
| Simulated Qloo data | **REJECT always** | Hard rule; Qloo CTO on panel. |
| Live Qloo calls from a browser | **REJECT** | API doc + kit: keep live calls on server/backend with key as secret; browser → backend. |

## 4. Recommended construction

**Cultural factor** = weekly taste momentum per brand, built from `/v2/trending`:
- For each of the 7 brand entities, fetch `population_rank_velocity` (or
  `velocity_fold_change`) per week over the 106-week window.
- Convert to weekly taste-return series; compute a **taste-similarity basket** of the 7 names
  weighted by shared audience affinity, or a market-wide taste factor.
- **Regression (per holding):** weekly return ~ index return + taste-basket return over 106 weeks.
  - Index coefficient = **market beta**
  - Taste-basket coefficient = **cultural beta**, with its **standard error**.
- Report both; flag rows whose cultural beta is not significant; never drop rows to look clean.

**Why this construction:** the brief's preferred "compute weekly taste momentum per brand and use
it directly as the factor" is what `/v2/trending` was literally built for. If 106 weekly points
are not obtainable for a name (data floor), fall back to the snapshot/compare method for that name
and document it. Both are honest; inventing a series is not.

## 5. Data feasibility — the 106-week window
- Need 106 weeks of weekly closes per ticker (Yahoo Finance) aligned by week.
- ~106 weeks back from 2026-10-29 ≈ **Oct/Nov 2024 → Oct 2026**.
- Caveat to confirm at build: ticker availability on the exact dates; some names may delist/IPO
  into the window (e.g. if any of the 7 listed after 2024). If fewer than 4 of 7 have usable
  signals, the brief says report the sample floor honestly — do not widen the floor.

## 6. Cost / risk ledger (what "count the cost" means here)

| # | Risk | Mitigation | Status |
|---|---|---|---|
| 1 | Key issuance takes days; no key in env yet | Request key NOW via form; build only after probe | **BLOCKING** |
| 2 | Quota/rate limit exact numbers unknown | `qloo doctor`/probe; ask Discord `#api-help` for raise | Verify at step 0 |
| 3 | Request id absent from API | Provenance = fixture file + params (section 2.4) | Resolved (adapt) |
| 4 | e.l.f. 1.92/−0.23 were SIMULATED | Reproduce structure (high market β, negative cultural β), not forced bits; document real number | Decided |
| 5 | No hosted URL / serverless unsupported | Backend runs Qloo call with key as secret; frontend → backend | Design |
| 6 | Data floor <4 of 7 names | Honest floor reporting; don't widen | Process |

## 7. Build order (each step ends with a runnable check)

1. **Probe** — real key in `.env`; one `/v2/trending` + one `/search` + one `/v2/insights` call;
   save raw responses to `fixtures/` incl. `qloo-probe.json`. Check: file exists, real envelope.
2. **Map** — 7 tickers → Qloo entity UUIDs via `/search`; record provenance per row. Check: 7 rows,
   each with a Qloo entity id.
3. **Factor** — fetch `/v2/trending` weekly for all 7 over the 106-week window; align with Yahoo
   weekly closes; compute weekly returns on aligned dates only. Check: 106 weekly returns per name;
   basket weights sum to 1.
4. **Regression** — per holding: return ~ index + taste basket; report market β, cultural β ± s.e.
   Check: e.l.f. reproduces structure (market β ~1.9+, cultural β negative) on real data.
5. **Desk** — one-page UI: holdings, market β, cultural β ± s.e., flag column, provenance per row
   (fixture file + params). Check: readable by a stranger in 15 s.
6. **Evidence** — host page publicly (Qolo infra), record 90 s demo per beat sheet. Check: URL
   public, video public.

## 8. Stop conditions (from brief, preserved)
- No key → `BLOCKED.md`, stop.
- No weekly time series → snapshot method, document it.
- Fewer than 4/7 usable signals → report sample floor honestly.
- Insignificant beta → show the standard error; do not drop the row.

## 9. Open items genuinely the owner's to decide
1. **Approve the request-id adaptation** (provenance = fixture + params, not a numeric request id).
2. **Confirm the 7 tickers** (the brief says "seven-stock consumer book" but doesn't name them;
   e.l.f. is explicit, the other six need to be specified, ideally brand entities Qloo covers).
3. **Key request**: authorize me to submit the API key request form + run the real probe
   (step 0), and confirm whether you already requested a key through the form and are awaiting email.
4. **Housing**: are we taking the kitchen-sink `Random` root or a clean `culturalbeta/` project dir?
