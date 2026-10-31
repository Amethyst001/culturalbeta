# Null red-team — cultural beta flag rule

**VERDICT: BOUNDED NULL; the 0/80 flag count is real, the OOS arm is an ARTIFACT.**
1. **Flag count:** 44 negative, 3 at |t|>=2, 0 at q<=0.10; q is the binding gate.
2. **Power:** median MDE 13.66 pts ΔR² (IQR 12.15-14.54) vs strongest observed 6.73 pts; a bound, not no-effect.
3. **OOS:** all 80 row.oos numbers are zero-regressor perturbations; DIS -0.0582436 is arithmetic, not a test.
4. **Sign/scope:** only near-threshold name is positive (DIS q 0.1644; one-sided positive q 0.0822); 80/101 priced.

## 1. Gate decomposition (80 priced names)
| Gate | Count | Names / evidence |
|---|---:|---|
| `status="ok"` | 80 | `output/desk.json rows`; 18 unresolved + 3 no prices excluded |
| `beta<0` | 44 | 36 positive |
| `\|t\|>=2` | 3 | DIS +3.166, KDP -2.674, HSY +2.421 |
| `q<=0.10` | 0 | min q DIS 0.1643579 |
| `beta<0 & \|t\|>=2` | 1 | KDP |
| `beta<0 & q<=0.10` | 0 | — |
| `\|t\|>=2 & q<=0.10` | 0 | — |
| all three | 0 | `flagged=false` for all 80 |

Where they stop: 36 fail the sign; 43 of the 44 negative names fail `|t|`; KDP passes sign and `|t|` then fails q (0.3511239); DIS and HSY pass `|t|` then fail sign (and q). No name passes q. The nearest q overall is DIS 0.1643579; the nearest negative q is KDP 0.3511239. The count is arithmetically true; the inference "no effect" is not. `scripts/compute-betas.mjs:183` sets `flagged`.

## 2. p-value side and BH arithmetic
`src/ols.mjs:35-39` returns a two-sided p; `src/ols.mjs:84` stores `tDistP(Math.abs(t), df)`. `scripts/compute-betas.mjs:178-184` runs `benjaminiHochberg` over the 80 `culturalP` values and assigns `culturalQ`; the flag screens that same q. So the p is two-sided, and the q is over the same 80 p-values the rule screens (`src/multiplicity.mjs:4-15`).

| Name | beta | p2 | q2 | p1=p2/2 | q1 all-halved | q1 sign-adjusted | eligible |
|---|---:|---:|---:|---:|---:|---:|---|
| DIS | +43.8090 | 0.00205447 | 0.1643579 | 0.00102724 | 0.0821789 | 0.9989728 | no (positive) |
| KDP | -27.3809 | 0.00877810 | 0.3511239 | 0.00438905 | 0.1755619 | 0.3511239 | yes, fails q |
| HSY | +5.8514 | 0.01729618 | 0.4612316 | 0.00864809 | 0.2306158 | 0.9989728 | no (positive) |

`p1` is the one-sided p in the observed direction; `q1 all-halved` is the common shortcut of halving every p; `q1 sign-adjusted` uses p/2 for negative and 1-p/2 for positive. The rule is one-sided negative while q is the q of two-sided p, so q is conservative for a negative name. At q<=0.10 this changes no flag: KDP's one-sided q is 0.1756 under an all-p-halved BH, 0.3511 under a sign-adjusted BH, and 0.1931 under a negative-only 44-test BH; all exceed 0.10. The 0 count is robust to the mismatch; the mismatch is still the wrong q for the tested hypothesis (defect 6).

## 3. Strongest raw signal
| Name | beta | t | p (two-sided) | q | deltaR2 | deltaR2 pts |
|---|---:|---:|---:|---:|---:|---:|
| DIS | +43.808985 | +3.165994 | 0.00205447 | 0.1643579 | 0.06727250 | 6.7273 |
| KDP | -27.380894 | -2.673626 | 0.00877810 | 0.3511239 | 0.06712257 | 6.7123 |

DIS is the strongest raw signal in either direction (`output/mde.json book.observed.largestAbsT`). The lone-discovery threshold is p<=0.00125 (`output/mde.json method.singleDiscoveryLevel`, q/tests = 0.10/80), with tCrit 3.322736. DIS p2=0.002054 is 1.64x the threshold; t=3.166 is 0.157 below tCrit; q=0.1644 > 0.10. It does not clear. DIS is positive, so it is ineligible for the negative-only rule; its one-sided positive p is 0.001027, which would clear a one-sided 0.00125 threshold, but that is a different rule (section 5). KDP, the strongest negative, p2=0.008778 is 7.02x the threshold and q=0.3511; it fails too.

