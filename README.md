# Cultural Beta — a consumer equity desk

Market beta says how a stock moves with the index. **Cultural beta says how much of
that movement is exposure to taste.** This desk reports both, side by side, for a
fixed book of **101 US consumer names across 11 sub-sectors**, over a **102-week
aligned return window** (106 weekly closes, less four weeks in which Qloo revised its
catalogue wholesale — see *Catalogue revisions* below).

Built for the Qloo Agentic Hackathon. Qloo is load-bearing: **no number appears
without a Qloo response behind it.** No number on the desk is simulated — nothing
is invented to stand in for a Qloo response, and there is no fallback path that
fabricates one. The null-route test (`tests/nullroute.test.mjs`) enforces it.
The only synthetic fixtures in the tree are `.stub/` (entity ids like
`urn:entity:brand:stub-disney`) and `tests/stubs/`: they exist so the layout audit
and the estimator tests run on a clean clone with no key and no network, and the
server never serves them. Real Qloo responses are never committed.

## Factor construction (which method was used, and why)

We used the **time-series construction**, enabled by Qloo's
`GET /v2/trending` endpoint, which returns **weekly** popularity-trend statistics
per entity (`population_percentile`, `population_rank`, `population_rank_velocity`,
`velocity_fold_change`, `population_percent_delta`) over a requested date range:

1. Each name is resolved to a Qloo brand entity via `GET /search`
   (`types=urn:entity:brand`); unresolved names are refused, never guessed.
2. **One taste basket per sub-sector, not per name.** For each sub-sector, a
   `qloo exec recommend` call per creative type (brand, movie, artist, tv_show) is
   signalled by up to ten of that sub-sector's resolved entities. The result is the
   cultural neighbourhood of a sub-sector's audience, so every name in the sector is
   priced against the same factor and the **call count grows with sectors, not with
   names**. Every name in the universe is removed from every result by id and by
   normalised name — a consumer sector cannot explain itself with consumer stocks.
3. Member weights are Qloo's own affinity ranks, normalised to sum to 1. A member
   without an affinity is dropped rather than given an invented weight.
