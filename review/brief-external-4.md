# Independent review brief, round 4 — Cultural Beta consumer equity desk (Qloo Agentic Hackathon)

Exercise abstract thinking. You are being asked to actually review this submission, not to summarise it,
not to encourage the team, and not to repeat their own framing back to them. Find the errors, name the weak
points, and say whether the claims follow from the evidence. Judge it the way a Qloo judge would — the Qloo
CTO is on the panel — and also the way a statistician who has to defend these numbers in a seminar would.

This is round 4. Round 3 said the dispersion test had no power figure and that the team was calling a
non-detection a kill; the team agreed, rebuilt the test's calibration, and the test now reports itself as
**uninformative**. Round 3 also asked which of three disagreeing variance figures was miscalibrated, and
what a permutation null that respects the weekly refresh cadence would say. Both were answered with
computations. Your job is to decide whether those answers are right, whether anything else is broken, and
what the single strongest remaining objection is. A submission deadline follows within a day, so say what
matters.

## What the submission is

A consumer equity desk: for each of 80 priced US consumer names in 11 sub-sectors it reports a market beta
(weekly return on SPY) beside a **cultural beta** — the coefficient on a weekly "taste basket" return built
from Qloo's `/v2/trending` endpoint. The pitch: taste is a candidate risk channel that an index beta does
not *measurably* report in this sample. The desk is a product surface (desk, taste map, evidence, per-name
holding page, plain-English read page, JSON/CSV API) built around a pre-registered falsification attempt.

Hard constraints the team set itself: no simulated Qloo data anywhere; if the result would be the same
without Qloo it is the wrong thing; no portfolio builder, optimiser, backtest or trading claim; every
number traceable to a cached Qloo response; the API key is server-side only.

## The data, as measured (paid run)

- 101 names → 83 resolve to a Qloo entity → **80 priced**. 18 unresolved keep their rows and lose their
  beta; 3 resolved names have no usable price series (WBD, EA, K), so they are neither.
- One taste basket per sub-sector: affinity-weighted blend of non-holding entities Qloo recommends from up
  to 10 of that sub-sector's resolved entities across brand/movie/artist/tv_show; every name in the
  universe excluded by construction. 72 basket calls, not one per name.
- `/v2/trending` levels reach 2022-07 for the deepest entities; deterministic on re-request; piecewise
  constant; the newest ~8 weeks are frozen for every entity.
- All four weekly fields in that response move at the same slow cadence. Median weeks in which each field
  changes, across the 80 series (~198 weeks each): `population_percentile` 50, `velocity_fold_change` 47,
  `population_percent_delta` 47, `population_rank_velocity` 39. Swapping fields buys no weekly variation.
- The pre-registered `velocity_fold_change` signal turned out identical to `population_percent_delta`; it
  was amended **before any result was read** to the weekly log change in `population_percentile`. Recorded
  in `config/book.json`.
- Four catalogue-revision weeks (2025-04-07/14, 10-13/20) are cut from both windows: every entity's
  percentile steps at once (book-wide median log move 0.188–0.262 vs 0.0007 on a normal week). The cut is
  itself re-run as a sensitivity.
- Estimation window: **102 weekly returns, 2024-10-14 → 2026-10-26**, fixed before estimation. The
  pre-registered second window (106 weeks immediately before) cannot be priced — Qloo's levels cover 58 of
  its 106 weeks — and the desk reports it as **untestable**, not as a failed replication.

## Results, from the current run

Per-name estimator (the pre-registered one): weekly return ~ SPY + own sub-sector's taste basket.

- Mean in-sample ΔR² from taste over market alone: **+0.67 pts**. Median |t| on the cultural beta: 0.60.
- Flags (negative beta, |t| ≥ 2, Benjamini–Hochberg q ≤ 0.10 across 80 names): **0**.
- Out of sample (fit on first 67 weeks, scored on last 35): mean ΔR² **−0.05 pts**, 90% CI **[−0.56,
  +0.28]** with fixed coefficients, **[−2.12, +0.64]** with a refit inside each draw. The grade is read off
  the refit interval; the page says the wider interval *bounds what the window can exclude*, which here is
  only effects larger than ~2.1 pts, and does not say it "carries the claim".
- Rotation null (400 circular shifts, all names shifted together): real +0.67 pts vs rotation mean +0.96
  pts, **p 0.898**.
