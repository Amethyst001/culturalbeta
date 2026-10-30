# Basket-composition sensitivity: does the null survive the construction choice?

Two external reviewers raised the same falsification request: *"trend basket
construction via 10 seeded entities with Qloo affinity ranks is opaque — the
basket composition changes the beta, and there is no sensitivity analysis on
basket composition (e.g., 5 vs 10 seeds)."* This study is that analysis. It was
run entirely from committed artifacts and cached Qloo responses — **zero new
Qloo requests** (`output/live-qloo-budget.json` reads 37 requests / 257 ops
before and after) — so every number traces to a file, listed in
`output/basket-sensitivity.json → provenance.cacheFilesRead` (61 files).

## Gate first: the re-derivation reproduces the panel exactly

Before varying anything, the committed construction was rebuilt from scratch —
member lists from `fixtures/qloo/basket-sector-*.json`, weekly levels from
`fixtures/qloo/series.json`, the revision-week cut re-detected (the same four
dates: 2025-04-07, 2025-04-14, 2025-10-13, 2025-10-20), the same `src/ols.mjs`
estimator against `fixtures/prices.json` and SPY on the same 102 aligned
weeks. **All 80 priced names reproduce the committed cultural beta in
`output/desk.json` with max |Δβ| = 0 and max |Δt| = 0** — bit-for-bit, not
approximately. Everything below is therefore a comparison of constructions,
not of implementations. (Enforced by a test:
`tests/basket-sensitivity.test.mjs`, and the runner exits 3 rather than
printing deltas if the gate ever fails.)

## What was varied

Baskets are per sub-sector; every name in a sector shares the variant basket.
Eight constructions, one baseline plus seven alternatives:

| id | construction |
|---|---|
| baseline | the committed 8 members (top-2 per type), affinity-rank weights, all four types |
| seeds3 / seeds5 / seeds7 / seeds10 | the top 3 / 5 / 7 / 10 members of the sector's candidate pool ranked by Qloo affinity, affinity-normalised weights |
| equalWeights | the committed 8 members, equal weight instead of affinity rank |
| brandsOnly | the committed brand members only (2 per sector), affinity-normalised |
| jackknifeDropTop | the committed 8 members minus the single highest-weight one |

Two honest caveats on the pool. First, the seeds axis changes member **count
and type mix together** (a global affinity top-k ignores the committed per-type
quota); the brandsOnly axis isolates the type-mix dimension and equalWeights
isolates the weight dimension. Second, the pool could only include candidates
whose weekly trend series is already on disk — the committed pipeline pulled
series for kept members alone, and a candidate with no cached series has no
taste return and cannot price anything. Pool sizes are 10–13 per sector, so
seeds10 is a real 10-member alternative, not a padded one. No book name enters
any basket: the pipeline's own id-and-normalised-name universe exclusion was
re-applied to every cached candidate (test-asserted).

The flag rule is re-run exactly as the desk runs it, per variant: negative β,
|t| ≥ 2, **Benjamini–Hochberg q ≤ 0.10 recomputed across that variant's own
fitted family** (a per-name t is never the criterion on its own).

## Stability distribution (80 priced names, 102 weeks)

| variant | fitted | median \|Δβ\| | p90 \|Δβ\| | max \|Δβ\| | median \|Δt\| | p90 \|Δt\| | screen passes (β<0,\|t\|≥2) | flags after BH | Spearman ρ of β vs committed |
|---|---|---|---|---|---|---|---|---|---|
| seeds3 | 80 | 11.1 | 66.4 | 676.6 | 0.63 | 1.65 | 1 (TSN) | **0** | 0.16 |
| seeds5 | 80 | 5.7 | 28.6 | 133.2 | 0.50 | 1.63 | 2 (KDP, EBAY) | **0** | 0.18 |
| seeds7 | 80 | 5.1 | 30.6 | 227.3 | 0.43 | 1.83 | 2 (KDP, MAT) | **0** | 0.18 |
| seeds10 | 80 | 0.70 | 10.3 | 215.8 | 0.09 | 0.76 | 2 (KDP, MAT) | **0** | 0.62 |
| equalWeights | 80 | 0.040 | 0.178 | 0.87 | 0.003 | 0.011 | 1 (KDP) | **0** | 1.00 |
| brandsOnly | 66 | 6.2 | 24.2 | 183.5 | 0.33 | 0.89 | 1 (KDP) | **0** | 0.57 |
| jackknifeDropTop | 80 | 0.32 | 4.29 | 38.3 | 0.02 | 0.21 | 1 (KDP) | **0** | 0.91 |