4. Weekly taste return per basket member: `population_percentile` is averaged to one
   level per ISO week, and the return is `ln(level_t / level_{t-1})`, with a missing
   adjacent week producing no observation; the basket return is the affinity-weighted
   mean across members within the week. The pre-registered field was
   `velocity_fold_change`; it was amended before any result was read, because on 140
   cached pages it is 0 on 71 of the 106 primary-window weeks, the zero weeks are the
   same dates for every entity (Qloo's refresh cadence, not entity stillness), and it
   equals `population_percent_delta` on every point. The amendment is recorded in
   `config/book.json → tasteSignal.note`.
5. Per name, OLS on the aligned weekly returns (102 after the revision cut):
   `return_t = a + b_market · SPY_t + b_cultural · basket_t + e_t`.
   `b_cultural` is the cultural beta, reported with its standard error. The basket is
   flat in most weeks, so the slope is identified only on the weeks it moves — 19 to
   31 of 102 per name, median 29, printed on the desk under the table.

Featured names additionally carry an **audience-level basket** built from their own
entity (`qloo-basket.mjs`) — a second, name-specific reading shown on the holding page
next to the sector reading. It never replaces the sector factor.

The snapshot method (documented in the plan) remains the declared fallback only if a
name lacks ≥100 weekly trend points — such rows are marked **"insufficient signal"**
and their betas are not printed.

### Catalogue revisions

Qloo revises its catalogue wholesale on a few dates: every entity's percentile steps
at once. Measured on the 140 cached trend pages, the book-wide median weekly log move
on those dates is **0.188–0.262**, against **0.0007** on a normal week. A weekly taste
return taken across such a step is an index rescaling, not cultural movement, so
`revisionWeeks()` in `src/factor.mjs` detects those dates from the book's own level
series and cuts them from both windows rather than dummied out — four weeks in the
primary window (2025-04-07, 2025-04-14, 2025-10-13, 2025-10-20), none in the prior
one. The dates and the rule are shipped in `dataQuality` and printed on the desk.

**Where the revisions stop matters more than where they are.** In this pull every
entity's `population_percentile` last moves in the week ending **2025-12-22**. The
price window ends 2026-10-26, so its final **44 weeks** carry a single percentile value
forward: the weekly log change is exactly zero for every entity and every name. The
pre-registered 67/35 split puts all **35** scored weeks inside that tail, which is why
the held-out condition is marked untestable (Robustness, check 1). The dates are
visible in `fixtures/qloo/series.json` without any price data, so the freeze is not a
post-hoc discovery about returns — it is a property of the vendor's refresh history,
and the desk prints it as `valueAdd.oos.scoring`.

### The flag rule, corrected for multiplicity

A hundred names means a hundred `|t|` tests on one factor. At `|t| ≥ 2` about five
would clear the screen by chance alone. So a name is **flagged** only when all three
hold:

- cultural beta is negative,
- `|t| ≥ 2`,
- Benjamini–Hochberg `q ≤ 0.10` across every priced name.

`src/multiplicity.mjs` implements BH; `tests/multiplicity.test.mjs` pins it;
`config/book.json → flagRule` is the declared rule.

## Robustness

Ten checks answer the question a sceptical reader asks before believing a factor:

1. **Out of sample — and, at this data vintage, an empty slice.** The same nested
   comparison — market-only vs market + taste basket — is re-estimated on the first
   67 weeks and scored on the last 35, and the held-out ΔR² is reported as computed,
   including when it is negative. But Qloo's last `population_percentile` change in
   the pull is the week ending **2025-12-22**, so the final **44** weeks of the
   102-week window are a carry-forward with a weekly log change of exactly zero for
   every entity — and **all 35 scored weeks** fall inside that tail. A regressor that
   is zero multiplies its coefficient by zero on every scored week, so the held-out
   condition could not have detected a taste effect of **any** size: its power against
   a true effect equals its size. The desk therefore labels the cell **"no test"** and
   prints the number as the training fits' perturbation, never as a negative result;
   the two intervals on those weeks describe coefficient wobble, not a bound on taste.
   The pre-registered split is unchanged. A **post-hoc** diagnostic moves the split
   inside the revised part of the window (58 informative weeks, 38/20): median ΔR²
   −0.49 pts, positive on 38% of names, mean −8.4 pts because a few near-zero-variance
   test slices dominate the range (−127.5 to +15.8). It is shipped as the best
   held-out reading the data allows, not as a verdict. `valueAdd.oos.scoring`,
   `valueAdd.oos.cadence`, and the evidence page's "When Qloo's numbers stop moving".
2. **Circular-rotation placebo.** Every basket is rotated against returns by the same
   shift per draw (400 draws, fixed seed), which preserves the series' autocorrelation
   and the cross-name alignment and destroys only its alignment with returns. `p` is
   the share of rotations whose book-mean ΔR² matches or beats the real one. The same
   rotations are scored a second time against the *peer* models (check 6), because
   "aligned with returns" and "adds beyond the sector" are different questions.
3. **A pre-registered disjoint second window.** The same estimator, sample floor,
   400 draws and seed were to be re-run, unchanged, on the 106 weekly returns
   *immediately before* the primary window (2022-10-03 → 2024-10-14). The slice and
   the replicate rule (OOS ΔR² > 0 and placebo p ≤ 0.10) were fixed in
   `config/book.json` before any keyed run, so the window is not chosen after seeing
   results. **On this data it could not be priced:** Qloo's level history covers 58 of
   the window's 106 weeks, so no name clears the 100-week floor. The desk reports the
   window as **untestable** — neither a pass nor a failure to replicate — and why.
   Names without price history in the prior window are excluded from the replication
   cohort, never the whole book; that count is printed and shipped in the payload.
4. **An ablation against the sector itself.** The control is a peer basket — the
   equal-weight weekly return of the other names in the sub-sector, from the same
   committed prices, with no Qloo data. The peer-only and peer + taste models are
   fitted on the first 67 weeks and scored on the last 35; the reported number is the
   signed out-of-sample gain of taste **over the peer control**, plus the share of
   names where it is positive. In-sample nested ΔR² cannot fall when a regressor is
   added, so only the out-of-sample arm is allowed to make the claim — and at this
   Qloo vintage that arm sits on the same **frozen tail** as check 1, so its cell is
   labelled a perturbation of the training fits rather than a taste test. The two
   regressors are **not** near-copies: the correlation between a name's taste basket
   and its no-Qloo peer basket averages **0.04** across the book (range −0.11 to
   +0.25), and the taste basket moves in a mean 27 of 102 weeks while the peer basket
   moves every week — so a null ablation would mean Qloo's distinct information did
   not add, not that Qloo reproduced the sector average (`valueAdd.ablation.qlooVsPeer`).
   The control is
   deliberately narrow — peers carry the same taste exposure, so the peer basket
   absorbs the part of taste the sector already prices, and what remains is the
   non-overlapping layer: what Qloo contributes that a vendor-free peer basket
   cannot. That is the estimand, not a bound on any causal total. If this arm adds
   nothing, the desk says so — that is the test that decides whether Qloo is
   actually load-bearing. The arm carries its **own rotation null**: the same 400
   circular shifts are scored against the peer models, not only against SPY, so
   "the basket is aligned with returns" and "the basket adds beyond the sector" are
   two separately printed answers rather than one standing in for the other
   (`ablation.oos.placebo.p`, and `ablationPlaceboP` per name). Rotations that leave
   a name's training window with fewer than 8 nonzero weeks or under 5% of the
   basket's own spread cannot identify the taste coefficient; those name-draws are
   skipped, and a draw keeping fewer than 80% of names is dropped and counted
   (`validDraws`, `skippedDraws` in the payload; 206 of 400 valid on this book). On
   this data the peer null is **uninformative**, not borderline: p 0.126 under that
   rule, 0.099 under a looser one and 0.147 under a stricter one — the value moves
   across the 0.10 line when the identification rule changes, so it is reported as
   a p that cannot carry a verdict in either direction. It runs on the pre-registered
   second window as well as the primary one
   (`valueAdd.secondary.ablation`), so a control that holds on one window and not
   the other is visible rather than summarised away; the peer control costs no Qloo
   calls, while the taste arm costs up to 11 sub-sectors × 4 creative types ×
   1 basket call plus twelve trend pages per basket member.
5. **Two intervals on every out-of-sample number, at the book *and* the name.** Each
   OOS ΔR² — primary window, second window, the ablation gain and every holding row —
   carries a 90% interval from a 400-draw circular block bootstrap of the test weeks
   (8 weeks per block, so autocorrelation survives the resample; the model's
   coefficients stay fixed and only the scored weeks move). A second 200-draw
   interval redraws the same split *and* refits the model inside each draw, so
   coefficient error is in it. The page names which of the two the grade uses —
   the wider one — under each number, the API says it machine-readably
   (`oosClaimInterval`: `"fixed coefficients"` or `"refit per draw"`), and the CSV
   ships all four bounds (`oosDeltaR2FixedLo/Hi`, `oosDeltaR2RefitLo/Hi`). The
   wider interval is not said to "carry the claim": it **bounds the effect sizes the
   window can exclude**, and where it crosses zero that bound is large, which is
   little. An interval that crosses zero is labelled "crosses zero", because a point
   estimate with no spread invites exactly the question a judge should ask.
6. **The ablation's own rotation null.** The 400 circular shifts are scored against
   the peer models as well as against SPY, so the arm reports two p-values: whether
   the taste series is aligned with returns at all, and whether the aligned basket
   still adds once the sector's peers are in the model. A basket can be aligned and
   not additive; the desk prints both answers rather than letting one stand for the
   other (`ablation.oos.placebo.p`, `ablationPlaceboP` per name).

7. **A second, differently-shaped null — in two versions.** Circular rotation keeps a basket's shape and shifts it; a **date permutation** shuffles the week order (one shared shuffle per draw), keeping each basket's own spread and destroying only its timing. A week-by-week shuffle also dissolves the refresh cadence — a level series that stepped once and held for weeks becomes isolated spikes, a book the data could not have produced — so the same 400 draws are re-run shuffling **blocks of 6 consecutive weeks**, which preserves local serial structure and changes only the order of the blocks. Both permutation figures are printed next to the rotation p (`valueAdd.permutation.p`, `.pBlocked`), and a positive claim has to clear
**all** of them. That is a **max-of-p rule**, not an intersection–union test: the same
hypothesis is tested three ways, and the grade reads the largest p. It is conservative
by construction — the nulls are correlated, so clearing all of them is a stricter bar
than clearing any one — and the desk says so rather than presenting it as neutral. On
this book: rotation p 0.898, permutation p 0.778, block permutation p 0.830, real book
ΔR² +0.67 pts against a shuffled mean of +0.89. The block p **agrees with** the
week-by-week p; it does not confirm it. The cadence claim is checked at week level
rather than by medians: the change indicator for `population_percentile` vs
`velocity_fold_change` co-moves on 90.0% of weeks, percentile vs
`population_percent_delta` on 90.0%, and the two velocity fields on 100% — which is
why the basket uses one field and the other three are not a denser signal.

8. **A pooled panel reading, and the revision cut re-run.** The per-name fit spends 102 weeks on a basket that moves in about 29 of them. `src/panel.mjs` estimates the same variation pooled — name fixed effects swept out by within-transformation, one common market slope, one cultural slope per sub-sector, standard errors clustered by week — with a ridge variant that shrinks the baskets that barely move. It carries its own date-permutation null. **It answers a different estimand**: one slope per sub-sector is a statement about the sub-sector, and it cannot confirm or refute a claim about an individual name — a flat sector slope is compatible with names inside it moving in opposite directions. What it does test is the restriction the per-name table leaves open. On this book the pooled within-ΔR² is +0.04 pts (permutation p 0.928): the pooled reading agrees with the per-name null. A second arm removes the one restriction a reviewer objected to — the common market slope — by partialling out each name's own market beta first (algebraically a name × market interaction with name fixed effects, `panelNameMarket` in the same module). The loadings span −0.29 to 2.40, so the restriction was real, and the answer does not move: +0.04 pts, permutation p 0.923, no sub-sector slope reaching |t| ≥ 2 (`valueAdd.pooledNameMarket`). The four catalogue-revision weeks are cut from the headline calendar; re-running the identical estimator with the cut dropped (106 weeks) gives out-of-sample ΔR² −0.10 pts and placebo p 1.00 against −0.05 and p 0.90 on the cut calendar (`dataQuality.revisionSensitivity`) — the cut is not what produces the result. Both were added **after** the first external review and are labelled post-hoc wherever they appear.

9. **A dispersion test — are the names actually different?** A mean near zero hides two opposite readings: every name has the same dull exposure, or names pull opposite ways and the mean cancels. `src/dispersion.mjs` tests the spread directly: the cross-sectional variance of the per-name cultural betas against the average squared standard error (the spread you would see if every name were in truth the same number), calibrated by a null that rotates **each name's basket independently**, so every basket keeps its own shape and loses only its timing. Both tails are printed, because the lower one is the reading that rules the per-name column out. On this book the spread is 805 against 1,869 from noise alone; the independent-rotation null (mean 1,352) gives p 0.21 in the upper tail and 0.79 in the lower — no excess dispersion is detected. The analytic benchmark and the empirical null disagree by 28%, and the gap has **two candidate channels that the null cannot separate**: summing 80 marginal variances treats the slopes as 80 independent estimates, and a shared calendar, common shocks or correlated residuals make the cross-section move together. **Inside the null's own draws**, where no name is related to its basket by construction, the analytic figure still averages 1,810 against a cross-sectional variance of 1,352 — a 25% overshoot, essentially the same gap — so the analytic number is printed only as a cross-check and every p is read against the rotation null.

**And the reading is keyed to a disclosed power curve, because "no detectable dispersion" can be true for two reasons.** Each name's outcome is shifted so its cultural beta becomes a draw from a known spread (adding a multiple of the basket moves that name's fitted coefficient by exactly that multiple), and the same 90% threshold is applied. Detection rates at planted cross-sectional sds of 1 / 5 / 10 / 25 / 50: **0% / 0% / 0% / 0% / 100%**, against a pre-specified 80% bar. The smallest spread this test can see is about **50** — a taste exposure that would move a stock 50% per 1% basket move, roughly 1.8× the spread actually observed and far outside anything plausible. Read at the spread the book does show (sd 28.4) the same curve gives **0%**: this test would find a genuine heterogeneity that size none of the time, which is the whole basis for calling the non-detection empty. The test is therefore reported as **uninformative**, in the same bracket as the peer rotation null: it neither confirms nor refutes heterogeneity between names (`valueAdd.dispersion`, `powerObserved`).

