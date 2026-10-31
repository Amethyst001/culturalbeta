# Impact pitch — Cultural Beta desk

Data vintage: 102 weeks ending 2026-10-26 · 80 of 101 names priced · 0 flags · Qloo's last taste-series move 2025-12-22.
Prepared 2026-10-31. No investment advice and no predictive claim.

## 1. The thesis

> At this vintage Qloo taste is below detection: 0 of 80 names clear the bar. The desk reports a 13.7-point resolution and re-prices the affected name on revision.

## 2. The 60-second narrative

**Believed — 11.3%.** Market beta is the risk model for a consumer book. On this book it explains 11.3% of weekly variance on average across the 80 priced names; the rest was treated as noise, or as taste. The hypothesis was that an affinity-weighted Qloo basket would explain a measurable increment beyond SPY.

**Tested — 0 of 80.** 102 weekly returns, 80 priced names in an 11-sub-sector book, one pre-registered rule: negative cultural beta, |t| ≥ 2, Benjamini–Hochberg q ≤ 0.10 across the book. Result: 0 of 80 flags; the basket added 0.67 points of R² in sample; median |t| 0.60.

**Now — 0.59 points.** The differentiator is not the factor; it is the revision path. At answer time the server attests Qloo freshness outside the model loop; if Qloo has revised, it re-estimates up to two affected names and prints committed vs re-estimated beta with a receipt. The replay exercised that path end to end on the real 2025-12-22 revision — not a live revision: DIS 52.77 → 43.81 on 55 vs 102 weeks; median |Δβ| 0.59 points; 0 flips. That is repricing, not attribution; 0 flips is not stability, because the 55-week side cannot clear the desk's 100-week floor.

Replay tail: p90 |Δβ| 6.74, max 160.3 (PARA); the median is not the whole book.

## 3. The bound

The null is a resolution reading, not a verdict on taste. The median minimum detectable effect is a 13.7-point ΔR² over market-only — a cultural beta of 14.8 on the median name — at 80% detection under the pre-registered rule. The book's mean in-sample increment is 0.67 points, about 20× smaller. What the null licenses: a statement that a taste effect at the 13.7-point scale is unlikely to have been missed — the rule flags such an effect 80% of the time, and 0 of 80 flagged. What it does not license: any claim that taste is absent. An effect smaller than 13.7 points — including the 0.67-point increment measured — is below the design's 80% detection threshold, and even a 13.7-point effect has a 20% chance of being missed. The held-out arm licenses nothing at all: Qloo's last `population_percentile` move is 2025-12-22, the final 44 of 102 weeks are a carry-forward, and all 35 scored weeks (2026-03-02 → 2026-10-26) have a regressor of exactly zero for all 80 names — 0 nonzero weeks. A coefficient times zero is zero, so the test's chance of finding any true effect is just its false-positive rate. The instrument reads "below detection at this resolution"; it does not read "zero."

## 4. What would change our mind

**Dated 2026-10-31.** The next re-test is committed, not aspirational:

- **Trigger:** the first Qloo vintage published after 2026-10-31 that reports a `population_percentile` move after 2025-12-22 for any of the 80 priced names inside the fixed 2024-10-14 → 2026-10-26 window. Publish within 10 business days of that vintage; if no such vintage arrives, publish "still frozen" on **2027-01-31** with the last-move date.
- **Sample floor:** the existing 100 weekly points per name. Testable requires at least one non-zero regressor week in the scored slice; if zero, publish "untestable" with the count.
- **Rule:** identical two-regressor OLS, identical flag rule — negative cultural beta, |t| ≥ 2, Benjamini–Hochberg q ≤ 0.10 across the 80 priced names.
- **First flip:** **1 of 80** names flags.
- **Headline flip:** held-out ΔR² **> 0.00 points**, the 90% refit interval's lower bound **> 0.00**, and all three nulls at **p ≤ 0.10**.
- **If not:** the verdict stays "below detection at this resolution"; no reinterpretation.

## 5. Five hostile questions

