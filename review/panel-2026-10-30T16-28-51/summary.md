# External review panel — 2026-10-30T16-28-51

Brief: `review/brief-external-6.md`

## NVIDIA NIM / Nemotron 3.5 Super VL 120B

- verdict: **FIX FIRST** · total **50/100**
- scores: TI 15/25 · Design 13/25 · Impact 10/25 · Idea 12/25
- fatal: none
- best next construction: Re-base the sample on weeks where Qloo population_percentile actually changes, restrict to the 83 resolved names, pre-register a hold-out with non-zero taste regressor variation, switch to a Qloo endpoint with weekly movement instead of carry-forward percentiles, and power the dispersion test before reporting it.
- headline rewrite: Cultural beta desk: 101 consumer names, 80 priced, zero significant flags, and no testable out-of-sample slice because the Qloo taste series is frozen for the final 44 weeks.
- judge in 60s: A judge will read "NO SIGNAL (IN-SAMPLE)" and conclude the desk tested cultural beta and found it does not predict returns, when the out-of-sample test was impossible (frozen regressor) and the in-sample association failed its own nulls.
- must_fix:
  - Replace the grade "NO SIGNAL (IN-SAMPLE)" with a label stating the held-out slice is untestable, e.g. "NO OUT-OF-SAMPLE TEST — FROZEN TASTE REGRESSOR".
  - Remove the post-hoc diagnostic or re-label it as ungraded, non-pre-registered, and interval-free; it currently implies out-of-sample evidence.
  - Disclose on the data vintage card that Qloo population_percentile is frozen for the final 44 of 102 weeks and the taste regressor is identically zero across all 35 scored weeks.
  - Explain or remove the 18 unresolved names; 21 percent of the book lacks the core cultural column.
- method_objections:
  - The held-out taste regressor has zero variation, so the out-of-sample condition has power equal to size; "no test" is accurate but the surrounding copy still implies a completed inference.
  - All 35 scored weeks fall inside the carry-forward region; the final 44 weeks are stale Qloo data.
  - The dispersion test has 0 percent power at the observed standard deviation (28.4) and is labeled uninformative yet remains on the desk.
  - Qloo-vs-peer basket correlation averages 0.04; the taste basket moves in only 27 of 102 weeks while the peer basket moves every week, so the taste regressor is not a weekly signal.
  - The three nulls share one calendar and one frozen tail; p-values of 0.78 to 0.90 are not rescued by calling them one stringent check.
  - The 38/20 post-hoc split is median-led, outlier-dominated (range -127.5 to +15.8), and reported without an interval or grade.
- overstatements:
  - "NO SIGNAL (IN-SAMPLE)" claims a capable in-sample test found nothing; the in-sample nulls were not cleared (rotation p 0.90, week-order p 0.78, block p 0.83) and the out-of-sample slice is frozen. It should read "NO OUT-OF-SAMPLE TEST — FROZEN TASTE REGRESSOR."
  - The diagnostic's presentation of a post-hoc median (-0.49 pts) as an out-of-sample check overstates the evidence; it is post-hoc, ungraded, interval-free, and outlier-dominated. It should read "post-hoc diagnostic only, not evidence."
  - "IN-SAMPLE ONLY" implies a confirmed in-sample state; the correct reading is "in-sample association not confirmed by any null."

## BeatAPI / GLM 5.3 Flash (free)

- verdict: **PASS** · total **66/100**
- scores: TI 19/25 · Design 16/25 · Impact 14/25 · Idea 17/25
- fatal: none
- best next construction: Re-pull the full window on a current Qloo vintage so population_percentile actually moves in the held-out weeks, and use a basket constructed from Qloo entity-level affinity/taste signals that vary weekly (the trending basket moving only 27/102 weeks is the real power killer). Cross-validate the entity resolution against a known ticker-name mapping and pre-register the split before regenerating.
- headline rewrite: A deterministic cultural-beta desk over 101 consumer names found no association that survives in-sample rotation and permutation nulls — and, because Qloo's ranking data froze for the final 44 weeks, the pre-registered out-of-sample test could not be run at all.
- judge in 60s: A skimming judge will see '0 flags, NO SIGNAL' and score it as a failed product: no finding, no edge, nothing to ship. They will miss that the grade word is a deliberately honest epistemic state, that the OOS emptiness is a data-vintage defect the submission itself detected and reported, and that the statistical hygiene here (BH correction, rotation/permutation nulls, symmetric perturbation rule, no simulated data) is well above hackathon norm — which is where the real points are.
- must_fix:
  - State the 44/102 carry-forward and the empty held-out slice on the desk landing surface, not only in the vintage card — a judge who never opens that card will read NO SIGNAL (IN-SAMPLE) as a tested null.
  - Put a one-line resolution-failure reason per unresolved name (ticker aliasing, non-consumer brand string, Qloo coverage gap) so 18/101 does not read as a broken pipeline.
  - Cut or hard-downgrade the post-hoc split: as shipped it is a second look at a frozen region with no pre-registration and no interval; keep it only if labelled 'diagnostic, not evidence, not pre-specified' in the same visual weight as the graded cells.
  - Replace 'uninformative' dispersion framing with the actual consequence: with 0% power at the observed sd, the book cannot detect any effect of practical size — say that in the grade summary.
