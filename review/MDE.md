# Minimum detectable effect: what this design could have seen

Written 2026-10-30 against the committed panel `output/desk.json`
(sha256 `ec0af92a5630ef6f`, 401,986 bytes, 102 aligned weeks 2024-10-14 to 2026-10-26,
80 fitted names of 101 roster entries). Every input was already on disk:
**zero Qloo requests**, no pipeline run, no fixture written.

Reproduce: `node scripts/mde.mjs` (re-derives each name's design from the cached series,
aborts unless it reproduces the published fit to 1e-9, then writes `output/mde.json`).
Check: `node --test tests/mde.test.mjs` — 20 tests, hand-computed t critical values,
a hand-computed residual sum of squares, identity round-trips, seeded determinism.

This document exists because the desk reported "0 of 80 names flagged" without saying
whether that was a result or an absence of a test. It is partly one and partly the other,
and the two have to be stated separately. Nothing here is investment advice and nothing
here is a forecast; the numbers describe what this study could see, not what any security
is worth.

---

## 1. The design and the rule (fixed before the data)

| item | value |
| --- | --- |
| regression | weekly return ~ SPY return + sub-sector taste basket, OLS with intercept |
| weeks | 102 aligned, 7 revision weeks dropped upstream |
| residual df | 99 (= weeks − 3) |
| tests in the multiplicity correction | 80 priced names |
| flag rule | fitted taste slope negative **and** `\|t\| ≥ 2` **and** Benjamini-Hochberg `q ≤ 0.10` |
| lone-discovery level | `q / m = 0.1 / 80 = 0.00125` |
| critical value at that level | `t_crit(99) = 3.3227` |
| noncentrality for 80% flag probability | `δ₈₀ = 4.1790` |

Only the 67/35 split and the flag rule were fixed before the data was pulled. **The MDE
was not chosen and is not pre-registered**: it is a consequence of the pre-registered rule
applied to a pre-registered design, which is exactly why it can be published now without
this being a case of picking a number after seeing the outcome.

## 2. Formula

`MDE` is published in two currencies per name, both computed on that name's own design:

```
β_MDE   = δ₈₀ · SE(β̂)                        (raw slope, basket units)
ΔR²_MDE = (1 − R²_market) · δ₈₀² / (δ₈₀² + df)   (increment over the market-only fit, points)
```

where `δ₈₀` solves the exact noncentral-t flag probability

```
P(β̂ < 0, p ≤ q/m) = E_V[ Φ(δ − t_crit · sqrt(V/df)) ] = 0.80 ,  V ~ χ²(df)
```

evaluated by 220-node Gauss-Legendre quadrature over the mixing variable. Two properties
make this checkable rather than asserted:

* `partial R² = t²/(t² + df)` is an identity, not an approximation, so the ΔR² column and
  the t column are the same statement in two units. `tests/mde.test.mjs` verifies it
  against a real three-variable OLS fit and against the design-side route
  `ΔR² = β² · Sxx_residual / SST_y`, which agree with `r²_full − r²_market` to 1e-12.
* at `δ = 0` the integral must return the test size exactly (`0.000625` here, half of the
  two-sided `0.00125`), and it does, to 1e-7, for df 7, 20, 55, 99 and 120.

The sign screen costs nothing: `t < −t_crit` already implies a negative fitted slope.
Using the lone-discovery level is conservative — if several names carried a true effect at
once, BH's step-up thresholds are looser and the MDE would be smaller.

## 3. Book-level MDE

| | full window, 102 weeks | informative weeks only, 58 (post-hoc) |
| --- | --- | --- |
| median ΔR² MDE | **13.66 pts** | **21.54 pts** |
| IQR | 12.15 – 14.54 | 17.59 – 23.64 |
| range | 8.65 – 15.00 | 11.46 – 24.91 |
| median partial-R² MDE | 15.00 pts (partial correlation 0.387) | 24.91 pts (0.387) |
| median `\|β\|` MDE | 14.80 slope units | 14.53 slope units |
| required noncentrality | 4.1790 at `t_crit` 3.3227, df 99 | 4.2719 at `t_crit` 3.4029, df 55 |

`β_MDE` is only comparable inside a sector: the level-difference baskets differ by two
orders of magnitude in scale, so the same 80% detection target is `|β| ≥ 4.23` for HD and
`|β| ≥ 1583.8` for PARA. ΔR² points and partial R² are the cross-book currencies; the
lowest ΔR² MDE in the book is AMZN (8.65 pts, market R² 0.42) and the highest HRL
(15.00 pts, market R² ≈ 0).

**The informative-weeks column is post-hoc.** The cut is not a window anybody chose in
advance: it is measured from the committed series as the last week in which any basket
moved (`2025-12-22`), and everything after it — 44 of 102 weeks — carries an identically
zero taste regressor. It is labelled `postHoc: true` in `output/mde.json` (in
`method.subPeriodCut`, `book.informativeSubPeriod`, `method.postHocFields` and `designRequirement`)
and it is a sensitivity statement about the design, not a second pre-registered test.

