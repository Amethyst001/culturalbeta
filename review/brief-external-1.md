# Independent review brief — Cultural Beta consumer equity desk (Qloo Agentic Hackathon)

Exercise abstract thinking. You are asked to actually review the work below, not to summarise it and not
to be agreeable: find the errors, name the weak points, and say whether the claims follow from the
evidence. Judge it as a judge at the Qloo Agentic Hackathon would — the Qloo CTO is on the panel — and
also as a statistician who has to defend the numbers in a seminar.

## What the submission is

A consumer equity desk that reports, for 101 US consumer names in 11 sub-sectors, a market beta (weekly
return on SPY) beside a **cultural beta**: the coefficient on a weekly "taste basket" return built from
Qloo's `/v2/trending` data. The pitch: cultural beta is an exposure an index beta cannot see.

Hard constraints the team set for itself: no simulated Qloo data anywhere; if the result would be the
same without Qloo, it is the wrong thing; no portfolio builder, optimiser, backtest or trading claims;
every number traceable to a cached response.

## The data, as measured (paid run, all numbers from the actual run)

- Qloo entity resolution: 101 names → 83 resolved → **80 priced**. 18 unresolved (e.g. IPAR, SYY, PM,
  MO, ORLY); 3 priced names lack prices (WBD, EA, K). Unresolved rows stay in the book, withheld.
- One taste basket per sub-sector (affinity-weighted blend of non-holding entities Qloo recommends from
  up to 10 of the sub-sector's resolved entities across brand/movie/artist/tv_show; every name in the
  universe excluded). 72 basket calls total, not one per name.
- `/v2/trending` history reaches 2022-07 for the deepest entities. Values are deterministic across
  re-requests (99.7% of 5,531 entity-date pairs identical). The series is piecewise-constant (one brand:
  39 distinct levels over 166 weeks) and the newest ~8 weeks are frozen for every entity.
- `velocity_fold_change == population_percent_delta` on every point and is **0 on 71 of 106 primary
  weeks, on the same dates for every entity** (a Qloo refresh cadence, not stillness). The
  pre-registered signal was `velocity_fold_change`; it was amended **before any result was read** to a
  weekly log change in `population_percentile`: level per ISO week, `ln(level_t / level_{t-1})`, missing
  adjacent week → no observation. The amendment and reason are in `config/book.json`.
- Two catalogue-wide revision events (2025-04-07/14, 2025-10-13/20): every entity's percentile steps at
  once; book-wide median weekly log move 0.188–0.262 on those dates vs 0.0007 on a normal week. All 100
  extreme weekly moves sit on those dates. Those 4 weeks are **cut from both windows**, not dummied.
  Primary window becomes **102 weeks, 2024-10-14 → 2026-10-26**.
- Basket return is **zero in most weeks**: each sector's basket moves in **19–31 of 102 weeks**
  (median 29). So the cultural slope is identified on ~25% of the weeks.

## The estimator

Per name: `r_t = a + b_mkt·SPY_t + b_cult·basket_t + e_t`, OLS with classical SEs, t and two-sided p. The
cultural beta is `b_cult`. Flags require all three of: b_cult < 0, |t| ≥ 2, Benjamini–Hochberg
q ≤ 0.10 across all 80 priced names (a hundred |t| tests would flag ~5 by chance alone).

Robustness arms, all deterministic:
1. **Out of sample**: fit on the first 67 weeks, score the nested ΔR² (market-only vs market+basket) on
   the last 35. Signed, never clamped.
2. **Circular-rotation placebo**: rotate each basket series against returns by the same shift per draw
   (400 draws, fixed seed), preserving cross-name alignment and autocorrelation; p = share of rotations
   whose book-mean ΔR² matches or beats the real one.
3. **Peer-basket ablation**: control is the equal-weight return of the *other names in the same
   sub-sector*, no Qloo data at all. Peer-only vs peer+taste, fitted on 67 weeks, scored on 35; headline
   is the signed OOS gain of taste over peers. It carries its **own rotation null**. Rotations that leave
   a name's training window with < 8 nonzero weeks or < 5% of the basket's own spread cannot identify the
   coefficient; those name-draws are skipped, draws keeping < 80% of names are dropped and counted
   (**206 of 400 valid**).
4. **Consumer-sentiment exclusion**: taste must add over SPY *and* UMCSENT (FRED, monthly, carried as a
   month-over-month change on weeks inside each month; said to be coarse).
