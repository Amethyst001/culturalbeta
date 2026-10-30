# Independent review brief, round 5 — Cultural Beta consumer equity desk (Qloo Agentic Hackathon)

Exercise abstract thinking. You are asked to actually review this submission: not to summarise it, not to
encourage the team, not to repeat their framing, and not to answer a reviewer's checklist with "done". Find
the errors, name the weak points, and say whether the claims follow from the evidence. Judge it the way a
Qloo judge would — the Qloo CTO is on the panel — and the way a statistician who must defend these numbers
in a seminar would.

This is round 5. Round 4's panel (53 / 72 / 58) asked for cadence-matched scoring, power at a pre-specified
effect, one primary null instead of an every-null rule, a visible Qloo-vs-peer panel, week-level cadence
evidence, and a clear NO SIGNAL vs FAILS distinction. While implementing the first item the team found a
defect none of the three reviewers had named, and the submission has been rebuilt around it. Your job is to
decide whether the new framing is correct, whether the fix is complete, and whether anything in the product
still outruns the evidence.

## What the submission is

A consumer equity desk: for each of 80 priced US consumer names in 11 sub-sectors it reports a market beta
(weekly return on SPY) beside a **cultural beta** — the coefficient on a weekly "taste basket" return built
from Qloo's `/v2/trending` endpoint. The pitch: taste is a candidate risk channel that an index beta does
not *measurably* report in this sample. The desk is a product surface (desk, taste map, evidence, per-name
holding page, plain-English read page, JSON/CSV API and an alerts feed) built around a pre-registered
falsification attempt.

Hard constraints the team set itself: no simulated Qloo data anywhere; if the result would be the same
without Qloo it is the wrong thing; no portfolio builder, optimiser, backtest or trading claim; every
number traceable to a cached Qloo response; the API key is server-side only.

## The data, as measured (paid run)

- 101 names → 83 resolve to a Qloo entity → **80 priced**. 18 unresolved keep their rows and lose their
  beta; 3 resolved names have no usable price series (WBD, EA, K).
- One taste basket per sub-sector: affinity-weighted blend of non-holding entities Qloo recommends from up
  to 10 of that sub-sector's resolved entities across brand/movie/artist/tv_show; every name in the
  universe excluded by construction. 72 basket calls, not one per name.
- `/v2/trending` levels reach 2022-07 for the deepest entities; deterministic on re-request; piecewise
  constant.
- **The correction to the previous brief.** The earlier text said "the newest ~8 weeks are frozen". The
  measured fact is much larger: every entity's `population_percentile` last changes in the week ending
  **2025-12-22**, which is the last week whose factor return is non-zero anywhere in the book. The price
  window ends **2026-10-26**, so its final **44 weeks** are a carry-forward with a weekly log change of
  exactly zero for every name.
- The pre-registered split fits on the first **67** weeks and scores the last **35** (2026-03-02 →
  2026-10-26). **All 35 scored weeks sit inside that frozen tail**; the median name's basket moves in **0**
  of them.
- All four weekly fields move at the same cadence, now checked at week level rather than by medians: the
  change indicator for `population_percentile` co-moves with `velocity_fold_change` on **90.0%** of weeks,
  with `population_percent_delta` on **90.0%**, and the two velocity fields co-move on **100%**.
- Four catalogue-revision weeks (2025-04-07/14, 10-13/20) are cut from both windows; the uncut re-run is a
  sensitivity (OOS −0.10 pts, placebo p 1.00).
- The pre-registered second window (106 weeks immediately before) cannot be priced — Qloo's levels cover 58
  of its 106 weeks — and is reported as **untestable**, not as a failed replication.

## What the frozen tail means, and what the desk now says

A regressor that is zero multiplies its coefficient by zero on every scored week. So the held-out condition
could not have detected a taste effect of **any** size: power equals size. The OOS ΔR² is a perturbation of
the training-fit market coefficients, not a taste result, and the refit interval is not a bound on taste.
The desk therefore:

- adds `valueAdd.oos.scoring` (`testable: false`, `frozenWeeks: 35`, `lastMove: "2025-12-22"`,
  `frozenAfterWindow: 44`, `medianActive: 0`) and computes it once in `src/robustness.mjs`;
- tags the OOS cell **"held-out slice frozen — no test"**, the chip **"OOS ΔR² not a test"**, and the
  grade chip **"held-out slice frozen"**;
