# Independent review brief, round 2 — Cultural Beta consumer equity desk (Qloo Agentic Hackathon)

Exercise abstract thinking. You are being asked to actually review this submission, not to summarise it
and not to be agreeable: find the errors, name the weak points, and say whether the claims follow from
the evidence. Judge it the way a Qloo judge would — the Qloo CTO is on the panel — and also the way a
statistician who has to defend the numbers in a seminar would.

This is round 2. Round 1 reviewers asked for four changes and they have been made; the numbers below are
from the re-run, not from a plan. Your job is to decide whether the fixes are real, whether they broke
anything, and what the single strongest remaining objection is.

## What the submission is

A consumer equity desk reporting, for 80 priced US consumer names in 11 sub-sectors, a market beta
(weekly return on SPY) beside a **cultural beta**: the coefficient on a weekly "taste basket" return built
from Qloo's `/v2/trending` endpoint. The pitch: taste is a risk channel an index beta does not report.

Hard constraints the team set: no simulated Qloo data anywhere; if the result would be the same without
Qloo it is the wrong thing; no portfolio builder, optimiser, backtest or trading claim; every number
traceable to a cached Qloo response; the key is server-side only.

## The data, as measured (paid run)

- 101 names → 83 resolve to a Qloo entity → **80 priced**. 18 unresolved keep their rows and lose their
  beta; 3 priced names lack prices (WBD, EA, K).
- One taste basket per sub-sector: affinity-weighted blend of non-holding entities Qloo recommends from
  up to 10 of that sub-sector's resolved entities across brand/movie/artist/tv_show; every name in the
  universe excluded by construction. 72 basket calls, not one per name.
- `/v2/trending` levels reach 2022-07 for the deepest entities; deterministic on re-request (99.7% of
  5,531 entity-date pairs identical); piecewise-constant; newest ~8 weeks frozen for every entity.
- The pre-registered `velocity_fold_change` signal is identical to `population_percent_delta` and is 0 on
  71 of 106 primary weeks, on the same dates for every entity — a refresh cadence, not stillness. It was
  amended **before any result was read** to the weekly log change in `population_percentile`
  (`ln(level_t / level_{t-1})`, missing adjacent week → no observation). The amendment is recorded in
  `config/book.json`.
- Four catalogue-revision weeks (2025-04-07, 04-14, 10-13, 10-20): every entity's percentile steps at
  once, book-wide median log move 0.188–0.262 versus 0.0007 on a normal week, and all 100 extreme weekly
  moves sit on those dates. They are cut from both windows, and the cut is now itself re-run as a
  sensitivity (below).
- Estimation window ends up **102 weekly returns, 2024-10-14 → 2026-10-26**, fixed before estimation.
  A pre-registered second window (106 weeks immediately before) cannot be priced: Qloo's level history
  covers 58 of its 106 weeks, so no name clears the 100-week floor. The desk reports it as **untestable**
  and says why, rather than as a failure to replicate.

## Results, from the current run

Per-name estimator (the pre-registered one): weekly return ~ SPY + own sub-sector's taste basket.

- Mean in-sample ΔR² from taste over market alone: **+0.67 pts**. Median |t| on the cultural beta: 0.60.
- Flags (negative beta, |t| ≥ 2, Benjamini–Hochberg q ≤ 0.10 across 80 names): **0**.
- Out of sample (fit on first 67 weeks, scored on last 35): mean ΔR² **−0.05 pts**, 90% CI
  **[−0.56, +0.28]** with fixed coefficients, **[−2.12, +0.64]** with a refit inside each draw. The desk
  says the wider interval carries the claim and labels it.
- Rotation null (400 circular shifts, all names shifted together): real +0.67 pts vs rotation mean
  +0.96 pts, **p 0.898**.
