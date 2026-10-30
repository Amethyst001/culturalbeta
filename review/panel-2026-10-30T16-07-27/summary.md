# External review panel — 2026-10-30T16-07-27

Brief: `review/brief-external-5.md`

## NVIDIA NIM / Nemotron 3.5 Super VL 120B

- verdict: **FIX FIRST** · total **53/100**
- scores: TI 16/25 · Design 14/25 · Impact 9/25 · Idea 14/25
- fatal: none — no simulated Qloo data, no trading claim, and no concealed fabrication; the entry honestly discloses that its central held-out test is vacuous on this vintage, so it is a null/untestable entry rather than a disqualifying one
- best next construction: Source a Qloo series that changes weekly within the scored period (or re-scope the scored window to end at or before the last Qloo move, 2025-12-22, only if pre-registration allows) so a held-out slice with a moving taste basket exists; then re-run the pre-registered split on a testable slice.
- headline rewrite: Qloo's taste basket is frozen for the final 44 weeks (last move 2025-12-22), so the pre-registered out-of-sample cultural-beta test cannot run on this vintage — no signal, not a failed test.
- judge in 60s: A judge skimming will most likely misread the held-out ΔR² (−0.05 pts) and its refit interval as an out-of-sample taste result, and the overall NO SIGNAL grade as a capable test that found nothing, when in fact the scored regressor is identically zero in all 35 scored weeks.
- must_fix:
  - Remove the post-hoc cadence diagnostic from the product desk, evidence, and read pages (or relegate it to a clearly non-evidence appendix with no grade); labelling a post-hoc, outlier-dominated, interval-less diagnostic does not make it evidence.
  - Stop reading the held-out grade off the refit interval and stop printing "Held-out arm: mean ΔR² −0.05 pts" as a taste result; replace it with a single line stating the scored slice is frozen (regressor identically zero in all 35 scored weeks; last move 2025-12-22) so the held-out taste test is untestable and no interval bounds taste.
  - Change the overall grade from NO SIGNAL to UNTESTABLE (or NO SIGNAL IN SAMPLE) so the grade does not imply a capable out-of-sample test found nothing; keep FAILS reserved for a measured negative effect with an interval clear of zero.
  - Do not re-cut the pre-registered split to chase a testable slice; instead either source a Qloo series that moves weekly within the existing scored window so Qloo is load-bearing, or accept the held-out test is untestable and remove all OOS ΔR² / refit-interval numbers from the grade.
- method_objections:
  - Held-out ΔR² and the refit interval fail as a taste test: the scored regressor is identically zero in all 35 scored weeks, so the cultural beta is unidentified on that slice and power equals size for any effect; the interval bounds only market-coefficient perturbation, not taste.
  - The rotation null (p 0.898) holds as an exchangeability check on in-sample ΔR² but cannot validate taste because it preserves the same frozen/low-movement regressor structure; it tests whether the in-sample fit is exchangeable, not whether a moving taste signal exists.
  - The max-of-p rule across week and 6-block date permutations (p 0.778 / 0.830) is an intersection-union decision (reject only if every p ≤ α), so describing it as "conservative by construction rather than as an intersection-union test" is a distinction without a difference, and it does not cure the frozen regressor.
  - The dispersion test is uninformative: power is 0% at the observed spread (sd 28.4) and reaches 100% only at planted sd 50, so it cannot detect effects at the scale actually present; attributing the analytic/null gap to "two channels" is post-hoc rationalization of an underpowered cross-section.
- overstatements:
  - "the grade is read off the refit interval" — the refit interval is computed where the taste regressor is identically zero, so it bounds only market-coefficient perturbation, not any taste effect; it cannot grade a held-out taste test.
  - "Held-out arm: mean ΔR² −0.05 pts" — this is a perturbation of training-fit market coefficients on a frozen all-zero regressor slice, not an out-of-sample taste result.
  - "taste is a candidate risk channel that an index beta does not measurably report in this sample" — on this vintage the scored Qloo basket is frozen (zero weekly change in all 35 scored weeks), so no taste effect of any size could be detected; it is untestable, not an open candidate in this sample.

## BeatAPI / GLM 5.3 Flash (free)