- opens the evidence page with a grade-summary card and carries a "When Qloo's numbers stop moving" card;
- adds a read-page section, "What the held-out test can and cannot see";
- marks the ablation and sentiment arms **"perturbation, not a test"** (same split, same empty slice);
- changes the alerts feed's rule to require a testable slice, and its status is `watchlist-only` for that
  reason as well as the book placebo;
- adds an `oosTestable` column to the CSV.

The pre-registered split, window and signal definition are unchanged. Nothing was re-cut after seeing the
freeze.

## Results, from the current run

Per-name estimator (the pre-registered one): weekly return ~ SPY + own sub-sector's taste basket.

- Mean in-sample ΔR² from taste over market alone: **+0.67 pts**. Median |t| on the cultural beta: 0.60.
- Flags (negative beta, |t| ≥ 2, Benjamini–Hochberg q ≤ 0.10 across 80 names): **0**. With the frozen
  slice, a flag also cannot be raised through the out-of-sample condition; the read page says the zero is
  structural on this vintage, not a clean screen.
- Held-out arm: mean ΔR² **−0.05 pts**, 90% CI [−0.56, +0.28] fixed-coefficient, **[−2.12, +0.64]** refit.
  Both printed, both labelled as perturbations on this slice; the grade is read off the refit interval.
- Rotation null (400 circular shifts, all names shifted together): real +0.67 vs rotation mean +0.96,
  **p 0.898**.
- Date permutation, week by week: p **0.778**. Same null in **6-week blocks**: p **0.830**. The rule is
  **max-of-p** — the same hypothesis tested three ways, the largest p decides — and it is described as
  conservative by construction rather than as an intersection-union test.
- **Post-hoc cadence-aligned diagnostic.** Moving the split inside the revised part of the window
  (2024-10-21 → 2025-12-22; 58 informative weeks; 38 train / 20 test; 9 moving test weeks) gives median
  ΔR² **−0.49 pts**, positive on **38%** of names, mean **−8.42 pts**, range **−127.5 to +15.8**. It is
  labelled post-hoc and outlier-dominated, and carries no interval and no grade.
- Ablation against a same-sector peer basket (no Qloo at all): taste over peers **−0.78 pts**, 90% CI
  [−2.00, +0.41], positive on **57%** of names; its own rotation null reads p **0.126** with 206 of 400
  draws valid. Now marked **"perturbation, not a test"** because it uses the same frozen scored slice.
- **Qloo vs peer (new).** The correlation between a name's taste basket and its no-Qloo peer basket
  averages **0.04** (range −0.11 to +0.25); the taste basket moves in a mean **27 of 102** weeks, the peer
  basket every week.
- Consumer-sentiment exclusion (UMCSENT, monthly, month-over-month): taste over SPY and sentiment
  **−0.10 pts**, 90% CI [−0.70, +0.18]. Also marked a perturbation on this slice.
- Identification: the basket moves in **19–31 of 102 weeks** per name, median **29**.

**Pooled panel, common market slope.** Within-ΔR² **+0.04 pts**, permutation **p 0.928**.
**Pooled panel, per-name market loadings.** Loadings span **−0.29 to 2.40 (sd 0.55)**; within-ΔR²
**+0.04 pts**, permutation **p 0.923**, no sub-sector slope reaching |t| ≥ 2.

**Dispersion test.** Spread across names **805**; mean se² **1,869**; independent-rotation null mean
**1,352**; upper tail p **0.212**, lower tail p **0.791**; power at planted sd 1 / 5 / 10 / 25 / 50:
**0% / 0% / 0% / 0% / 100%**, against a pre-specified 80% bar; power at the observed spread (sd 28.4)
**0%**. Reading: **uninformative**. The analytic benchmark is treated as the miscalibrated one — inside the
null it overshoots by 25% — with the gap attributed to **two channels the null cannot separate**: summing
80 marginal variances treats the slopes as independent, and a shared calendar makes the cross-section move
together.

**The grade.** `HOLDS` requires positive OOS ΔR², a refit interval clear of zero, and every null at
p ≤ 0.10. The interval straddles zero and every null matches, so the grade is **NO SIGNAL**. A third state
now exists: when the scored slice cannot move, the held-out condition is **untestable**, and the desk says
that instead of calling the cell negative. FAILS remains reserved for a measured negative effect with an
interval clear of zero.