5. **Pre-registered second window**: 106 weeks immediately before, fixed in `config/book.json` before any
   keyed run. On this data it **could not be priced** — Qloo's levels cover 58 of its 106 weeks, so no
   name clears the 100-week floor. Reported as **untestable**, not as a failure to replicate; not
   re-dated or repurposed after the fact.

## The result

- Mean in-sample ΔR² from taste: **+0.67 pts** (market R² 11.4% → 12.0%); median |t| **0.60**.
- OOS ΔR²: **−0.05 pts**, 90% CI −0.56 → +0.28 (fixed-coefficient block bootstrap); refit-per-draw
  interval wider and also crossing zero.
- Rotation placebo: real 0.67 pts vs rotation mean 0.96 pts, **p 0.898**.
- Taste over peers: **−0.78 pts**, 90% CI −2.00 → +0.41, positive on 57% of 80 names; its own null
  **p 0.126** (borderline: 0.099 under a looser identification rule, 0.147 under a stricter one).
- Beyond sentiment: **−0.10 pts**, 90% CI −0.70 → +0.18.
- **0 of 80 names flagged** with the multiplicity-corrected rule. Individual betas are large and exotic
  (DIS +43.8 ± 13.8, KDP −27.4 ± 10.2) exactly because the basket is nonzero in ~25% of weeks; the desk
  prints that count under the table, prints the OOS column on each trace, and does not clip.
- A monthly re-expression of the factor (25 four-week blocks) makes OOS worse (**−11.3 pts**), so the
  null is not a weekly-cadence artefact.

The product says this plainly: the headline verdict is **FAILS** ("0 of 80 flagged"), with the
explanation that the factor did not survive out of sample — a finding about the factor, not a defect in
the desk. The desk serves a panel API, per-name pages with both windows and provenance, an alerts feed
(names whose headwind cleared every test, plus the reason every suppressed name did not fire), CSV export,
and a 287-check UI audit over 5 routes × 3 viewports.

## What we want from you

1. **Method.** Is the level-difference factor defensible given that the basket is flat in ~75% of weeks?
   Is the reported cultural beta meaningful under that identification, and is "print the nonzero-week
   count, keep the OLS, report OOS" the right answer — or is there a better construction available with
   the same endpoint (e.g. pooled/panel estimation, ridge/shrinkage, a different transform) that a
   statistician would prefer without breaking the pre-registration?
2. **Cuts and amendments.** Is cutting the four revision weeks legitimate, and could it bias the result
   (not just clean it)? Is amending the signal field after the keyed pull but before reading results
   honest and adequately disclosed, or does it still look like post-hoc flexibility?
3. **The nulls.** Is the rotation null valid when the rotated series is sparse? Is the identification rule
   (8 nonzero training weeks, 5% of spread; drop draws keeping <80% of names) sound, and is p 0.126 with
   194/400 draws dropped a usable number or a sign the null is broken? Would a permutation test on the
   *dates* of basket movement, or a block bootstrap of the taste series, be strictly better?
4. **Claims.** Read for overstatement. Does anything on the product outrun the evidence — the FAILS
   headline, "cultural beta is a risk factor", "0 names flagged", "alignment over peers" — and what
   single sentence should replace the headline so a Qloo judge reads the null as competence rather than
   failure?
5. **Hackathon judgement.** Score the entry /100 on each of: Technological Implementation, Design,
   Potential Impact, Quality of Idea (the rubric's four 25-point axes). Say which axis is weakest and the
   one change that would move it most.
6. **Fatal objections.** If there is a defect that would make a judge reject the entry outright, state it
   first and precisely. If there is none, say so rather than inventing one.

Return **one JSON object and nothing else** (no markdown fence, no prose outside it):

{
  "verdict": "PASS" | "FIX FIRST" | "FAIL",
  "score_total": <0-100>,
  "scores": { "technological_implementation": <0-25>, "design": <0-25>, "potential_impact": <0-25>, "quality_of_idea": <0-25> },
  "fatal": "<the defect that would reject the entry outright, or 'none'>",
  "must_fix": ["<at most 4, ordered, each a concrete change>"],
  "method_objections": ["<at most 4, each naming the specific statistical or data claim and why it fails or holds>"],
  "overstatements": ["<at most 3 exact phrases from the brief that outrun the evidence, with the correction>"],
  "best_next_model_construction": "<the single best alternative construction you would run next, or 'keep the current one'>",
  "headline_rewrite": "<the one sentence you would put above the fold for judges>",
  "judge_60s": "<what a Qloo judge skimming for 60 seconds is most likely to misread>"
}
