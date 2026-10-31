# Round 12 — the gate became the estimator

You are reviewing a submission to the **Qloo Agentic Hackathon** ("Agents, but with taste", Devpost). Deadline: **31 Oct 2026, 04:45 GMT+1**.

**Scope.** The repository is public at <https://github.com/Amethyst001/culturalbeta>, the homepage is the live desk at <https://culturalbeta.ktnamethyst.me>. The Devpost description, the screenshots and the video are the owner's and are not part of what you judge. **Do not spend a single point on packaging, repository visibility or submission text** — assume all of it is complete and correct. Score the product, the method, and whether Qloo is load-bearing at inference.

Do not be kind. A flattering score costs the team a prize. **Exercise abstract thinking** — step back and judge the thing as a whole: what is it, what is it for, is the category right, and would the answer differ if Qloo were removed. Then review it concretely, as if you had to defend it to the Qloo CTO on the panel. Check each claim against what is stated as verified, and name every place a claim is still over-stated. Actually review: read the evidence below, not the summary of it.

## Round 11's verdicts, and the one sentence they repeated

Round 11 returned **81 / 79 / 78 / 77** (Opus 5.5, Fable 5.1, GLM 5.3 Flash, Opus 5), all FIX FIRST. All four made the same objection in different words:

> flipping a status label is still witness-level, not inference-level dependency — the gate proved the feed had moved and then served the committed betas anyway.

Round 12 is the answer to that sentence.

### 1. On `moved`, the estimator re-runs inside the answer

When the freshness attestation reports a Qloo revision newer than the panel tail, the server no longer stops at a warning. It re-runs the live estimator for up to two affected names and prints **committed vs re-estimated cultural beta, t and ΔR² side by side**, in a block the server authors from the served pipeline — not prose the model narrated. The block rides on the answer payload itself under `reestimation`, so the change appears where the claim is made. The `moved` path has now **fired on real data**: the probe found two basket entities revised 2025-12-15, and Disney re-estimated **52.77 → 43.81** (t unchanged at 3.17, ΔR² unchanged at 0.0673 — the whole move lands in the coefficient, the right shape when regressors change and returns do not).

### 2. The revision replay — the desk as it stood before the revision

`GET /api/revision-replay.json`, `POST /api/ask {"replay":"2025-12-01"}` and a `?replay=1` desk toggle (banner: **"Replay · not a live revision"**) serve the pipeline re-run at the 2025-12-01 vintage — 55 aligned weeks, ending one revision before the tail — against the committed 102-week panel. Same estimator, same basket construction, BH recomputed per vintage. Integrity-checked against the committed outputs; a drift breaks the file instead of rewriting the story. Headline, stated small: DIS **52.775 → 43.809**, median |Δβ| **0.589**, **0 flag flips**, 80 priced names in each vintage; tail p90 |Δβ| 6.74, max 160.3 (PARA — a thin-basket extrapolation). **47 pages replayed from real cached Qloo responses, 0 new Qloo requests.** No simulated data anywhere: the replay is the committed estimator run on real cached levels, labelled as a replay in all three surfaces.

### 3. The null was red-teamed, and the red-team is published

An adversarial pass (`review/NULL-REDTEAM.md`) attacked the 0/80 flag count. Verdict: **BOUNDED NULL; the 0/80 is real, and one earlier OOS presentation was an artifact** — the per-name held-out numbers scored a frozen (zero-variance) test basket, i.e. a training-fit perturbation, not a test. The fix is landed: per-row `oosTestable` gates every JSON/CSV/desk surface; frozen rows print **"no test"**, never a number. The red-team also established, and the README now states: the flag rule tests a one-sided negative hypothesis while BH runs on two-sided p-values (conservative for negative names; changes no flag at q ≤ 0.10); the null is conditional on the 80/101 Qloo-resolvable population; the MDE uses the two-sided quantile. Gate decomposition published: 36 of 80 fail the sign, 43 of 44 negative names fail |t| ≥ 2, KDP (the strongest negative) fails q at 0.351, DIS (strongest overall, positive) fails the sign rule at q 0.164. The pre-registered second window is untestable (58/106 weeks covered; nothing clears the 100-week floor).

### 4. The bound is the headline, not a footnote

The landing copy now states the resolution, not just the flag count: the design detects a ΔR² of **13.7 points** at 80% power; the book's in-sample increment is **0.67 points** — about 20× smaller. The verdict line says the held-out slice is frozen, so this is an **in-sample non-detection, not a completed held-out test**. A dated re-test commitment is published: first Qloo vintage that moves `population_percentile` after 2025-12-22 inside the fixed window → re-run within 10 business days; if none, publish "still frozen" on 2027-01-31 (`review/IMPACT-PITCH.md` §4).

