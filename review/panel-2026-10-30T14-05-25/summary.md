# External review panel — 2026-10-30T14-05-25

Brief: `review/brief-external-3.md`

## NVIDIA NIM / Nemotron 3.5 Super VL 120B

- verdict: **FIX FIRST** · total **50/100**
- scores: TI 15/25 · Design 15/25 · Impact 7/25 · Idea 13/25
- fatal: none
- best next construction: Keep the pre-registered falsification design and intersection-union rule, but rebuild the taste basket from a Qloo endpoint with non-frozen, genuinely weekly variation so the regressor moves in most estimation weeks, then re-run the per-name and panel regressions with the same windows and nulls.
- headline rewrite: Qloo taste adds no measurable weekly risk to SPY beta across 80 consumer names: a pre-registered null result, not a factor.
- judge in 60s: A judge skimming for 60 seconds will likely misread the per-name cultural beta column as a differentiated signal and the 'NO SIGNAL' grade as a formatting choice, when the taste basket moves in only about 29 of 102 weeks (median), the newest Qloo weeks are frozen, and the dispersion test shows the per-name spread is below the noise floor—so the column is mostly estimation error with no cross-sectional meaning.
- must_fix:
  - Reconstruct the taste basket from a Qloo series with genuine weekly variation (not piecewise-constant `/v2/trending` levels with a frozen newest ~8 weeks) so the regressor moves in most of the 102 estimation weeks instead of the current median of 29.
  - Recalibrate or reinterpret the dispersion test: the observed spread (805) sits below the noise floor (1,869) and the null mean (1,352), which with weakly identified per-name betas indicates attenuation/miscalibration, not homogeneity; report it as inconclusive or use simulation-based SEs that incorporate generated-regressor error.
  - Replace the intersection-union plus refit-interval grade with a power-aware rule (or publish the minimum detectable effect for 35 out-of-sample weeks) so a real but modest cultural effect is not automatically suppressed.
  - Disclose on every per-name holding page that the cultural beta is identified off at most 31 active weeks and that the cross-sectional dispersion test found no excess heterogeneity, so the column is not mistaken for a differentiated signal.
- method_objections:
  - Dispersion test: spread 805 < noise floor 1,869 < null mean 1,352; with per-name betas identified off a median of 29 active weeks of a piecewise-constant regressor, estimates are attenuated and standard errors inflated, so the variance comparison is biased toward homogeneity and 'no detectable heterogeneity' is not established.
  - The cultural regressor is not a weekly return in practice: `/v2/trending` is piecewise constant and the newest ~8 weeks are frozen, so the cultural beta is estimated from rare step changes rather than a persistent weekly taste channel.
  - The intersection-union rule with a refit interval on only 35 out-of-sample weeks has very low power (CI [−2.12, +0.64]); it would fail to detect a real effect smaller than roughly 2 points, so NO SIGNAL is a low-power conclusion, not evidence of absence.
  - The pooled panel reports two nominally significant sub-sector slopes (restaurants t −2.12, apparel t 2.08) that fail Bonferroni 0.0045, and the per-name-market variant eliminates even those (largest t 1.27); presenting them without the multiple-testing burden reads as noise.
- overstatements:
  - Phrase: 'genuine heterogeneity between names is not detectable' — correction: the test found no excess dispersion, but the below-noise spread signals attenuation/miscalibration under weak identification, so homogeneity is not established; use 'no excess dispersion detected; the test cannot distinguish homogeneity from attenuation.'
  - Phrase: 'the spread is no larger than noise, and if anything smaller' — correction: the lower tail (p 0.791) does not establish smaller-than-noise spread; it flags that the variance estimator is inconsistent with the reported standard errors under the null; use 'the observed spread is below the noise floor, inconsistent with a correctly specified variance estimator.'
  - Phrase: 'it killed the cross-sectional fallback rather than supporting it' — correction: the test was underpowered and likely biased toward the null by shrinkage; it did not falsify heterogeneity; use 'the test failed to detect excess dispersion and is consistent with attenuation from weak identification.'

## BeatAPI / GLM 5.3 Flash (free)