10. **The verdict rule.** The primary grade is read off the **refit** interval — the one that includes coefficient error — and a HOLDS requires a positive OOS ΔR², an interval clear of zero, and **every** null cleared — rotation, week-by-week permutation and 6-week-block permutation, under the max-of-p rule above. When the interval straddles zero and every null matches the real alignment, the grade is **NO SIGNAL**. That is a distinct grade from FAILS (measured negative, interval clear of zero), and deliberately not called "unpowered": it is a null result on a readable signal, not a demonstration of absence. **At this data vintage the rule has a third state, and it is the one that runs.** When `valueAdd.oos.scoring.testable` is false the held-out condition cannot run at any effect size, so the grade is read **in sample only** and the word says so: **NO SIGNAL (IN-SAMPLE)**, or **IN-SAMPLE ONLY** if the in-sample association ever separates from chance. The grade chip carries "held-out slice frozen", the OOS cell reads **"no test"** rather than printing a number, and the perturbation value appears only in the cell tag and the rule box. Printing "NO SIGNAL" there was the fifth external panel's most serious finding, and it was right: the word implied a capable test that had found nothing. That state is about the data, not the factor, and the desk says which.

The distance between the two labels is stated on the read page, as a reviewer asked: **NO SIGNAL** means nothing in sample separates from chance and no null separates; **FAILS** means a negative effect was measured with an interval clear of zero. A window that could not have seen the effect is called neither; its grade is read **in sample** and named as such, and the reason is printed. The three nulls are run on one shared calendar, so they are described as one stringent check rather than three independent tests, and the read page states that rotation and shuffling preserve each basket's slow shape and so exclude less about a genuinely weekly signal than the p-value alone reads.