- Date-permutation null, week by week (400 shared shuffles of week order): real +0.67 vs shuffled +0.89,
  **p 0.778**.
- **Date-permutation null, 6-week blocks (new).** Same 400 draws, but whole blocks of consecutive weeks are
  shuffled as units so each basket keeps its local serial structure — the objection being that a
  week-by-week shuffle dissolves the refresh cadence. Real +0.67 vs blocked-shuffle +0.94, **p 0.830**.
  **A positive claim requires every null at p ≤ 0.10 (intersection-union), and where a null exists in two
  versions the stricter one is used.** The friendliest p of the set is never used alone.
- Ablation against a same-sector peer basket (no Qloo data at all): taste over peers out of sample
  **−0.78 pts**, 90% CI [−2.00, +0.41], positive on **57%** of names. Its own rotation null reads
  **p 0.126** with 206 of 400 draws valid (194 dropped by the identification rule); a looser rule gives
  0.099, a stricter one 0.147. Labelled **uninformative, not borderline**.
- Consumer-sentiment exclusion (UMCSENT, monthly, carried as month-over-month change): taste over SPY and
  sentiment **−0.10 pts**, 90% CI [−0.70, +0.18].
- Identification is thin and said so: the basket moves in **19–31 of 102 weeks** per name (median 29), and
  every priced row prints its own active-week count next to its ±.

**Pooled panel, common market slope.** Name fixed effects swept out, one common market slope, one cultural
slope per sub-sector, week-clustered SEs, ridge variant. Within-ΔR² **+0.04 pts**, permutation
**p 0.928**; market slope 0.75 (t 10.5). Two of 11 sub-sector slopes reach |t| ≥ 2 (restaurants −1.39,
t −2.12; apparel +2.48, t 2.08) and neither survives Bonferroni 0.0045.

**Pooled panel, per-name market loadings.** Same panel with each name's own market beta partialled out
first — algebraically a name × market interaction with name fixed effects. Loadings span **−0.29 to 2.40
(sd 0.55)**. Within-ΔR² **+0.04 pts**, permutation **p 0.923**; no sub-sector slope reaches |t| ≥ 2
(largest is apparel +1.37, t 1.27).

**Dispersion test — now calibrated, and it reports itself as uninformative.** Cross-sectional variance of
the 80 per-name cultural betas against the average squared standard error, calibrated by a null that
rotates **each name's basket independently** (keeps its shape, removes its timing).

| | value |
|---|---|
| Spread across 80 names | 805 (sd 28) |
| Explained by noise alone (mean se²) | 1,869 (sd 43) |
| Independent-rotation null | mean 1,352 · p95 4,030 · p05 94 · 400 draws |
| Upper tail (excess dispersion) | p 0.212 |
| Lower tail (spread below noise) | p 0.791 |
| **Power at a planted sd of 1 / 5 / 10 / 25 / 50** | **0% / 0% / 0% / 0% / 100%** |
| **Power at the spread actually observed (sd 28.4)** | **0%** |

The power figure is computed by shifting each name's outcome so its fitted cultural beta becomes an exact
draw from a known spread (adding c × basket to y moves that coefficient by exactly c), then scoring each
simulated book against the same 90% null threshold. A test that would miss a genuine heterogeneity as
large as the one it measured, even if that heterogeneity were entirely real, has not tested anything — so
`informative = power at the observed spread ≥ 80%` is false here, and the reading is **uninformative**,
not a kill and not a confirmation.

**Which of the three variance figures is wrong.** Computed inside the rotation null itself, where no name
is related to its basket by construction: mean se² **1,810** against a cross-sectional variance of
**1,352** — a **25% overshoot**, against 28% on the real book. So the analytic benchmark is the
miscalibrated one: it treats 80 slopes as 80 independent estimates, while every name is measured over one
shared calendar, and the cross-sectional variance sits below the sum of marginal variances by the average
cross-name covariance. Every p is read against the rotation null; the analytic number is printed only as
that cross-check.

**The grade.** `HOLDS` requires positive OOS ΔR², a refit interval clear of zero, and every null at
p ≤ 0.10. The interval straddles zero and every null matches, so the grade is **NO SIGNAL** — the factor
was looked for and not detectable at this window length — explicitly not `FAILS` (measured negative,
interval clear) and not called `UNPOWERED`.