- verdict: **PASS** · total **78/100**
- scores: TI 21/25 · Design 22/25 · Impact 15/25 · Idea 20/25
- fatal: none
- best next construction: Keep the current construction, but add a power-calibrated dispersion test: simulate heterogeneity (sd 0.3 and 0.5) through the same rotation machinery conditional on each name's observed active-week pattern, and report the smallest detectable sd. That converts the kill from an assertion into a bounded claim and tells the judge exactly what a longer window would buy.
- headline rewrite: Taste-basket returns show no measurable cross-sectional or time-series association with consumer equity returns beyond the market over 2024-2026, and the desk reports the exact effect sizes and heterogeneity this window cannot exclude.
- judge in 60s: A judge will most likely misread NO SIGNAL as 'Qloo data does nothing here' — when the desk's own peer-basket ablation, which uses no Qloo data, performs comparably out of sample, that reading is hard to refute from the current surface. The 60-second skim needs to see why a no-Qloo control is the honest test and what Qloo uniquely provides (entity resolution, affinity weighting, exclusivity by construction), or the CTO will conclude the pipeline is Qloo-decorated rather than Qloo-dependent.
- must_fix:
  - Print a power statement next to the dispersion result: the minimum cross-sectional sd of true betas this test could detect given a median of 29 active weeks and SEs of the observed width. Without it, 'no detectable heterogeneity' is unreadable as either a kill or a pass.
  - Reconcile the three inconsistent variance figures (observed 805, mean-squared-SE 1,869, independent-rotation null mean 1,352). The rotation null mean exceeding the analytic noise benchmark by 55% shows one of the two benchmarks is miscalibrated; identify which before citing either.
  - Surface the Qloo-vs-peer-basket ablation side by side in the product UI. Right now the desk's own no-Qloo control performs comparably out of sample, and a judge who digs finds the Qloo delta unmeasurable; show the comparison deliberately rather than letting it be discovered.
  - State on the read page that NO SIGNAL is conditional on a 102-week window with a piecewise-constant source of 19-31 active weeks, and give the detectable-effect bound explicitly (~2 pts on the refit interval).
- method_objections:
  - Dispersion test reading: the construction (independent rotation, both tails) is defensible, but 'no detectable heterogeneity' is only non-detection. With median 29 of 102 active weeks the per-name SEs are wide, the mean-squared-SE benchmark inherits that width, and the test's power against realistic heterogeneity (sd 0.3-0.5) is unknown. Spread 805 < null mean 1,352 is as consistent with overestimated SEs under thin identification as with genuinely homogeneous names. The reading is correct only as stated, not as a kill.
  - Intersection-union rule: valid but conservative. The rotation and permutation nulls are computed on the same dataset and are positively correlated, so demanding both at p <= 0.10 pushes the effective level well below 0.10; a real effect of the magnitude this window could resolve would likely fail the rule too. Acceptable for a falsification-first desk, but the team should state the rule suppresses power, not just that it is stricter.
  - Grading on the refit interval [-2.12, +0.64]: refitting inside each bootstrap draw is honest, but the resulting interval is so wide that the data cannot distinguish 'no effect' from 'large negative effect.' The FAIL/NO SIGNAL distinction therefore rests on a point estimate (mean OOS -0.05) that has essentially no standing; the distinction is semantic, and the desk should not lean on it.
  - Permutation p-values on within-delta-R-squared for a piecewise-constant series: permuting week labels destroys the serial structure imposed by the refresh cadence (71 of 106 weeks at exactly zero). The null distribution may be mis-calibrated in the direction of ease; a block permutation respecting the cadence would confirm the 0.898/0.778/0.923 figures.
- overstatements:
  - "kill of the team's own fallback story" / "came back a kill" — upper tail p 0.212 with a conservative, low-power benchmark is non-detection, not a kill; correct to 'the dispersion test found no evidence of heterogeneity and has unknown power.'
  - "3 priced names lack prices (WBD, EA, K)" — contradiction in terms; these are resolved names that lack prices. As written the 80-priced count is not internally consistent.
  - "the factor was looked for and not detectable at this window length" adjacent to "explicitly not FAILS (measured negative, interval clear)" — the refit interval is not clear of zero on either side, so neither grade's parenthetical describes the data cleanly; the correction is that NO SIGNAL and FAILS are not distinguishable at this power.

## dahl / MiniMax M2.7

_Unavailable: 502 <!DOCTYPE html>
<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->
<!--[if IE 7]>    <html class="no-js ie7 oldie" lang="en-US"> <![endif]-->
<!--[if IE 8]>    <html class="no-js ie8 oldie" lang="en-US"> <![endif]-->
<!--[if gt IE 8]><!--> <html class="no-js" lang="en-US"> <!_