All are deterministic (no model in the loop) and covered by
`tests/robustness.test.mjs`, `tests/second-window.test.mjs`,
`tests/ablation.test.mjs`, `tests/panel.test.mjs` and `tests/dispersion.test.mjs`
(a planted taste factor is found over peers and by the pooled fit; a world with only
market and peers yields no taste gain; the ablation placebo finds planted taste over
rotation and stays calibrated under the null; ridge leaves a well-identified slope
alone and shrinks a barely-moving basket; planted opposite exposures show excess
dispersion and identical names do not). `src/robustness.mjs`, `src/ablation.mjs`,
`src/panel.mjs` and `src/dispersion.mjs` hold the code; `scripts/compute-betas.mjs`
writes the results to `valueAdd.oos`, `valueAdd.placebo`, `valueAdd.permutation`,
`valueAdd.pooled`, `valueAdd.dispersion`, `valueAdd.secondary` and
`valueAdd.ablation`, with per-name `oos`, `placeboP`, `activeWeeks` and `ablation`
on every priced row.

## Products surface

The desk is a product, not a page — the same book served four ways:

- `GET /api/v1/panel` — every priced name with both betas, s.e., q, flags.
- `GET /api/v1/holding/:ticker` — one name: series, basket weights, audience reading,
  both windows, provenance.
