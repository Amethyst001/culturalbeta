# Independent review brief, round 3 — Cultural Beta consumer equity desk (Qloo Agentic Hackathon)

Exercise abstract thinking. You are being asked to actually review this submission, not to summarise it,
not to encourage the team, and not to repeat their own framing back to them. Find the errors, name the weak
points, and say whether the claims follow from the evidence. Judge it the way a Qloo judge would — the Qloo
CTO is on the panel — and also the way a statistician who has to defend these numbers in a seminar would.

This is round 3. Round 2 raised five things and four were changed in code, not in prose. One of the
requested tests came back as a **kill of the team's own fallback story**, and it is printed anyway. Your
job is to decide whether the fixes are real, whether anything was broken in the process, and what the
single strongest remaining objection is.

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
- The pre-registered `velocity_fold_change` signal turned out to be identical to `population_percent_delta`
  and 0 on 71 of 106 weeks for every entity at once — a refresh cadence, not stillness. It was amended
  **before any result was read** to the weekly log change in `population_percentile`. Recorded in
  `config/book.json`.
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
- Date-permutation null (400 shared shuffles of week order): real +0.67 vs shuffled +0.89, **p 0.778**.
  **A positive claim now requires both nulls at p ≤ 0.10 (intersection-union). The better of the two
  p-values is no longer used.**
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

**Pooled panel, per-name market loadings (new).** Same panel with each name's own market beta partialled
out first — algebraically a name × market interaction with name fixed effects. Loadings span **−0.29 to
2.40 (sd 0.55)**. Within-ΔR² **+0.04 pts**, permutation **p 0.923**; no sub-sector slope reaches
|t| ≥ 2 (largest is apparel +1.37, t 1.27). So removing the restriction changes nothing but the sub-sector
slopes, which is itself a statement about the estimand.

**Dispersion test (new — the round-2 request, and it came back a kill).** Cross-sectional variance of the
80 per-name cultural betas against the average squared standard error, calibrated by a null that rotates
**each name's basket independently** (keeps its shape, removes its timing). Spread **805**; explained by
noise alone **1,869**; independent-rotation null mean **1,352** (p95 4,030, p05 94). Upper tail
(excess dispersion) **p 0.212**; lower tail (spread below noise) **p 0.791**. The team's reading: the
spread is no larger than noise, and if anything smaller, so genuine heterogeneity between names is not
detectable and the per-name column is a reading with its error rather than evidence that sub-sectors
respond differently.

**The grade.** `HOLDS` requires positive OOS ΔR², a refit interval clear of zero, and both nulls at
p ≤ 0.10. The interval straddles zero and both nulls match, so the grade is **NO SIGNAL** — the factor was
looked for and not detectable at this window length — explicitly not `FAILS` (measured negative, interval
clear) and no longer called `UNPOWERED`.

## What round 2 asked for, and what was done

1. **"The better of two nulls" was post-hoc null selection.** Replaced by intersection-union: both nulls
   must clear p ≤ 0.10 for a positive claim. The rule is stated at the number, in the band sub-line, on the
   read page and in the README. On this book nothing changes (0.898 / 0.778) — which is why the stricter
   rule could be adopted.
2. **UNPOWERED understated a null.** Renamed **NO SIGNAL**, and the grade now uses the refit interval
   rather than the wider one, because the fixed-coefficient interval understates its own error by design.
3. **The pooled panel answered a different question, and forced one market slope.** Scoped in words (it
   cannot confirm or refute a per-name claim) *and* in code (`panelNameMarket`, results above).
4. **Add a dispersion test.** Built, run, reported — and it killed the cross-sectional fallback rather
   than supporting it.
5. **Copy that outran the evidence.** "does not report" → "does not *measurably* report in this sample";
   "the wider interval carries the claim" → "bounds the effect sizes this window can exclude, which here
   is little".

Rejected, with reasons given in the submission: a 52-of-102 active-week floor (the maximum any name
achieves is 31, so it deletes the book); deleting the 18 unresolved and 3 unpriced names (rows are withheld
with reasons rather than removed); reinstating revision weeks as level-shift dummies (the uncut re-run
already answers it: OOS −0.10, placebo p 1.00); extending the window to 2022-07 (the window is
pre-registered; moving it after seeing results is the error pre-registration exists to prevent).

## What we want from you

1. **Is the dispersion test right, and is its reading right?** Independent rotation per name, variance
   against mean squared SE, both tails reported. Given spread 805 vs noise 1,869 and null mean 1,352, is
   "no detectable heterogeneity" the correct conclusion, or is a downward-biased variance estimate under
   shrinkage/estimation error producing a false kill? If the test is wrong, say exactly how.
2. **Does the kill change the product?** If names are not heterogeneous, the per-name cultural beta column
   is a reading with error rather than a cross-sectional signal. Is that a better or worse submission than
   one that showed dispersion, and does the desk still have a reason to exist per name?
3. **The verdict rule.** Intersection-union, refit-interval grading, NO SIGNAL. Is this now correct, or
   has the team overcorrected into a rule that would also suppress a real effect?
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
  "dispersion_verdict": "<is the dispersion test constructed correctly, and is 'no detectable heterogeneity' the right reading — yes/no plus one sentence>",
  "best_next_model_construction": "<the single best alternative construction you would run next, or 'keep the current one'>",
  "headline_rewrite": "<the one sentence you would put above the fold for judges>",
  "judge_60s": "<what a Qloo judge skimming for 60 seconds is most likely to misread>"
}