- method_objections:
  - The three nulls share one calendar and one frozen tail; they are not independent confirmations and the copy now says so, but a single 58-week informative window is thin evidence for an entire book-level grade regardless of label.
  - All 35 scored weeks are carry-forward with the regressor identically zero: the OOS design never had power. This should be presented as a data-vintage failure of the pre-registration, not folded into the grade word.
  - The post-hoc 38/20 split with a −127.5 outlier and mean −8.42 invites exactly the mean-vs-median shopping the median-led presentation tries to pre-empt; without a pre-specified analysis it proves nothing either way.
  - Qloo-vs-peer basket correlation of 0.04 means the control basket is nearly a different instrument; the symmetric perturbation rule is formally clean but the comparison is between a signal that moves 27/102 weeks and one that moves every week — unequal exposure, not a matched control.
  - 83/101 entity resolution with no published resolution methodology means the surviving 80 may be a selection-biased subset (large, well-documented brands resolve; the marginal names do not).
- overstatements:
  - Any phrasing implying the book was 'tested out of sample' — it was not; the held-out condition has power equal to size. Should read: 'the pre-registered out-of-sample window was frozen on stale Qloo data and could not test anything.'
  - '0 flags' as a finding — with 0% power at observed dispersion and +0.67 r² in-sample, the correct claim is 'the design could not have detected this effect size', not 'no name clears the bar'.
  - Dispersion 'uninformative' understates the problem: it is informative about power — the test cannot reject at any plausible effect — and the copy should say the book is underpowered, not neutral.

## dahl / MiniMax M2.7

- verdict: **PASS** · total **62/100**
- scores: TI 21/25 · Design 18/25 · Impact 11/25 · Idea 12/25
- fatal: none
- best next construction: Acquire a live Qloo data vintage with at least 20 weeks of post-freeze observations to populate the held-out slice. Until then, the product demonstrates a working pipeline and honest reporting, but cannot demonstrate the one thing it claims to do: that cultural beta adds predictive signal to market beta. The held-out test is not a formality — it is the entire empirical case.
- headline rewrite: A consumer equity desk that computes cultural beta from live Qloo data — currently reporting NO SIGNAL (IN-SAMPLE) because the held-out test has zero power on frozen data.
- judge in 60s: A judge skimming for 60 seconds will read 'NO SIGNAL (IN-SAMPLE)' as a finding that cultural beta was tested and came up empty, rather than understanding that the test itself had no power. They will see the post-hoc diagnostic median of −0.49 and treat it as corroborating evidence. They will not read the frozen-data disclosure in the OOS cell. They will likely score this as a failed hypothesis rather than a pipeline demo with honest reporting on a data limitation.
- method_objections:
  - The three nulls (rotation, week-order permutation, 6-week-block permutation) are described as sharing one calendar and one frozen tail, but this framing conflates data dependency with test independence. If the same frozen data feeds all three, the tests are not independent replications — they are the same test with cosmetic variation. The claim that this constitutes 'one stringent check' rather than three opportunities to fluke is unsupported.
  - The rotation and block-permutation nulls preserve 'slow shape' per the desk's own statement, which means they are weak tests for a weekly signal. The high p-values (0.78–0.90) may reflect test weakness rather than evidence against signal, but the desk presents them as evidence against.
  - The post-hoc 58-week split (38 train / 20 test) with 9 moving test weeks is not pre-registered and has no interval. Presenting median −0.49 with no confidence bounds and no grade does not make it safe — it still anchors the reader on a negative median before they read the caveats.
- overstatements:
  - The desk copy states the grade 'says the grade rests on the in-sample book and the nulls only.' This is accurate but the phrase 'IN-SAMPLE' in the grade word may still be read as a qualified positive finding rather than a statement that no test was possible.
  - 'The taste regressor is identically zero' in the OOS window is described as a perturbation tag, but this is not a perturbation — it is a structural consequence of frozen data. Calling it a perturbation implies it is a minor artifact; it is the reason the test has zero power.
  - The diagnostic median of −0.49 is presented without an interval, which implies precision the data does not support. A reader who sees 'median −0.49' and does not read the full diagnostic will anchor on that number.
