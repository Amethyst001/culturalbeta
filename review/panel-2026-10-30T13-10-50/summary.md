# External review panel — 2026-10-30T13-10-50

Brief: `review/brief-external-1.md`

## NVIDIA NIM / Nemotron 3.5 Super VL 120B

- verdict: **FIX FIRST** · total **55/100**
- scores: TI 17/25 · Design 18/25 · Impact 8/25 · Idea 12/25
- fatal: none
- best next construction: Pooled panel regression r_it = alpha_i + beta_mkt SPY_t + beta_cult,s(i) basket_s,t + gamma UMCSENT_t + e_it with name fixed effects, sector-week clustered SEs, and ridge shrinkage on beta_cult; score OOS on the held-out 35 weeks using the pre-registered window.
- headline rewrite: No detectable cultural beta: 0 of 80 names pass the multiplicity-corrected screen, mean OOS delta-R-squared is -0.05 points (90% CI -0.56 to +0.28), and the rotation null cannot be rejected (p = 0.898), so Qloo taste adds no weekly signal beyond SPY in this sample.
- judge in 60s: A Qloo judge skimming for 60 seconds will most likely misread the careful null (0 flagged, negative OOS, rotation p = 0.898) as proof that Qloo data is useless for equity, when the real defect is the mismatch between weekly stock returns and Qloo's sparse, piecewise-constant, catalogue-revised percentile levels, not the quality of the underlying entities.
- must_fix:
  - Replace per-name weekly OLS on the shared sector basket with a pooled panel model (name fixed effects, one cultural beta per sector or hierarchical shrinkage) and cluster standard errors at sector-week; 80 names share roughly 29 nonzero basket weeks, so per-name classical SEs are not valid.
  - Stop deleting the four catalogue-revision weeks; dummy them or model them explicitly, since they are the only dates with simultaneous large basket moves (median log move 0.188-0.262 vs 0.0007 normally) and cutting them removes the identifying variation.
  - Pre-register one signal definition and present the velocity_fold_change to population_percentile log-change switch as a sensitivity analysis, not the main specification, because both signals are invalidated by the same refresh-cadence sparsity.
  - Report the effective sample (nonzero basket weeks per sector) and switch the placebo to a date permutation of basket move dates; the rotation null discards 194 of 400 draws and yields p = 0.126 with roughly 1/206 granularity, so it is unstable.
- method_objections:
  - The basket is zero in roughly 75% of weeks and the slope is identified on about 29 sector-weeks; the large per-name coefficients (DIS +43.8, KDP -27.4) are leverage artifacts of sparse nonzero weeks, not stable cultural exposures.
  - Running 80 separate time-series regressions on a common sector regressor treats 80 x 102 observations as independent when the effective sample for the cultural beta is roughly 29 sector-week moves; the Benjamini-Hochberg correction across names does not fix this pseudoreplication.
  - Cutting the four revision weeks removes the only dates with common, large basket movement and can only attenuate or bias the cultural slope, leaving identification to refresh-cadence noise rather than cleaning it.
  - The rotation null skips name-draws with fewer than 8 nonzero training weeks or less than 5% of basket spread and drops draws keeping under 80% of names (206 of 400 valid); p = 0.126 moves to 0.099 or 0.147 under looser or stricter rules, so it is not a stable usable number.
- overstatements:
  - cultural beta is an exposure an index beta cannot see — corrected: no exposure is detected; OOS delta-R-squared is -0.05 pts with a CI crossing zero and the rotation null gives p = 0.898.
  - the factor did not survive out of sample — a finding about the factor, not a defect in the desk — corrected: this frames a null result as a neutral product feature when the desk's core claim, a visible cultural beta beyond SPY, is unsupported.
  - alignment over peers — corrected: the peer ablation shows a -0.78 pts OOS gain (90% CI -2.00 to +0.41, p = 0.126), so there is no detectable added value or alignment over the peer basket.

## BeatAPI / GLM 5.3 Flash (free)