- verdict: **PASS** · total **61/100**
- scores: TI 17/25 · Design 16/25 · Impact 12/25 · Idea 16/25
- fatal: none
- best next construction: Re-run the pooled per-name-loading panel restricted to the 58 informative weeks with the split inside 2024-10-21→2025-12-22 as the pre-registered test on the next Qloo vintage refresh, dropping the dead tail entirely rather than treating it as an appendix.
- headline rewrite: On 80 priced names and one Qloo trending vintage, no measurable taste beta emerges in-sample — and the pre-registered held-out test is untestable because Qloo's series freezes 44 weeks before the price window ends.
- judge in 60s: A judge will most likely misread the printed −0.05 pts OOS ΔR² and its confidence interval as a real null result from a real test, missing that every scored week was a frozen carry-forward — the chip and column exist but sit one click below the numbers everyone reads first.
- must_fix:
  - Relabel the headline grade from NO SIGNAL to 'NO SIGNAL — held-out untestable on this vintage'; the third state exists in the UI but the grade word still implies a test ran and returned nothing.
  - Give the post-hoc cadence diagnostic a median-based block-bootstrap interval that resamples only moving weeks (or a signed-rank test on moving weeks), or cut the mean/range and print only the median and % positive — the −8.42 mean against a −127.5 outlier is not interpretable as shipped.
  - Print the 35 frozen scored weeks explicitly on the evidence page next to the OOS ΔR² cell so no reader can quote the −0.05/−0.56/+0.28 numbers without seeing 'no test'.
  - State the basket-build circularity limit: the rotation and date permutation nulls preserve whatever low-frequency structure the Qloo trending series shares across entities, so they rule out less than 'p 0.898' reads to a naive judge.
- method_objections:
  - The untestability claim is correct and follows: the regressor is identically zero on all 35 scored weeks (last movement 2025-12-22 vs window end 2026-10-26), so OLS identification fails exactly there and power equals size by construction; the perturbation framing of the OOS/refit intervals is the right one.
  - Max-of-p is described as 'conservative by construction', which is true for the union-of-failure-modes reading but the three nulls are highly dependent (same data, same calendar), so the effective test is closer to one null than three; do not let the multiplicity framing imply extra stringency it does not have.
  - The dispersion test's 'analytic benchmark is the miscalibrated one' inverts the usual burden: with sd 0.55 slope dispersion and dependent calendar shocks, the rotation null itself can be mis-sized; 805 vs 1352 vs 1869 is consistent with 'nothing detectable', and the power column (0% at planted sd ≤ 10) says so plainly — the defensible claim is 'uninformative', which is what the brief says, so this objection is that the attribution to two named channels is asserted, not tested.
  - The peer-ablation rotation p 0.126 with 206/400 valid draws is near-significance on a reduced draw set, and marking it 'perturbation, not a test' on frozen-slice grounds is right — but a judge will ask why the one comparison where taste underperforms a no-Qloo basket gets a validity discount while the taste-favouring cells keep full printing; the symmetric rule should be stated once and applied to all arms.
- overstatements:
  - 'The desk therefore ... computes it once in src/robustness.mjs' — the freeze makes the refit interval [−2.12, +0.64] a perturbation artefact, yet it is still printed with four significant figures on the read page; label it 'meaningless on this vintage' or drop it from the graded view.
  - 'median name's basket moves in 0 of them' combined with 'the basket moves in 19–31 of 102 weeks per name' — both are true, but the brief's identification sentence implies per-name variation exists in-sample; state that identification comes entirely from ≤ the 2025-12-22 boundary, not spread across the window.
  - 'a market beta ... does not measurably report in this sample' (pitch) — with zero flags, ΔR² of 0.67 pts and a null OOS arm, the honest pitch is 'no measurable taste channel found on this Qloo vintage', not a positive framing of what beta fails to report.

## dahl / MiniMax M2.7

_Unavailable: 502 <!DOCTYPE html>
<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->
<!--[if IE 7]>    <html class="no-js ie7 oldie" lang="en-US"> <![endif]-->
<!--[if IE 8]>    <html class="no-js ie8 oldie" lang="en-US"> <![endif]-->
<!--[if gt IE 8]><!--> <html class="no-js" lang="en-US"> <!_