## What round 3 asked for, and what was done

1. **"Print a power statement next to the dispersion result."** Done at every planted spread and at the
   observed spread; the reading is keyed on that power, so it is `uninformative` rather than
   `indeterminate`. The evidence band prints both the table and the observed-spread figure.
2. **"Reconcile the three inconsistent variance figures and identify which benchmark is miscalibrated."**
   Done from inside the null, above. The analytic figure is the wrong yardstick for this statistic and the
   page says why.
3. **"A block permutation respecting the cadence would confirm the p-values."** Done: p 0.830 in 6-week
   blocks against 0.778 week by week, and the stricter figure is the one the claim must clear.
4. **"Rebuild the taste basket from a Qloo series with genuine weekly variation."** Checked against the
   cached pull: all four weekly fields in `/v2/trending` move at the same cadence (median 39–50 of ~198
   weeks), so no field swap buys weekly variation, and the basket is pre-registered. Recorded as a
   limitation of the endpoint and of the pre-registration rather than repaired after seeing the answer.
5. **Copy that outran the evidence.** "no larger than noise, and if anything smaller" removed from the
   uninformative branch; a p-value that rendered in the negative colour now renders neutral; a 14px link
   below the 44px tap target replaced.

Rejected earlier, with reasons in the submission: a 52-of-102 active-week floor (the maximum any name
achieves is 31, so it deletes the book); deleting the 18 unresolved and 3 unpriced names (rows are withheld
with reasons rather than removed); reinstating revision weeks as level-shift dummies (the uncut re-run
already answers it: OOS −0.10, placebo p 1.00); extending the window to 2022-07 (the window is
pre-registered; moving it after seeing results is the error pre-registration exists to prevent).

## What we want from you

1. **Is the observed-spread power figure the right criterion?** `informative = power at the observed sd ≥
   80%` decides the reading. Is that the right test of whether a non-detection means anything, or does it
   beg the question by anchoring on the quantity being tested? If you would use a different criterion, say
   which and what it would say here.
2. **Is the benchmark reconciliation sound?** "Inside the null the analytic overshoots by 25%, therefore the
   analytic benchmark is the miscalibrated one" — does that inference hold, or can a mismatch inside the
   null be produced by something other than the independence assumption?
3. **The verdict rule.** Intersection-union across three nulls, refit-interval grading, NO SIGNAL. Is this
   now correct, or has the team overcorrected into a rule that would also suppress a real effect? Is
   NO SIGNAL distinguishable from FAILS at this power, and should the desk say it is not?
4. **Hackathon judgement.** Score /100 on each rubric axis: Technological Implementation, Design,
   Potential Impact, Quality of Idea. Name the weakest axis and the one change that would move it most.
   A Qloo judge must be able to see, in the product, that the Qloo data is load-bearing — say whether that
   is visible here.
5. **Fatal objections.** If something would make a judge reject the entry outright, say it first and
   precisely. If not, say so rather than inventing one.
6. **Overstatement.** Read for it again. Name any remaining phrase — in the desk copy, the README or this
   brief — that outruns the evidence, with the correction.

Return **one JSON object and nothing else** (no markdown fence, no prose outside it):

{
  "verdict": "PASS" | "FIX FIRST" | "FAIL",
  "score_total": <0-100>,
  "scores": { "technological_implementation": <0-25>, "design": <0-25>, "potential_impact": <0-25>, "quality_of_idea": <0-25> },
  "fatal": "<the defect that would reject the entry outright, or 'none'>",
  "must_fix": ["<at most 4, ordered, each a concrete change>"],
  "method_objections": ["<at most 4, each naming the specific statistical claim and why it fails or holds>"],
  "overstatements": ["<at most 3 exact phrases from this brief that outrun the evidence, with the correction>"],
  "dispersion_verdict": "<is the dispersion test and its 'uninformative' reading right — yes/no plus one sentence>",
  "power_criterion_verdict": "<is observed-spread power the right criterion — yes/no plus one sentence>",
  "best_next_model_construction": "<the single best alternative construction you would run next, or 'keep the current one'>",
  "headline_rewrite": "<the one sentence you would put above the fold for judges>",
  "judge_60s": "<what a Qloo judge skimming for 60 seconds is most likely to misread>"
}