- verdict: **PASS** · total **71/100**
- scores: TI 20/25 · Design 17/25 · Impact 14/25 · Idea 20/25
- fatal: none
- best next construction: A pooled panel/ridge estimate: stack the 80 names, estimate one (or sector-level) cultural beta with name fixed effects and ridge shrinkage on the cultural coefficient, evaluated with the same OOS split and the same rotation/permutation nulls — same pre-registered signal, same endpoint, but ~80x the effective sample for the slope.
- headline rewrite: Over 102 weeks, a Qloo-derived taste factor shows no out-of-sample explanatory power for 80 US consumer equities beyond market, sector peers, and sentiment (OOS ΔR² −0.05 to −0.78 pts, all CIs crossing zero; 0 of 80 names clear multiplicity-corrected flags) — a negative result delivered with full provenance and pre-registered tests.
- judge in 60s: The judge will most likely misread '0 of 80 flagged' and 'FAILS' as a broken product or broken Qloo data, when the pipeline, provenance, and pre-registration are intact and the honest finding is that the sparse, revision-limited trending signal has no detectable incremental risk in this window — the judge may also miss that the exotic betas (DIS +43.8) are printed as diagnostics of low identification, not as tradeable claims.
- must_fix:
  - Replace per-name OLS with a pooled/panel or ridge-shrunk estimate: with the basket nonzero in ~25% of weeks, individual betas like DIS +43.8 are fitting noise; a hierarchical shrinkage across the 80 names (or a sector-panel estimate) uses the same pre-registered signal and would make the exotic betas and their SEs interpretable.
  - Report the number of effective observations next to every beta (nonzero weeks), and gate any name-level display on that count, not just on t/p.
  - Re-run the rotation null dropping the identification rule and instead reporting the null on the full grid with a stated alternative rule, so the p-value is not conditional on a rule chosen with 194/400 draws discarded.
  - Add one sentence of per-name effective-power (SE implied by ~25 nonzero weeks) to the alerts feed so 'suppressed' names are visibly under-powered rather than 'no headwind'.
- method_objections:
  - Sparse basket: with movement in 19–31 of 102 weeks, the cultural slope is identified on ~25% of the sample and classical OLS SEs are plausible but the effective information per name is tiny; the betas are meaningful only as low-precision point estimates, and the median |t| of 0.60 says so. Printing the nonzero-week count is honest but keeping per-name OLS is the weakest defensible choice; pooled or shrinkage estimation is strictly better and does not break pre-registration (it changes the estimator, not the signal).
  - Cutting the four revision weeks is legitimate as a data-quality cut (the moves are a catalogue artifact, not returns), but it likely biases ΔR² toward zero in both arms, so the nulls compare two attenuated numbers; the deeper problem is that after the cut the series is nearly frozen, so the test has little variance to work with — that should be stated as a power limitation, not left implicit.
  - The rotation null is weakly valid for a sparse series: circular rotation of a piecewise-constant series with ~29 movement weeks creates rotated series whose movement dates are a rigid shift of the true dates — the null does not explore the space of plausible movement-date patterns, so p 0.898 is not strong evidence against signal, only against 'any shifted cadence helps'. A permutation that permutes the *dates* of movement, or a block bootstrap resampling the nonzero weeks, would generate a richer null and is strictly better.
  - The identification rule (8 nonzero training weeks, 5% spread, drop draws keeping <80% of names, 194/400 discarded) means the reported p 0.126 conditions on a large, non-random subsample of draws; the sensitivity band 0.099–0.147 is the right disclosure, but a p-value whose value moves across the 0.10 line under the identification rule is not a usable number — report the null as 'uninformative' rather than 'borderline'.
- overstatements:
  - 'cultural beta is an exposure an index beta cannot see' — the evidence shows the exposure is not measurable out of sample; the correct claim is 'cultural beta is a proposed exposure whose incremental risk is not detectable in this window'.
  - 'alerts feed (names whose headwind cleared every test...)' — zero names cleared the multiplicity-corrected flag rule, so an alerts feed implying live signals outruns the evidence; it should be labelled 'watchlist (underpowered, none statistically confirmed)'.
  - 'FAILS ... a finding about the factor, not a defect in the desk' — the null is partly a power/identification failure of the construction (sparse factor, revision-cut window), so attributing it wholly to the factor is itself an overstatement; say 'does not survive out of sample in this window at this sparsity'.

## dahl / MiniMax M2.7

_Unavailable: 502 <!DOCTYPE html>
<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->
<!--[if IE 7]>    <html class="no-js ie7 oldie" lang="en-US"> <![endif]-->
<!--[if IE 8]>    <html class="no-js ie8 oldie" lang="en-US"> <![endif]-->
<!--[if gt IE 8]><!--> <html class="no-js" lang="en-US"> <!_
