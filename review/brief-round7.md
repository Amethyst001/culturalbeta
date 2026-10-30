# Round 7 — full issue inventory and the path to 98

Exercise abstract thinking. Then actually review: score the product as it stands, list **every** defect you can substantiate, and be concrete. A list of one or two issues is a failed review this round.

## What this is

A consumer-equity desk built for the Qloo Agentic Hackathon. For each US consumer name in 11 sub-sectors it prints two numbers: a market beta (weekly return on SPY) and a cultural beta (coefficient on a weekly taste basket built from Qloo's trending endpoint), around a pre-registered falsification attempt. Surfaces: desk, taste map, evidence, per-name holding page, plain-English read page, JSON/CSV API, alerts feed.

Judging: four axes at 25 points each — Technological Implementation, Design, Potential Impact, Quality of Idea. The Qloo CTO is on the panel.

## State you are reviewing

- 101 names in the book, 80 priced on the cultural factor, 3 without complete price history, 18 that resolved to no Qloo brand entity. The unresolved keep their row with the market half measured and the cultural column withheld.
- The 102-week window was cut to remove four Qloo catalogue-revision weeks.
- **Qloo's `population_percentile` last changes in the week ending 2025-12-22, so the final 44 weeks are carry-forward and all 35 scored weeks of the pre-registered 67/35 split are frozen.** The held-out cell is labelled "no test"; the grade is "NO SIGNAL (IN-SAMPLE)" or "IN-SAMPLE ONLY"; the desk landing carries a "Data basis" band stating this.
- A post-hoc cadence diagnostic (58 informative weeks, 38/20 split) exists and is labelled as a diagnostic that cannot move the grade.
- Nulls: rotation p 0.898, week permutation 0.778, 6-week block 0.830 — one max-of-p rule.
- Dispersion test reports no detectable excess spread with power 0% at the observed spread; wording now states the consequence (the book cannot detect a taste exposure of any practical size).
- Verification: 63/63 unit tests; a CDP UI audit across 5 routes × 3 viewports.
- Not yet: a public URL, a recorded demo, a Devpost submission.

## What I want back

1. **A complete issue inventory.** Number every issue, give each a severity (P0 = blocks a serious judge / invalidates a claim; P1 = costs points on an axis; P2 = craft), the evidence (screen, sentence, number), and the exact fix. Do not stop at three. If a category has ten issues, list ten. Include things that are merely weak rather than wrong.
2. **Score the four axes out of 25 each** as the entry stands, with the total.
3. **The path to 98**: for each axis, the specific changes that move the score, in the order that buys the most points per unit of work. Say plainly if 98 is not reachable and what the ceiling is instead — do not flatter the entry.
4. **What to cut.** The desk is dense and has accumulated caveats. Name anything that should be deleted rather than improved, and why a judge is better off without it.
5. **The one thing a Qloo CTO would ask that the product cannot answer today.** Answer it as a product gap, not a statistic.

Judge the entry as a submission, not as a research paper: a judge spends a few minutes, sees a URL and a recording, then decides. Weigh the first 15 seconds accordingly.
