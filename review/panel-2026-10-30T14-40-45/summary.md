# External review panel — 2026-10-30T14-40-45

Brief: `review/brief-external-4.md`

## NVIDIA NIM / Nemotron 3.5 Super VL 120B

- verdict: **FIX FIRST** · total **58/100**
- scores: TI 16/25 · Design 17/25 · Impact 9/25 · Idea 16/25
- fatal: none
- best next construction: A two-way fixed-effects panel using name-specific Qloo entity exposures (affinity-weighted trending by entity, not sub-sector baskets), with week fixed effects to absorb the shared calendar, estimated only on weeks where the Qloo series has actually refreshed.
- headline rewrite: Qloo taste adds no detectable weekly alpha to SPY across 80 consumer names; the cultural beta is statistically indistinguishable from zero and the test is underpowered to rule out anything but a very large effect.
- judge in 60s: A Qloo judge skimming will see 72 cached basket calls and a server-side API and assume Qloo is load-bearing, then miss that the basket regressor changes in only a median of 29 of 102 weeks and the OOS score is partly computed against a frozen 8-week tail, so the null reads as a Qloo failure rather than a data-cadence limitation.
- must_fix:
  - Re-specify the estimation window so its end date (2026-10-26) does not exceed available price and Qloo coverage; re-run all statistics on a window fully inside the data.
  - Replace observed-spread power with a pre-specified minimum culturally meaningful dispersion (SESOI) and print the minimum detectable effect; declare the test uninformative if power at SESOI is below 80%.
  - Add an explicit disclosure that NO SIGNAL is not evidence of absence and is statistically indistinguishable from FAILS at this power, on the grade page and README.
  - Exclude the frozen tail (~8 weeks) from the out-of-sample evaluation, or disclose that the OOS score is partly computed against a Qloo regressor that has not refreshed.
- method_objections:
  - Observed-spread power is circular post-hoc power: it anchors on the estimate being tested and returns 0% because the observed spread is small, so it cannot validate the test or distinguish a null from a miss.
  - The 25% analytic/null mismatch does not prove the analytic benchmark is miscalibrated; shared-calendar dependence mechanically depresses cross-sectional variance below mean marginal variance, and the independent-rotation null may itself understate dispersion by destroying common factors.
  - The intersection-union rule is not binding here (all p >> 0.10), but with 0% power at the observed spread, NO SIGNAL is indistinguishable from FAILS or a small true effect; presenting it as a grade implies evidential weight it does not have.
  - The OOS ΔR² is scored over the last 35 weeks while the Qloo regressor is frozen for the newest ~8 weeks, so part of the out-of-sample evaluation uses stale regressor values and is not a clean out-of-sample test of the cultural channel.
- overstatements:
  - "the analytic benchmark is the miscalibrated one" — it is not miscalibrated; it estimates marginal precision and is the wrong benchmark for cross-sectional dispersion under shared-calendar dependence.
  - "NO SIGNAL — the factor was looked for and not detectable at this window length" — this reads as evidence of absence; the correction is "NO SIGNAL — the test has zero power at the observed dispersion, so the result is uninformative and does not establish the absence of an effect."
  - "the wider interval bounds what the window can exclude, which here is only effects larger than ~2.1 pts" — the refit 90% interval is [−2.12, +0.64], so it excludes effects above +0.64 or below −2.12, not merely effects larger than 2.1.

## BeatAPI / GLM 5.3 Flash (free)

_Unavailable: 429 {"error":{"code":"rate_limit_exceeded","message":"Rate limit exceeded: this model allows at most 1 successful requests per minute per account. Retry after 60 seconds. After your first top-up, this free model allows up to 10 successful requests per minute. Your top-up balance can also be used for pai_

## dahl / MiniMax M2.7

_Unavailable: 502 <!DOCTYPE html>
<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->
<!--[if IE 7]>    <html class="no-js ie7 oldie" lang="en-US"> <![endif]-->
<!--[if IE 8]>    <html class="no-js ie8 oldie" lang="en-US"> <![endif]-->
<!--[if gt IE 8]><!--> <html class="no-js" lang="en-US"> <!_