## 4. Reconciliation: `row.oos` is not a test
`scripts/compute-betas.mjs:128` calls `outOfSample({y, x: idxReturns, basket})`; `:154` writes the returned object to `row.oos`. `src/robustness.mjs:64-74` splits at k=67, fits `full=ols(train y,[train x,train basket])` and `mkt=ols(train y,[train x])`, then predicts the 35 test weeks with `bTe` at lines 72-73. For DIS, `output/series.json` has 102 dates; the last non-zero basket value is index 57 = 2025-12-22, and `basket.slice(67)` has 0 non-zero values over 2026-03-02..2026-10-26. The training full beta is `[-0.0069988, 0.7957877, 49.5905]`; the market beta is `[0.0002123, 0.9668704]`. On the test slice the full forecast is `-0.0069988 + 0.7957877*SPY + 49.5905*0`; the market forecast is `0.0002123 + 0.9668704*SPY`. `SSE_full=0.0322273`, `SSE_market=0.0295313`, `SST=0.0462881`, so `ΔR²=(0.0295313-0.0322273)/0.0462881 = -0.0582436`, exactly the published value (`r2=0.3038`, `r2Market=0.3620`).

The taste coefficient is multiplied by zero on every scored week. The number is a correctly computed forecast comparison between two training fits whose market coefficients differ (0.796 vs 0.967; intercept -0.0070 vs +0.0002); it measures whether that training-fit perturbation helps on 35 frozen weeks, not whether taste predicts returns. It is not a floating-point artifact; it is an inferential artifact. DIS's training basket correlates 0.253 with SPY; adding it moves the market beta from 0.967 to 0.796.

This is book-wide, not a DIS quirk: `output/mde.json frozenSlice` has `nonzeroRegressorWeeks:0`, `namesWithAnyMovement:0`, `computable:false`; `output/desk.json valueAdd.oos.scoring` has `testable:false`, `medianActive:0`, `frozenWeeks:35`, `frozenFrom:2026-03-02`. The row-level `oos` field is not gated by that diagnostic. The 80 numbers split 39 positive / 41 negative, mean -0.0004779; the sign is a coin flip. `output/mde.json caveats[5]` says the held-out slice "is not a test," and `README.md:100-108` says the cell is "no test." The book-level label is right; the row-level number is not a test.

The book mean is -0.0004779 with a 90% refit interval `[-0.02124, 0.00645]` (`output/desk.json valueAdd.oos.refit`); that is coefficient wobble, not a bound on taste.

What should replace it: set `row.oos = null` (or `{testable:false, reason}`) for every name with zero test-basket variance; render "no test"; do not expose `oosDeltaR2` as a number in `/api/v1/panel` or the CSV without per-row testability. If a held-out reading is required, use the post-hoc 58-week informative slice (38/20; median -0.49 pts, 38% positive, mean -8.4 pts, outlier-dominated; `output/desk.json valueAdd.oos.cadence`) and label it post-hoc, not a verdict. For a pre-registered test, wait for a Qloo pull that moves the percentile inside the test window and re-run the 67/35 split. The flag count does not use OOS, so 0/80 stands; the OOS evidence around it does not.

## 5. Sign choice and the two-sided alternative
Positive names with `|t|>=2`: 2. DIS q2=0.1643579; HSY q2=0.4612316. A two-sided rule at q<=0.10 finds 0. A one-sided positive rule finds DIS (p1=0.00102724, q1=0.0821789) and not HSY (q1=0.2306158 all-halved; 0.9989728 sign-adjusted). The sign choice is therefore decisive for the only near-threshold name. It is procedurally defensible — `config/book.json flagRule.negativeOnly=true`, `README.md:84-88` — but not interpretively neutral: the strongest signal is positive, so the null is a null on negative cultural beta, not on cultural beta. Do not headline "no cultural effect."

## 6. MDE and what the null is worth
Median ΔR² MDE 13.6563 pts; IQR 12.1483-14.5373 (`output/mde.json book.medianDeltaR2Pts`, `book.iqr`). Median beta MDE 14.7971 raw units; partial R² 14.9954%; min partial correlation 0.3872; tCrit 3.3227; df 99; singleDiscoveryLevel 0.00125. Observed: mean ΔR² 0.6717 pts; max 6.7273 pts (DIS); median |t| 0.6094; power at median observed 0.00414. DIS's own MDE 10.9722 pts (power at observed 0.4426); KDP 14.9464 (0.2665); HSY 14.9904 (0.1923). The strongest observed is below the smallest per-name MDE 8.6451; no name had 80% power at its observed effect.