## What round 4 asked for, and what was done

1. **"Cadence-matched scoring / exclude the frozen weeks."** Done in the way the data allows and disclosed
   in full: the frozen tail is 44 weeks, not ~8, and it contains the entire pre-registered scored slice, so
   the held-out arm is marked untestable. A post-hoc cadence diagnostic is shipped beside it, labelled.
2. **"Power at a pre-specified MDE."** Rejected with a reason: on this slice power against any true effect
   equals size, because the scored regressor is identically zero. A curve at 0.5 pts would print the same
   zero as at 28 pts. The slice is labelled, not dressed.
3. **"Replace intersection-union with one primary null."** Partly accepted: the rule is now named and
   explained as **max-of-p**, which is what it always was; it was not replaced with a single null because
   each null tests a different failure mode and the product prints all three.
4. **"Active-week flag + floor."** The active-week count is already on every row and on the desk; a floor
   above 31 would delete the whole book, so it is disclosed as identification rather than applied as a
   filter.
5. **"Qloo-vs-peer panel."** Done, numbers above.
6. **"Week-level cadence."** Done: 90.0% / 90.0% / 100%.
7. **"NO SIGNAL vs FAILS."** Done, and extended with **untestable** as a third state.

## What we want from you

1. **Is "untestable" the right label for the held-out condition?** The pre-registered split is unchanged;
   all 35 scored weeks are a carry-forward; the desk says the arm could not have detected any effect size.
   Is that the correct treatment, or should the arm be removed from the product, replaced by the post-hoc
   cadence diagnostic, or graded anyway with a stated bound?
2. **Is the post-hoc cadence diagnostic defensible at all?** Median −0.49 pts, 38% positive, mean −8.42,
   range −127.5 to +15.8, 9 moving test weeks. It has no interval because block resampling can draw blocks
   with no movement and the refit then has a singular design. Should it ship labelled, or is shipping it a
   form of result-shopping?
3. **Is NO SIGNAL still the right grade?** Nothing in sample separates, no null separates, and the
   held-out condition cannot run. Is NO SIGNAL now misleading, and would a different label (e.g.
   "UNTESTABLE" or "NO SIGNAL IN SAMPLE") better describe the evidence?
4. **Did the frozen-tail fix miss a surface?** The desk, evidence, read, holding, alerts feed and CSV were
   all updated. Read for any number or sentence that still implies an out-of-sample test happened.
5. **Hackathon judgement.** Score /100 on each rubric axis: Technological Implementation, Design, Potential
   Impact, Quality of Idea. Name the weakest axis and the one change that would move it most. Can a Qloo
   judge see, in the product, that the Qloo data is load-bearing after these corrections?
6. **Fatal objections.** If something would make a judge reject the entry outright, say it first and
   precisely. If not, say so rather than inventing one.
7. **Overstatement.** Name any remaining phrase — in the desk copy, the README or this brief — that
   outruns the evidence, with the correction.

Return **one JSON object and nothing else** (no markdown fence, no prose outside it):

{
  "verdict": "PASS" | "FIX FIRST" | "FAIL",
  "score_total": <0-100>,
  "scores": { "technological_implementation": <0-25>, "design": <0-25>, "potential_impact": <0-25>, "quality_of_idea": <0-25> },
  "fatal": "<the defect that would reject the entry outright, or 'none'>",
  "must_fix": ["<at most 4, ordered, each a concrete change>"],
  "method_objections": ["<at most 4, each naming the specific statistical claim and why it fails or holds>"],
  "overstatements": ["<at most 3 exact phrases from this brief that outrun the evidence, with the correction>"],
  "untestable_label_verdict": "<is 'untestable' the right treatment — yes/no plus one sentence>",
  "cadence_diagnostic_verdict": "<should the post-hoc diagnostic ship labelled, or not at all — one sentence>",
  "grade_label_verdict": "<is NO SIGNAL still the right grade label — yes/no plus one sentence>",
  "best_next_model_construction": "<the single best alternative construction you would run next, or 'keep the current one'>",
  "headline_rewrite": "<the one sentence you would put above the fold for judges>",
  "judge_60s": "<what a Qloo judge skimming for 60 seconds is most likely to misread>"
}