- `GET /api/v1/alerts` — names firing the flag rule, plus every suppressed name with
  its reason. A name fires only when the flag rule holds **and** its own
  out-of-sample ΔR² is positive **and** the book placebo beats rotation at p ≤ 0.10.
- `GET /export/panel.csv` — the panel with sector, q, and both windows' betas.

A missing factor is a named 503 refusal, never a zero-filled beta.

### The analyst, and what Qloo does at answer time

`POST /api/ask` is the agentic surface. The model picks its own tools over the
committed panel (`get_holding`, `search_book`, `rank_holdings`, `get_nulls`,
`get_basket`, `desk_summary`, …), and every answer carries two things it cannot
decline:

- **A server-side Qloo attestation.** Before the model is called, the server asks
  Qloo one bounded trend page for each of up to three committed basket entities —
  the names the question cites when it cites any, otherwise one reference name per
  sub-sector — and prints what each returned: newest week, last revision, whether it
  is newer than the panel's frozen tail, Qloo's own correlation id and the cached
  response file name. This runs outside the tool loop, so the model can neither skip
  it nor substitute a claim of its own. If it cannot run, the answer says why.
- **A gate the answer has to pass.** The check is not decorative: if any attested
  entity reports a Qloo revision after the panel's last revision, the answer carries
  a warning above its own text saying the numbers below predate the feed; a check
  that could not run is stamped unattested in the same place, so it can never read
  as a pass. Each reading is stamped `att-<12 hex>`, a hash of exactly the fields
  printed in the receipt, so the line above the answer and the receipt can be shown
  to be the same claim.