What the frozen tail actually costs is small and it is not the story: the median name's
standard error is 3.3% worse on the full window than on the 58 moving weeks (ratio
full/sub: 10th pct 0.931, median 1.033, 90th pct 1.218, worst PARA 6.45), and for 25 of 80
names the shorter window is *sharper*. The detectable slope is unchanged to within 2%. The
58-week ΔR² requirement looks larger mainly because df falls from 99 to 55 and because each
name's market R² is re-measured on the shorter window. **The design is under-powered at any
length this side of a decade**; that is the finding, and section 7 quantifies it.

## 4. Observed readings against the bound

The book's mean in-sample increment is **0.672 pts**; the median name could only have been
shown an increment of **13.66 pts**. The median name's own observed increment is 2.4% of
what its design demands (best case in the book, DIS, 61%).

| name | β | t | q | ΔR² observed | ΔR² detectable | share of required δ | flag probability at that effect |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DIS | +43.81 | +3.166 | 0.164 | 6.73 pts | 10.97 pts | 75.8% | 44.3% |
| KDP | −27.38 | −2.674 | 0.351 | 6.71 pts | 14.95 pts | 64.0% | 26.6% |
| HSY | +5.85 | +2.421 | 0.461 | 5.59 pts | 14.99 pts | 58.0% | 19.2% |

Three of 80 names clear the raw `|t| ≥ 2` screen; only KDP does so with a negative slope;
**none** clears BH `q ≤ 0.10`, so 0 names are flagged. Across the book the per-name flag
probability at the effect that name *actually shows* has median **0.41%** (10th–90th
percentile 0.09%–2.2%, maximum 44.3% at DIS). That is the reviewer's dispersion point,
confirmed with the number attached: at the observed spread this rule has essentially zero
power, and saying "no names flagged" without it was misleading.

Note also that DIS and HSY are positive slopes: the pre-registered direction screen
excludes them before multiplicity is ever reached. The single largest *negative* reading,
KDP at 64% of the required noncentrality, is the closest this study came.

## 5. Simulated versus analytic power

`output/mde.json` → `simulation`. Seed **20261030** committed in `scripts/mde.mjs`;
2,000 draws per iid arm, 1,000 per block arm, one planted name per draw rotating through
all 80 so every design is exercised equally, scored by the real rule (sign, `|t| ≥ 2`,
Benjamini-Hochberg over the 80 p-values from `src/multiplicity.mjs`).

* **iid arm** — the committed design exactly, errors drawn i.i.d. Gaussian at each name's
  own fitted residual scale. This is the arm the analytic formula describes, so agreement
  checks the formula, the quadrature and the BH implementation.
* **block arm** — `(market, basket, residual)` triples resampled jointly in 8-week circular
  blocks from each name's own committed series. Contemporaneous market/basket/residual
  relations and within-block dependence survive; alignment longer than one block does not.
  It is a dependence stress test, not a model of the real calendar.

| alternative | analytic | iid (2,000 draws) | block (1,000 draws) | mean signal `\|t\|`, iid vs block |
| --- | --- | --- | --- | --- |
| no effect anywhere: per-test rejection at the lone-discovery level | 0.00125 | **0.001304** | **0.00604** | 0.780 vs 0.570 |
| DIS-sized effect, δ = 3.166 | 0.44265 | **0.4675** [0.4456, 0.4894] | 0.4590 [0.4281, 0.4899] | 3.200 vs 3.093 |
| the published MDE, δ = 4.179 | 0.80000 (by construction) | **0.8130** [0.7959, 0.8301] | **0.7070** [0.6788, 0.7352] | 4.171 vs 4.055 |

Where they disagree, that is the finding:

* The iid arm reproduces the analytic claim to +0.00005 in size and +0.013 at the MDE, both
  inside about one Monte-Carlo standard error of 0.8; the small positive bias is expected,
  because the simulated rule is a BH step-up over 80 p-values while the analytic figure is
  the stricter lone-discovery threshold. The formula is sound.
* The block arm is materially worse and the gap is not papered over: detection at the
  effect the study was powered for falls to **0.707 against the nominal 0.80**, and the
  under-null rejection rate is **0.60% against a nominal 0.125%** — roughly five times the
  level. The two directions of that gap have different mechanisms and both are visible in
  the table. Drawing 8-week blocks with replacement changes how much basket variance a design
  carries, while the planted slope stays calibrated to the *committed* standard error: in a
  draw whose resampled basket is flatter than the original, the same true slope is a smaller
  multiple of the new standard error, so typical evidence shrinks (mean signal `|t|` 4.055
  against 4.171) and power at a fixed effect falls. Separately, the residuals keep their
  week-to-week dependence inside a block while the estimator's standard error assumes
  independence, so in exactly those flatter designs the fitted standard error understates the
  true spread of the slope and `|t|` lands far out in the tail — which is why the same arm
  has a smaller centre *and* a 5× over-rejection rate under the null. Practical reading: the
  `q ≤ 0.10` budget is looser than nominal in the presence of the autocorrelation this panel
  actually has, and the 80% power claim should be read as about 71% under a
  dependence-preserving design. Degenerate resampled fits are counted, not averaged away:
  27–29 of every 80,000 name-draws land on designs whose basket carries no variation at all
  — the frozen tail showing up again inside the stress test.