### 5. Design pass

Every one of the 101 names carries its company logo in the book and on its reading page (fetched once by script, monogram fallback), alongside the earlier pass: searchable book (`/` focus), sortable/sticky tables, sector chips, flip band, gate legend, copy buttons on every stamp and correlation id, receipts on every answer.

## What is unchanged and verified

- **Product:** a consumer-equity desk reporting, for each of **101 US consumer names**, a market beta and a **cultural beta** on a weekly taste basket built from Qloo's `population_percentile` trends for that sub-sector. Per-name OLS `ret ~ SPY + basket`, 102 aligned weeks (2024-10-14 → 2026-10-26), 67/35 split fixed before the keyed run. All Qloo access goes through the official `@qloo/qloo-harness` 0.1.26 CLI.
- **Result:** mean in-sample ΔR² **+0.67 points**, **0 of 80** names flagged at Benjamini–Hochberg q ≤ 0.10. Rotation placebo p 0.898, week permutation p 0.778, 6-week block permutation p 0.830. Median MDE **13.66 ΔR² points = 20.3× the observed effect**; detecting the observed effect at 80% power needs ~2,201 weeks.
- **Held-out slice: no test**, printed as such — Qloo's last taste-series move is week ending **2025-12-22**; the final 44 weeks are carry-forward and all 35 scored weeks have an identically-zero regressor for every name.
- **Per-answer attestation:** `/api/ask` runs the freshness check itself, outside the tool loop, on up to three entities (the names the question cites, else one per sub-sector), stamps the result `att-<12 hex>` (SHA-256 over the visible fields) above the answer, cached 15 minutes per entity set. States: `pass`, `moved`, `unattested` — `moved` now triggers re-estimation (§1).
- **Receipts** on every answer: endpoint, entity ids, correlation ids, page counts, live vs replayed, gate state, spend. Agent fleet with 429 backoff; answers bounded; reasoning scratchpads stripped (including the untagged three-newline variant observed live from MiniMax).
- **Data handling:** no Qloo response data in the repository, key server-side only, MIT licence, `.env.example` documents the shape.

## Verification

- `npm test` **174/174** (was 162 at round 11) — replay determinism, integrity checker, re-estimation gating, oos gating, logo fallback among the additions.
- Browser audit (Chrome DevTools Protocol, 3 viewports × 8 routes incl. replay ask): **641/641, 0 fail** on this build (2026-10-31T00:34). Deployed-host verification: replay ask 6.9 s, gate `moved`, re-estimation in the answer, **0 new Qloo requests**.
- Two defects fixed to make the replay deterministic: the frozen probe clock also froze cache expiry; the probe read only the basket's flat reference member instead of the three highest-weight members; replayed pages no longer rewrite their records (that race cost 15–35 s/page and hit the 45 s timeout).

## Still open, not hidden

- **The hold-out is still frozen at this Qloo vintage.** Only a Qloo pull whose percentiles move inside the scored window can change that; the desk commits to that re-test with a date (§4) instead of implying it has run. A non-degenerate hold-out remains the single change that would move the impact ceiling, and it was not affordable before the deadline.
- The replay's pre-revision vintage is 55 weeks against 102, so committed-vs-re-estimated pairs mix the revision with sample length; the answer addendum says so in its own text.
- The MDE is a two-sided-quantile bound for a one-sided rule (conservative; stated, not corrected).
- Rank fragility stands: median |Δβ| 11.1 across basket constructions even though the flag count does not move.

## What to score

Four criteria, **25 points each**, with a one-line justification per criterion, then a total that is the arithmetic sum of the four (a criterion above 25 or a total that does not sum is rejected by the rubric):

1. **Technological Implementation** — how skillfully Qloo is used; whether the code reflects real, non-trivial effort.
2. **Design** — a complete, coherent product rather than a proof of concept.
3. **Potential Impact** — a credible case for solving a real problem for a real audience, demonstrated in practice.
4. **Quality of the Idea** — creative, non-obvious use of Qloo; genuine understanding of the problem space.

Then: (a) the **fatal flaw** — the one thing most likely to sink this with the judges; (b) the **full list** of what remains, ranked; (c) whether the estimator-gate + replay (§1–§2) closes round 11's "witness-level, not inference-level" objection or only relocates it — argue your answer.