- **A receipt** naming the panel file and revision, the attested entities, the gate
  state and stamp, and every tool call with the request that produced it and the
  cached response behind it.

A live tool (`live_brand_trends`, `live_cultural_beta`) may spend one further
bounded request per answer from a persisted daily budget. Nothing in the desk, and
nothing in the answer, is generated from a Qloo response that does not exist.

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

101 names across beauty & personal care (5), apparel & footwear (7), restaurants &
coffee (8), media & entertainment (8), grocery & mass retail (7), home & housing (10),
beverages & tobacco (9), packaged food & household (18), specialty & auto retail (12),
travel & leisure (12), autos & mobility (5). Index proxy: SPY. Window: 106 weekly
closes, less four catalogue-revision weeks → 102 aligned weekly returns; returns
computed only on weeks where every symbol has data. Seven reference names (ELF, NKE,
LULU, CMG, SBUX, MCD, DIS) are marked *featured* in `config/universe.json` and get the
extra audience reading.

On the committed real prices e.l.f. fits a market beta of **2.02 ± 0.41** (t = 4.9)
against SPY — the same high-market-loading structure the reference described. The
reference numbers 1.92 / −0.23 came from a *simulated* factor; they are not forced
onto real data, and `tests/market-only.test.mjs` pins the real price-half value.

Three names (WBD, EA, K) have no complete price history in this window. They keep
their row and are labelled **no prices** — the roster never shrinks to hide a
missing beta. Separately, entity resolution on the live run returned a Qloo brand for
**83 of 101** names; the other 18 keep a row labelled **unresolved**, with the query
that was tried, how many queries were sent, how many candidates came back and the
resolver's own failure class — no listing at all, a company name rather than a brand
string, or candidates with no boundary match. Their cultural column stays withheld.
**80 names are priced.** Fourteen of the 18 were searched under a single query, so for
those the miss is a limit on what was asked, not a finding that the brand is absent
from Qloo.