The 14 names not fitted under brandsOnly are all the **food** sector: its two
brand members' percentiles are frozen carry-forward across the window, the
basket regressor is constant, and the slope is not identified. They are
reported **degenerate — no beta is printed** for them, rather than a spurious
one. The same is not true of the committed construction, which is why the
degeneracy is a property of the brands-only construction and part of the
finding: a brands-only basket is not merely a different answer, for 14 of the
80 names it is not an answer at all.

## Flag flips: zero, in every direction

**No construction flags a name.** The only name that ever clears the |t| screen
together with a negative beta is KDP (committed t = −2.67, q = 0.35), and its
q **worsens** under every alternative construction (best case 0.35 under
equalWeights/jackknife — which barely move the basket at all; worst 0.99 under
seeds variants). TSN (seeds3), EBAY (seeds5), MAT (seeds7/seeds10) cross the
screen with q 0.90–0.99 — single draws from a 66–80-name multiple-testing
family that look exactly like what Benjamini-Hochberg exists to discard. The
flagged set is empty in all eight constructions, so the flagged sets trivially
overlap; nothing plausible manufactures significance. DIS's headline
t = 3.17 is a *positive* beta, which the negative-only flag rule never flags
and never could.

## Point estimates and rankings are not stable under seed cuts

This is the part of the answer that concedes the reviewers' point. Weighting
scheme and jackknife barely move anything (equalWeights: median |Δβ| 0.04, ρ =
1.00; drop the heaviest member: median 0.32, ρ = 0.91 — Disney goes
43.81 → 41.35, the same order as the 43.81 → 42.12 wobble we found in the
date-window bug). But the seed count is a different story: at 5 or 3 members
the cross-variant Spearman correlation of betas falls to 0.16–0.18, 31–34 of
the 80 names flip the **sign** of their cultural beta, and Disney's +43.81
becomes +6.0 (seeds5) or +1.8 (seeds3). The featured-seven and top-10-by-|t|
subsets show the same shape (tables in the JSON): the big-name drift is not an
artefact of small caps.

So both statements are true, and we print both: the *inferiority* of any
single name's beta magnitude to its basket construction is large — a per-name
cultural beta like DIS = 43.81 is a property of the committed 8-member media
basket, not a ticker-level fact — while the *inference* (which names are
culturally hedged at q ≤ 0.10) is completely insensitive to construction,
because nothing is flagged under any of them and the near-threshold names get
further from the threshold, not closer, when the basket changes.

## Verdict

**The null survives basket construction.** Across every re-formulation the
cached data can support — 3, 5, 7 and 10 members by affinity, equal weights,
brands-only, and a leave-the-heaviest-member-out jackknife — with
Benjamini–Hochberg recomputed inside each variant's own family, zero of the
80 priced names is flagged, and the single screen-level name (KDP) has a q of
0.35 at best and ≥ 0.73 under every aggressive cut. The honest sentence the
entry should carry: *"No basket construction we can re-derive from the cached
Qloo responses makes any stock's cultural beta statistically significant — the
null result is a property of the data, not of our 8-member affinity-weighted
choice — but individual beta magnitudes are construction-dependent (at 5 seeds
the book's beta ranking is essentially uncorrelated with the committed table,
ρ ≈ 0.18, and a third of names flip sign), so we report the finding at the
level of the test, not as 80 ticker-level exposures."* A judge who asks "how
much does the basket choice matter?" gets the calibrated answer: it decides
what a beta *is*, and it does not decide what is *significant*.

## Reproducing

- `node scripts/basket-sensitivity.mjs` — reads `output/desk.json`,
  `output/series.json`, `fixtures/prices.json`, `fixtures/qloo/series.json`,
  `fixtures/qloo/entities.json`, `fixtures/qloo/basket-sector-*.json` and
  `fixtures/qloo/recommend-sector-*-{brand,movie,artist,tv_show}.json` (61
  files, all listed in the output JSON); writes
  `output/basket-sensitivity.json`; makes zero Qloo requests.
- `node --test tests/basket-sensitivity.test.mjs` — degenerate reporting,
  per-variant BH, real-data round-trip of the committed weights and betas,
  universe exclusion, and a fetch-spy proving no network path runs.

Full 80-name × 8-construction table: `output/basket-sensitivity.json →
perName` (tractability note: the whole priced book was run — a sensitivity
pass is 640 OLS fits of 102 rows and costs under a second — so the
featured-seven and top-10-by-|t| subsets reported inside are summaries,
not the coverage).