**(a) "So it doesn't work?"** No. It means the desk could not detect it at this resolution. The median name needed a 13.7-point ΔR² to flag 80% of the time; the book showed 0.67. 0 of 80 flags is a non-detection, not proof taste is absent — and the frozen held-out slice means no out-of-sample test ran at all.

**(b) "Isn't 0/80 just low power?"** Partly — and the desk prints the power. The held-out arm has zero power: all 35 scored weeks are frozen for every name, so it is not a low-power test, it is no test. The in-sample arm has 80% detection only at a 13.7-point ΔR². So 0/80 makes a very large effect unlikely, not a plausible small one.

**(c) "Why would I trust a Qloo-derived factor?"** Don't trust it as alpha; the desk doesn't ask you to. Trust the audit: every cultural beta traces to a cached Qloo request and window; 80 names share a pre-registered factor; three nulls are printed; 0 flags. The replay shows what re-estimation does — median |Δβ| 0.59 points, 0 flips — and is labelled a replay, not a live revision.

**(d) "What is the business?"** The honest business is a diligence and revision-audit tool for teams already buying Qloo, not a fund. A seat license; the buyer is a quant or risk team needing to know when a taste factor is stale and what re-estimating does. No revenue evidence; the $25k would fund the next test, not a proven product. At this vintage there is no alpha story.

**(e) "Why is this agentic rather than a notebook?"** Because the gate runs outside the model. Before the model runs, the server asks Qloo for freshness and stamps the result; if Qloo has revised, it re-estimates the affected name and prints committed vs re-estimated beta, t and ΔR² with a receipt. A notebook cannot refuse to answer, attest a revision, or show its spend. The model writes prose.

## 6. Three copy changes

All three are on the populated landing view (`#/`, `deskView()`), not the cold state.

**1. Headline — `desk/app.js:763`, `deskView()` → `.head h1`.**
Before: `We tested taste against 80 consumer stocks. None cleared the bar.`
After: `We tested taste against 80 consumer names. The test could see 13.7 points of R²; in sample the book added 0.67.`
Why: 13.656 is `output/mde.json → book.medianDeltaR2Pts`; 0.67 is `output/desk.json → valueAdd.meanDeltaR2 × 100`. Both are already printed in the data-basis paragraph and the strip. The current line answers "does it work?" before the reader reaches the resolution. Interpolate the payload fields; do not hardcode.

**2. Verdict line — `desk/app.js:762`, `deskView()` → `p.verdict-line[data-audit="verdict-line"]`.**
Before: `Taste adds 0.67 pts of R² in sample across 80 priced names, and 0 of 80 clear the flag rule. This is a null result, and the desk states it as one.`
After: `Taste adds 0.67 points of R² in sample across 80 priced names, and 0 of 80 clear the flag rule. The held-out slice is frozen at this Qloo vintage, so this is an in-sample non-detection, not a completed held-out test.`
Why: `output/desk.json → valueAdd.oos.scoring` has `testable: false`, `testWeeks: 35`, `frozenWeeks: 35`, `lastMove: "2025-12-22"`. The current sentence calls it a null result without saying the out-of-sample arm never ran. The replacement also fixes the current `0.67 pts of R²` unit collision.

**3. State strip — `desk/app.js:770`, `deskView()` → `section.strip[data-audit="desk-strip"] .stat:nth-child(3) span`.**
Before: `last Qloo revision`
After: `last taste-series move`
Why: the value 2025-12-22 is `output/mde.json → frozenSlice.lastMovingDate`, the last week the regressor moves. `output/revision-replay.json → caveat` says the pipeline's revision rule does not flag 2025-12-22 as a wholesale revision. "Revision" claims more than the date supports; "move" is the exact word.

## Sources

Numbers: `output/desk.json` (`valueAdd.meanDeltaR2`, `valueAdd.meanMarketR2`, `valueAdd.oos.scoring`), `output/mde.json` (`book.medianDeltaR2Pts`, `book.medianBetaMDE`, `frozenSlice`), `output/revision-replay.json` (`summary`, `movers`). No raw Qloo data is reproduced here.

**Honest ceiling:** at this vintage the entry is a rigorous 0-flag measurement plus a working revision audit — not an alpha product, and not yet evidence that anyone will pay for the audit.