## What the desk shows

- **Desk** — every name, market beta next to cultural beta, with sector filters, the
  flag rule, the multiplicity-corrected q, and the headline verdict with a
  replication chip.
- **Holding** — one name: price vs taste indexed to 100, sector-basket weights, the
  featured audience basket, both windows, and the residualised scatter whose slope is
  the cultural beta.
- **Taste map** — one dot per sub-sector (mean market beta against mean cultural
  beta, sized by the names it prices).
- **Evidence** — the Qloo request and cached response behind every cultural beta,
  the Yahoo request URL behind every price, and the peer-basket ablation that shows
  what taste adds beyond the sector itself.
- **Read** — a plain-English page: both betas, the tests, and what a flag does and
  does not mean.

With no Qloo key the cultural column is **withheld** — the desk still serves the
real price half from the committed Yahoo fixture and refuses only the taste half.

## Run

```sh
npm install                 # no runtime deps required (Node 22.19+)
# put the hackathon key in .env as QLOO_API_KEY (see .env.example; key never reaches the browser)
npm run fetch-prices        # fixtures/prices.json — 106 primary + 106 prior weekly returns per name
npm run fetch-sentiment     # fixtures/sentiment.json — UMCSENT, the consumer-confidence control
npm run qloo:budget         # what the keyed run costs, computed — it makes no calls
npm run qloo:map            # fixtures/qloo/entities.json — name -> Qloo entity ids
npm run qloo:sector         # fixtures/qloo/basket-sector-*.json — one basket per sub-sector
npm run qloo:basket         # fixtures/qloo/basket-<TICKER>.json — audience baskets for the featured names
npm run qloo:series         # fixtures/qloo/series.json — weekly taste series per basket member.
                            # prints the exact request count and refuses to spend it without QLOO_RUN=1
npm run compute-betas       # refuses to print without Qloo fixtures
npm run serve               # desk at http://localhost:8811
npm test                    # ols, null-route, floor, market-only, robustness, second window, ablation, sentiment, budget, multiplicity, universe
node scripts/audit.mjs --url http://localhost:8811
                            # ~450 UI checks, 5 routes × 3 viewports (1440 / 768 / 390), CDP, no deps
```

Call budget for the full book, computed by `npm run qloo:budget` from the same
paging arithmetic `src/qloo.mjs` spends rather than asserted. The plan ceilings are
120 searches (101 lookups + 19 alternates), 72 basket calls (11 sub-sectors × 4
creative types + 7 featured × 4), and 3,624 trend requests — 151 basket entities ×
12 pages of 20 weekly points from 2022-10-03 to 2026-11-02, and **two requests per
entity-page** because the official harness pays an id re-resolution beside each
`/v2/trending` call. The paid run actually spent **3,065**: 121 searches, 72 basket
calls and 2,872 trend requests, the last figure counted off 358 cached pages of up to
five entities each — the page cache replayed anything already present, so a re-run
pays only for missing pages. The peer-basket control arm
costs 0; a per-name basket at half the window was the ~3,600 alternative. The same
numbers are served at `/api/budget.json` (`planned` next to `spent`) and printed on
the Read page, so a judge does not have to take "cheap" on trust.

Auth: `X-Api-Key` header against `https://hackathon.api.qloo.com` only. Every call
goes through the official `@qloo/qloo-harness` (`src/harness.mjs`).

## Limits

- No portfolio builder, no optimiser, no trading, no order routing.
- Betas are exposures, not predictions; nothing here is a backtest that claims
  returns.
- Affinity scores describe aggregate taste populations, never individuals (Qloo
  safe-use terms).
- No auth, no accounts, no database.

MIT licensed.
