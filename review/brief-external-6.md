# External review 6 — Cultural Beta, after the grade-word change

Exercise abstract thinking. Do not skim this brief and return a summary of it: open the
material, check the claims, and review it as a submission a judge will score.

You are reviewing a Devpost entry for the Qloo Agentic Hackathon. Score it on the four
rubric axes (25 points each): Technological Implementation, Design, Potential Impact,
Quality of Idea. Then answer the specific questions at the end. Be cold and specific.

## What the product is

A consumer equity desk. For 101 US consumer names in 11 sub-sectors it reports a market
beta (weekly return on SPY) beside a cultural beta — the coefficient on a weekly taste
basket built from Qloo `/v2/trending`. Qloo is load-bearing: without live Qloo responses
the desk refuses to print, and there is no simulated Qloo data anywhere.

Surfaces: desk, taste map, evidence, per-name holding page, plain-English read page,
JSON/CSV API, alerts feed. Everything is computed by deterministic code (no model in the
statistical loop).

## The finding, as the product now states it

- 101 names in the book; **83 resolved** to a Qloo brand entity; **80 priced**; 3 have no
  complete price history; **18 unresolved** keep a row with a market-only beta, a null
  cultural column and the query that was tried.
- **0 flags**: no name carries a negative cultural beta that clears |t| ≥ 2 and a
  Benjamini–Hochberg q ≤ 0.10 across the book.
- In sample the basket adds **+0.67 pts** of r². Rotation null p **0.90**, week-order
  permutation p **0.78**, 6-week-block permutation p **0.83**.
- **The pre-registered held-out slice is empty on this vintage.** Qloo's
  `population_percentile` for every basket member last changes in the week ending
  **2025-12-22**; the window ends 2026-10-26; the final **44** of 102 weeks are a
  carry-forward; **all 35 scored weeks** lie inside it. The taste regressor is identically
  zero there, so the held-out condition has power equal to size at any effect.
- The desk therefore: labels the OOS cell **"no test"** (the −0.05 punctuation value is
  tagged as a perturbation), and grades the book **NO SIGNAL (IN-SAMPLE)** — a word that
  says the grade rests on the in-sample book and the nulls only. A separate state,
  **IN-SAMPLE ONLY**, exists if the in-sample association ever clears both nulls.
- A post-hoc split inside the revised region (58 informative weeks, 38 train / 20 test,
  9 moving test weeks) gives median **−0.49 pts**, positive on **38%**, mean −8.42
  (outlier-dominated, range −127.5 to +15.8). It is shipped as a labelled diagnostic with
  no interval and no grade.
- The peer-basket control (no Qloo data) is a **perturbation** on the same frozen slice;
  so is the sentiment control. The desk states that this rule is applied symmetrically.
- Dispersion test: variance 805, analytic mean-se² 1,869, rotation-null mean 1,352,
  p 0.21 upper / 0.79 lower; power at planted sd 1/5/10/25/50 is 0/0/0/0/100%; at the
  observed sd 28.4 it is 0%. Reading: **uninformative**.
- Qloo-vs-peer basket correlation averages 0.04 (−0.11 to +0.25); the taste basket moves
  in a mean 27 of 102 weeks, the peer basket every week.

## What changed since the last panel (round 5)

Round 5 was Nemotron FIX FIRST 53 and GLM PASS 61, both with fatal: none. Both named the
same defect: the grade word **NO SIGNAL** read as a capable test that had found nothing.
Changes made:

1. Grade now branches on `scoring.testable === false` **before** any OOS comparison and
   returns **NO SIGNAL (IN-SAMPLE)** / **IN-SAMPLE ONLY**. It no longer uses the frozen
   OOS interval for anything.
2. The OOS cell leads with **"no test"**; the perturbation value moved into the tag and
   the rule box.
3. The desk states that the three nulls share one calendar and one frozen tail, are not
   three independent tests, and should be read as one stringent check.
4. The desk states that rotation and shuffling preserve each basket's slow shape, so they
   exclude less about a genuinely weekly signal than the p-value alone suggests.
5. The symmetric frozen-arm rule is stated once and applied to taste, peer and sentiment.
6. Independent of the panel: 18 unresolved names that had been silently dropped now keep
   rows (market-only beta, withheld cultural column, query tried), so the book reads
   101 names / 80 priced rather than 83 rows.

Verification: `npm test` 63/63; CDP audit 344/344 across 5 routes × 3 viewports
(1440 / 768 / 390).

## What to review, concretely

Read `README.md` (especially the catalogue-revision, verdict-rule and null sections),
`review/REVIEW.md` §13–§15, and the desk copy embedded in `desk/app.js` — the strings a
judge actually sees are in `verdictOf`, `chips`, `rbCells`, `dispersionBand`,
`gradeSummaryCard`, `dataVintageCard` and the read page. Judge the copy, not the comments.

## Questions to answer

1. **The grade.** Is **NO SIGNAL (IN-SAMPLE)** now a defensible label for a book whose
   held-out slice is frozen? If not, what exact word or construction would be, and why?
2. **The roster change.** 101 rows with 21 carrying no cultural beta — does that read as
   integrity or as a broken table? Is "no Qloo entity" with the query tried enough, or
   does it invite the question "why did you fail to resolve 18 brands"?
3. **The diagnostic.** Kept, median-led, post-hoc, no interval, no grade. Does it still
   function as result-shopping in disguise? What one sentence would make it safe or
   should it go?
4. **Competitiveness.** Against the rubric, where does this lose the most points now, and
   what single change would recover the most?
5. **Fatal objections.** Is there anything that should disqualify the entry — simulated
   data, a trading claim, a concealed failure, a Qloo-terms breach in what the hosted desk
   exposes (computed betas and request URLs, never response bodies)?
6. **Overstatement.** Quote any sentence still on a product surface that claims more than
   the numbers support, and say what it should say instead.

## Output

Return JSON only:

```json
{
  "verdict": "PASS" | "FIX FIRST" | "REJECT",
  "score_total": 0-100,
  "scores": {"technological_implementation": 0-25, "design": 0-25, "potential_impact": 0-25, "quality_of_idea": 0-25},
  "fatal": "none" | "<the disqualifying issue>",
  "must_fix": ["..."],
  "method_objections": ["..."],
  "overstatements": ["..."],
  "grade_label_verdict": "yes/no + why, in one or two sentences",
  "roster_verdict": "yes/no + why",
  "cadence_diagnostic_verdict": "keep/change/cut + why",
  "best_next_model_construction": "...",
  "headline_rewrite": "one sentence you would put at the top of the submission",
  "judge_60s": "what a judge skimming for 60 seconds will most likely get wrong"
}
```