- **Date-permutation null** (new; 400 shared shuffles of the week order, keeping each basket's spread):
  real +0.67 pts vs shuffled mean +0.89 pts, **p 0.778**.
- Ablation against a same-sector peer basket (no Qloo data at all): taste over peers out of sample
  **−0.78 pts**, 90% CI [−2.00, +0.41], positive on **57%** of names. Its own rotation null reads
  **p 0.126**, and the identification rule (drop rotations leaving a training window with < 8 nonzero
  weeks or < 5% of the basket's spread) discards 194 of 400 draws; a looser rule gives 0.099 and a
  stricter one 0.147. The desk now labels this null **uninformative, not borderline**.
- Consumer-sentiment exclusion (UMCSENT, monthly, carried as month-over-month change): taste over SPY and
  sentiment **−0.10 pts**, 90% CI [−0.70, +0.18].
- Identification is thin and said so: the basket moves in **19–31 of 102 weeks** per name, median 29,
  and every priced row now prints its own active-week count next to its ±.

## What round 1 asked for, and what was done

1. **Pool the estimator.** New `src/panel.mjs`: name fixed effects swept out by within-transformation,
   one common market slope, one cultural slope per sub-sector, standard errors clustered by week, plus a
   ridge variant with one penalty scale across sub-sectors. It carries its own 400-draw date-permutation
   null. Result: within-book ΔR² **+0.04 pts** over market-only, permutation **p 0.928**; common market
   slope 0.75 (t 10.5). Sub-sector slopes: restaurants −1.39 (t −2.12), apparel +2.48 (t 2.08), travel
   +4.40 (t 0.51, SE 8.63), media −19.16 (SE 26.86), the rest between −7.06 and +0.35. Two slopes reach
   |t| ≥ 2 and **neither survives Bonferroni p ≤ 0.0045 across 11 tests**. Ridge shrinks the
   barely-moving baskets hardest (media −19.16 → −6.28, travel +4.40 → +2.61). The pooled reading is
   labelled post-hoc everywhere it appears: it was chosen after seeing the per-name results.
2. **A date-permutation null.** Implemented at book level (p 0.778) and inside the pooled panel
   (p 0.928). The desk's verdict tag now takes the better of the two book-level nulls.
3. **The ablation null is not usable.** Labelled uninformative in the band, README and review, with the
   sensitivity band stated.
4. **Copy that outran the evidence.** "Alerts feed implying live signals" became a watchlist feed that
   returns `status: armed | watchlist-only | no-book-null` plus a note (it answers `watchlist-only`,
   0 firing, 80 suppressed with reasons). "An exposure an index beta cannot see" became "does not
   report", followed immediately by whether the risk is measurable. The headline grade `FAILS` was
   replaced by **UNPOWERED** when the out-of-sample interval crosses zero and both nulls match the real
   alignment, with a note explaining that this is a limit of the test, not a verdict on the factor.

Also new: the revision cut is re-run with the four weeks kept in — out-of-sample **−0.10 pts**,
placebo **p 1.000** against −0.05 and p 0.898 on the cut calendar — so the cut changes the second
decimal only.

Not done, and the reasons given: the pooled estimator cannot be pre-registered because it was chosen
after the fact (it is labelled post-hoc, and the pre-registered object remains the per-name estimator);
the four revision weeks are not reinstated as dummies because that re-admits three-unit outliers — the
sensitivity run answers the objection instead; the signal amendment cannot be reversed because the
original field is degenerate.

## What we want from you

1. **Are the fixes real?** In particular: is one cultural slope per sub-sector with name fixed effects
   and week-clustered errors the right pooling, or does it assume away the cross-sectional variation the
   claim depends on? Would random slopes, a name × market interaction, or a hierarchical model change the
   verdict? Does adding a pooled estimator that agrees with the null make the submission stronger, or
   does it read as two shots at the same target?
2. **The grade.** Is UNPOWERED the honest label for an out-of-sample interval that crosses zero with both
   nulls matching the real alignment, or is FAILS still the right word? Is there a third reading we are
   missing?
3. **The nulls.** With rotation p 0.898 and permutation p 0.778, is "not separable from chance at this
   window length" the strongest defensible claim? What single additional test would most improve the
   inference within the same data?
4. **Claims.** Read for overstatement again. Is there any sentence remaining — on the desk, in the
   README, in this brief — that outruns the evidence? Name the exact phrase and the correction.
5. **Hackathon judgement.** Score /100 on each rubric axis: Technological Implementation, Design,
   Potential Impact, Quality of Idea. Say which axis is weakest and the one change that would move it
   most.
6. **Fatal objections.** If something would make a judge reject the entry outright, say it first and
   precisely. If not, say so rather than inventing one.

Return **one JSON object and nothing else** (no markdown fence, no prose outside it):

{
  "verdict": "PASS" | "FIX FIRST" | "FAIL",
  "score_total": <0-100>,
  "scores": { "technological_implementation": <0-25>, "design": <0-25>, "potential_impact": <0-25>, "quality_of_idea": <0-25> },
  "fatal": "<the defect that would reject the entry outright, or 'none'>",
  "must_fix": ["<at most 4, ordered, each a concrete change>"],
  "method_objections": ["<at most 4, each naming the specific statistical claim and why it fails or holds>"],
  "overstatements": ["<at most 3 exact phrases from this brief that outrun the evidence, with the correction>"],
  "best_next_model_construction": "<the single best alternative construction you would run next, or 'keep the current one'>",
  "headline_rewrite": "<the one sentence you would put above the fold for judges>",
  "judge_60s": "<what a Qloo judge skimming for 60 seconds is most likely to misread>"
}