## 6. The held-out arm is not a test

One sentence, because it should not be softened: **the pre-registered out-of-sample
comparison is invalid rather than low-powered — the taste regressor is identically zero on
all 35 scored weeks (0 of 80 sector baskets moves after 2025-12-29), so its residual sum of
squares is 0, the slope is not estimated at all, and no detection probability is published
for that slice.** `output/mde.json` → `frozenSlice` carries `computable: false` with the
mechanism, not a number: worked example ELF, 35 scored weeks, 0 non-zero regressor weeks,
basket residual sum of squares `0`, while the same name shows 0.395 ΔR² points in-sample
(where the basket does move). `src/mde.mjs` refuses this path by construction:
`frozenSliceVerdict` returns a verdict object, `fitTwoFactor` returns
`degenerate: true` instead of dividing by a near-singular normal matrix, and
`simulatePower` throws rather than simulating power for an unidentified parameter.
"Out-of-sample: untestable" is a statement about the data feed's carry-forward cadence, and
it becomes testable the moment `population_percentile` moves again — the machinery is
already guarded to report it either way.

## 7. Effect-size bounds: what would have been detectable

`output/mde.json` → `designRequirement` (post-hoc as a choice of effect size — these are the
observed increments and a round grid — and pre-registered as a rule). Each row holds the
effect fixed in ΔR² at the name's own market share of variance and asks how many weeks the
same rule needs for an 80% flag probability.

| effect size | weeks needed | years | × current panel |
| --- | --- | --- | --- |
| 0.67 pts — the book's mean in-sample increment | 2,201 | 42.3 | 21.6× |
| 1 pt | 1,476 | 28.4 | 14.5× |
| 2 pts | 734 | 14.1 | 7.2× |
| 5 pts | 289 | 5.6 | 2.8× |
| 6.71 pts — KDP, the largest negative reading | 238 | 4.6 | 2.3× |
| 6.73 pts — DIS, the largest increment in the book | 172 | 3.3 | 1.7× |
| 10 pts | 140 | 2.7 | 1.4× |
| 13.66 pts — this table's own median MDE (self-check) | **104** | 2.0 | 1.0× |

The last row is the guard rail: asking the table to return the increment the 102-week design
can detect answers 104 weeks, so the table is calibrated. Read as bounds: **this design could
have flagged a taste effect worth about 13–15 ΔR² points (a partial correlation near 0.39) on
a single name; it could not have flagged anything at the 0.5–7 point scale the panel actually
shows, and an effect of the size the book's average name displays would need roughly 2,200
weeks at 80% power.**

## 8. Three sentences that are not the same sentence

* **"We detected nothing."** An outcome: 0 of 80 names cleared the pre-registered rule, and
  the mean in-sample increment over 102 weeks is 0.672 points. This is what the desk printed.
* **"We could not have detected it."** A design statement, independent of any outcome: at the
  lone-discovery level 0.00125, the median name needs 13.66 ΔR² points (a partial correlation
  of 0.387) to be flagged with 80% probability, and the largest reading in the book, DIS at
  6.73 points, sat at 75.8% of the required noncentrality with a 44% chance of being caught —
  and DIS is a positive slope, so the rule was never going to flag it. Everything the null
  result is worth is worth less than what the design could see.
* **"The study was incapable of detecting it."** A structural statement: the pre-registered
  held-out arm has a regressor that is identically zero on every scored week, so there is no
  sampling distribution to reason about and no power figure exists — that arm produced no
  evidence and could not have produced any, whatever the data said about returns.

The first sentence was in the desk. The second is the bound the desk should have shipped
with it. The third is why "no out-of-sample result" is not an out-of-sample result.

## 9. Limits of this analysis

* The MDE assumes the errors are Gaussian and independent given the design; the block arm in
  section 5 is the honest measure of what that assumption costs, and it is a real cost.
* `δ₈₀` is computed against BH's lone-discovery threshold. It is conservative if multiple
  names carry true effects and slightly anti-conservative about the FDR itself, which is a
  step-up procedure and does not bound the family-wise error rate.
* ΔR² figures are in-sample increments for a fixed basket definition; they are not
  cross-validation scores and they carry no claim about forward-looking usefulness.
* The 58-week cut is post-hoc. If Qloo's cadence changes, `informativePrefix` moves and the
  sub-period numbers move with it; nothing here needs re-authoring.
* Basket choice is a separate sensitivity, already published in `review/BASKET-SENSITIVITY.md`;
  this document takes the committed basket as given and asks only what could be seen through it.