**The sentence I would defend:** "At this design the pre-registered rule had 80% power only at a cultural-beta ΔR² of about 13.7 pts (median; IQR 12.1-14.5), while the strongest observed name was DIS at 6.7 pts, so 0 of 80 is a bound on what the rule could see, not evidence that cultural beta is zero."

The book-level placebo p 0.8978 (real 0.67 pts vs placebo mean 0.96 pts; `output/desk.json valueAdd.placebo`) is also a null result, not a power statement; it cannot convert the bound into an absence. The pre-registered second window is untestable (`output/desk.json valueAdd.secondarySkip`: Qloo levels cover 58/106 weeks, no name clears the 100-week floor), so there is no independent replication.

## 7. Defects, ranked
| # | Severity | Defect | One-line fix |
|---|---|---|---|
| 1 | CRITICAL | `scripts/compute-betas.mjs:128,154` writes `row.oos` unconditionally; `src/robustness.mjs:64-74` scores a zero test basket, so all 80 OOS numbers are training-fit perturbations (DIS -0.0582436). | Null `row.oos` when the test basket has zero variance; emit `{testable:false, reason}`; never print the number as OOS. |
| 2 | HIGH | `src/robustness.mjs:38` `testable: activeInTest.some(n=>n>0)` is book-level; one moving week in one name marks the whole book testable while all 80 rows still carry `oos` numbers, and there is no minimum active-week floor. | Compute per-name active test weeks; require at least 8 active test weeks (the ablation uses minTrainWeeks 8) or 5% basket spread; suppress OOS below it. |
| 3 | HIGH | `server/desk-server.mjs:149` exposes `oosDeltaR2` for every ok row; `productRow` has no `oosTestable`; CSV `:274` has only a book-level flag. | Add per-row `oosTestable` to JSON/CSV, or set `oosDeltaR2:null` when frozen. |
| 4 | MEDIUM | `scripts/compute-betas.mjs:178` computes BH over `priced` = 80/101; 18 unresolved + 3 no prices are excluded; home 5/10 and retail 5/12 are unresolved (`output/desk.json universe`). The null is conditional on Qloo resolvability. | Report 0/80 of 80/101 and a bound for the 21 missing; resolve more names or state the conditional population. |
| 5 | MEDIUM | The pre-registered second window has no priced rows: `output/desk.json valueAdd.secondarySkip` says Qloo levels cover 58/106 weeks; `valueAdd.secondary` is null. No independent replication. | Obtain a longer Qloo history or pre-register a new window before the next pull; do not call the single window replicated. |
| 6 | MEDIUM | `src/ols.mjs:84` gives two-sided p; `scripts/compute-betas.mjs:180-184` runs BH on those p-values; `config/book.json flagRule.negativeOnly` tests a one-sided negative hypothesis. The q is not the q of the one-sided hypothesis. | Use one-sided p (p/2 for negative, 1-p/2 for positive) in BH, or declare the rule two-sided and drop the sign screen. |
| 7 | MEDIUM | `scripts/compute-betas.mjs:183` screens `\|t\|>=2`, but the smallest p in this book (DIS 0.00205) already has q 0.164; every larger p has q>=0.164, so no name with `\|t\|` just over 2 can flag. The effective gate is q<=0.10. | Drop the `\|t\|` clause or state the effective threshold; rewrite `README.md:82-88` to say q<=0.10 is the binding gate. |
| 8 | LOW | `src/mde.mjs:259` uses `tQuantile(df, singleDiscoveryLevel)` where `tDistP` is two-sided; tCrit 3.3227. A one-sided 0.00125 threshold is 3.1026; DIS's MDE would be 9.99 pts vs 10.97. | Use the one-sided quantile or state the MDE is for the two-sided-p version of the rule. |
| 9 | LOW | `README.md:236` says a name fires on flag + own OOS positive + book placebo; `server/desk-server.mjs:217-224` also requires `oosTestable`. The README omits the guard that prevents the frozen-tail OOS from being used. | Add "and the held-out slice is testable" to the README alert rule. |
| 10 | LOW | `output/series.json` has only 7 featured tickers (`output/mde.json source.integrity.outputSeriesCrossChecked=7`); row.oos for 73/80 names cannot be reproduced from output/ alone. | Write all 80 series or a per-row hash; extend the cross-check to 80. |

**Bottom line:** 0/80 is arithmetically correct and survives the sign-preserving one-sided variants and the two-sided variant at q<=0.10, but it is a bound at ΔR²≈13.7 pts, not evidence of no effect. The OOS number is an inferential artifact: it must be nulled or relabelled, not defended.
