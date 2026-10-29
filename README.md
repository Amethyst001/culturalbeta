# Cultural Beta — a consumer equity desk

Market beta says how a stock moves with the index. **Cultural beta says how much of
that movement is exposure to taste.** This desk reports both, side by side, for a
fixed seven-stock consumer book over 106 aligned weeks.

Built for the Qloo Agentic Hackathon. Qloo is load-bearing: **without live Qloo
responses the desk refuses to print.** There is no simulated Qloo data anywhere —
not labelled, not as a fallback. The null-route test (`tests/nullroute.test.mjs`)
enforces it.

## Factor construction (which method was used, and why)

We used the **time-series construction**, enabled by Qloo's
`GET /v2/trending` endpoint, which returns **weekly** popularity-trend statistics
per entity (`population_percentile`, `population_rank`, `population_rank_velocity`,
`velocity_fold_change`, `population_percent_delta`) over a requested date range:

1. Each holding's brand is resolved to a Qloo entity via `GET /search`
   (`types=urn:entity:brand`).
2. Weekly taste momentum per brand: `tasteReturn_t = ln(velocity_fold_change_t)`
   (fallback field `population_percent_delta/100` when the ratio is unusable).
3. **Taste-similarity basket**: for holding *i*, the other holdings are weighted by
   Qloo shared-audience affinity (`GET /v2/insights` with brand *i* as
   `signal.interests.entities`, the rest as `filter.results.entities`, sorted by
   `affinity`), normalized to sum to 1. Leave-one-out, so a holding never regresses
   on itself.
4. Per holding, OLS on 106 aligned weekly returns:
   `return_t = a + b_market · SPY_t + b_cultural · basket_t + e_t`.
   `b_cultural` is the cultural beta, reported with its standard error.

Why this construction: Qloo exposes a genuine weekly series, so the factor is
computed directly from it rather than approximated by the snapshot method. The
snapshot method (documented in the plan) remains the declared fallback only if a
name lacks ≥100 weekly trend points — such rows are marked
**"insufficient signal"** and their betas are not printed.

## Robustness

Two tests answer the question a sceptical reader asks before believing a factor:

1. **Out of sample.** The same nested comparison — market-only vs market + taste basket — is
   re-estimated on the first 70 weeks and scored on the last 36. The held-out ΔR² is reported
   as computed, including when it is negative. Nothing is clamped.
2. **Circular-rotation placebo.** Every taste basket is rotated against returns by the same
   shift per draw (400 draws, fixed seed), which preserves the series' autocorrelation and the
   cross-holding alignment and destroys only its alignment with returns. `p` is the share of
   rotations whose book-mean ΔR² matches or beats the real one.

Both are deterministic (no model in the loop) and covered by `tests/robustness.test.mjs`: a
planted factor is found, an unrelated one is not, an out-of-sample ΔR² goes negative when the
factor stops working, and the rotation is reproducible from its seed. `src/robustness.mjs` holds
the code; `scripts/compute-betas.mjs` writes the book-level results to `valueAdd.oos` and
`valueAdd.placebo`, and a per-holding `oos` and `placeboP` on every priced row.

## Provenance

The documented Qloo API response carries **no request-id field** (verified against
the live OpenAPI schema via `docs.qloo.com/mcp` — response is
`{success, duration, results:{trending:[…]}}`). Provenance is therefore the
**cached raw response file + the exact request parameters**, held locally under
`fixtures/qloo/`. Per Qloo's own hackathon terms ("Do not store Qloo response data
in a public repository"), those cached responses are gitignored — the repo ships
the request shapes and the desk's provenance rows, the responses are demonstrated
live. Every row in the desk shows its fixture path, entity id, and request window.
Price figures trace to the committed `fixtures/prices.json`, which records the
Yahoo request URL per symbol.

## Book

ELF (reference name), NKE, LULU, CMG, SBUX, MCD, DIS. Index proxy: SPY.
Window: 106 aligned weekly closes, returns computed only on weeks where every
symbol has data. On the committed real prices e.l.f. fits a market beta of
**2.03 ± 0.41** (t = 4.9) against SPY — the same high-market-loading structure the
reference described. The reference numbers 1.92 / −0.23 came from a *simulated*
factor; they are not forced onto real data, and `tests/market-only.test.mjs` pins
the real price-half value instead.

## What the desk shows

- **Desk** — the seven names, market beta next to cultural beta, with the flag rule, and a
  robustness band reporting the out-of-sample ΔR² and the placebo p.
- **Holding** — one name: price vs taste indexed to 100, the leave-one-out basket
  weights, and a residualised scatter whose slope is the cultural beta.
- **Taste map** — the book placed by market beta against cultural beta.
- **Evidence** — the Qloo request and cached response behind every cultural beta,
  plus the Yahoo request URL behind every price.

With no Qloo key the cultural column is **withheld** — the desk still serves the
real price half from the committed Yahoo fixture and refuses only the taste half.

## Run

```sh
npm install                 # no runtime deps required (Node 22.19+)
# put the hackathon key in .env as QLOO_API_KEY (see .env.example; key never reaches the browser)
npm run fetch-prices        # fixtures/prices.json — 106 aligned weekly returns per name
node scripts/qloo-map.mjs   # fixtures/qloo/entities.json — brand -> Qloo entity ids
node scripts/qloo-trending.mjs  # weekly taste series per brand
node scripts/qloo-affinity.mjs  # shared-audience affinity matrix
npm run compute-betas       # refuses to print without Qloo fixtures
npm run serve               # desk at http://localhost:8787
npm test                    # ols + null-route + sample-floor + price half + robustness
```

Auth: `X-Api-Key` header against `https://hackathon.api.qloo.com` only.

## Limits

- Exactly seven holdings; no portfolio builder, no optimiser.
- No trading, no order routing, no backtest that claims returns.
- Betas are exposures, not predictions. Affinity scores describe aggregate taste
  populations, never individuals (Qloo safe-use terms).
- No auth, no accounts, no database.

MIT licensed.
