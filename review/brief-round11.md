# Round 11 — the attestation now gates the answer

You are reviewing a submission to the **Qloo Agentic Hackathon** ("Agents, but with taste", Devpost). Deadline: **31 Oct 2026, 04:45 GMT+1**.

**Scope.** The repository is public at <https://github.com/Amethyst001/culturalbeta>, the homepage is the live desk at <https://culturalbeta.ktnamethyst.me>. The Devpost description, the screenshots and the video are the owner's and are not part of what you judge. **Do not spend a single point on packaging, repository visibility or submission text** — assume all of it is complete and correct. Score the product, the method, and whether Qloo is load-bearing at inference.

Do not be kind. A flattering score costs the team a prize. **Exercise abstract thinking** — step back and judge the thing as a whole: what is it, what is it for, is the category right, and would the answer differ if Qloo were removed. Then review it concretely, as if you had to defend it to the Qloo CTO on the panel. Check each claim against what is stated as verified, and name every place a claim is still over-stated. Actually review: read the evidence below, not the summary of it.

## Round 10's verdicts, and what they demanded

Round 10 returned **74/100** (Claude Opus 5; its file said 78 but one criterion was scored 29/25 — the rubric-correct total is 74) and **67/100** (GLM 5.3 Flash), both FIX FIRST. They agreed on one sentence:

> the attestation is a witness, not an input — "the model's output would be identical if Qloo returned a change tomorrow" (GLM); "the attestation proves freshness, not that inference depends on Qloo" (Opus).

Two changes follow, and they are what this round is about.

### 1. The attestation now gates the answer, and the gate is visible

Every answer carries one of three states, computed on the server after the check returns (`attestationGate()` in `src/live-qloo.mjs`):

- **`moved`** — any attested entity reports a Qloo revision after the panel's last revision. The answer is given a warning **above its first paragraph**, naming the entities and the revision date, and stating that the numbers below predate it and that the held-out slice frozen at that date no longer matches the feed.
- **`unattested`** — the check could not run (gate off, no key, budget spent, timeout). Printed in the same place, in the same size, so a failed check cannot be read as a pass.
- **`pass`** — states what was read, when, and what it found.

Each carries a **stamp**: `att-` plus 12 hex characters, a SHA-256 over exactly the fields a reader can see in the receipt (checked, why, verdict, newest week, each entity's id/week/verdict, the correlation ids). The same stamp appears in the answer payload, above the answer text, and inside the freshness receipt — so a reader can recompute it and see that the line above the answer and the receipt are the same claim. 5 new tests cover the stamp and all three states.

What this does **not** do, stated plainly: it makes a detected revision change the answer's status; it does not make Qloo an inference *input*. The betas still come from the committed panel. Judge whether "a check that can flip the answer's status" closes your objection or only moves it.

### 2. "What would flip this verdict" — four conditions, published

A band on the evidence page, added because both reviewers asked for the null to be falsifiable rather than terminal:

1. **A Qloo revision after 2025-12-22** — checked automatically on every answer; the desk flips to `moved` the moment one entity reports a newer revision.
2. **A taste effect at least as large as the design can detect** — 13.66 ΔR² points against the 0.67 measured (20.3×); at the measured effect the same rule needs 2,201 weeks (42.3 years).
3. **A ranking that survives the basket it was built from** — β moves a median 11.1 points across the four constructions (p90 66.4, rank ρ 0.16); a flag would have to survive all four.
4. **A flag that survives the book-wide correction** — 0 of 80 at BH q ≤ 0.10; a single-name |t| of 3.32 is needed before correction to be a discovery at this book size.

Each row prints today's value, what it would take, and who checks it.

## What is unchanged and verified

- **Product:** a consumer-equity desk reporting, for each of **101 US consumer names**, a market beta and a **cultural beta** on a weekly taste basket built from Qloo's `population_percentile` trends for that sub-sector. Per-name OLS `ret ~ SPY + basket`, 102 aligned weeks (2024-10-14 → 2026-10-26), 67/35 split fixed before the keyed run. All Qloo access goes through the official `@qloo/qloo-harness` 0.1.26 CLI.
- **Result:** mean in-sample ΔR² **+0.67 points**, **0 of 80** names flagged at Benjamini–Hochberg q ≤ 0.10. Rotation placebo p 0.898, week permutation p 0.778, 6-week block permutation p 0.830, max-of-p rule. Dispersion power at the observed spread 0%, printed as uninformative rather than as a kill.
- **The held-out slice cannot test anything:** Qloo's last percentile revision is week ending **2025-12-22**; the final 44 of 102 weeks are carry-forward and all 35 scored weeks sit inside that tail, so the scored regressor is identically zero. The desk prints **"no test"**, not a negative.
- **Per-answer attestation:** `/api/ask` runs it itself, outside the tool loop, concurrently with the model call, on **up to three entities** — the basket entities of the names the question cites when it cites any, otherwise one reference name per sub-sector, so the claim does not rest on a single basket. Verified from the deployed host in both shapes; a question about the book returns `checked:true`, `entities:3` across media/beauty/apparel at 10.7 s cold, replayed from the 15-minute per-entity-set cache afterwards.
- **Receipts:** every answer returns the Qloo calls behind it — endpoint, entity ids, correlation id, timestamps, page count, live vs replayed, and now the gate state and stamp — with secrets redacted.
- **Basket-construction falsification, run and negative:** three alternative constructions plus the committed one, same estimator, same cut, same prices, zero new Qloo requests: **0 flag flips**; but β moves a median 11.1 points (p90 66.4, Spearman 0.14–0.16). The desk prints both halves.
- **Answer quality:** GPT-OSS 120B via Groq (3.4 s), MiniMax M2.7 behind it; `rank_holdings` makes widest/narrowest questions deterministic (always Paramount, β −242.5, SE 379). 8.1 s cold, 0.95 s cached, 50 s bounded worst case.
- **Runtime fixes from the deploy:** private Node 22 in `/opt/node22` because the harness refuses node 20; the hackathon credential authenticates only against `https://hackathon.api.qloo.com`, and the desk reports `QLOO_AUTH` as an unavailable check rather than a reading.
- **Data handling:** no Qloo response data in the repository, key server-side only, MIT licence, `.env.example` documents the shape.

## Verification

- `npm test` **160/160** (was 151). New coverage: the gate's three states, the stamp's determinism and non-collision, and the rubric check below.
- Browser audit against the public URL: **566/566 across 3 viewports × 7 routes**, including two new checks — the gate is present, carries a stamp, sits above the answer, and cannot read `pass` when the freshness payload says the check failed.
- **Two defects in the review and audit harnesses, found and fixed this round.** (a) The round-10 Opus review scored Quality of the Idea **29/25**; a total that "balances" only because of it is now flagged by `src/rubric.mjs`, the brief forbids it, and every criterion must now carry a written justification. (b) The new gate check initially selected the attestation paragraph as "the answer", so "is the gate above the answer" printed false while the check passed.

## Still open, not hidden

- **The gate has never fired in the `moved` state**, because Qloo has not revised since 2025-12-22. It is tested against fixtures and shown live in `pass` and `unattested`; the `moved` path is unexercised in production and the desk says so.
- **The effect-size bound and the construction sensitivity are post-hoc diagnostics**, computed from the same window they criticise.
- **Answer latency:** 8 s cold, 0.95 s cached; the 50 s bounded case is the real worst case a judge may hit under load.
- **Devpost text and screenshots** are the owner's; `submission/` is untouched.

## Your job

1. **Score it cold**, /25 on each of the four criteria and /100 total, as it stands. Say whether it makes the top three. Do not adjust for effort, and do not credit intent.
2. **Is the agentic clause closed now?** A server-side check that runs on every answer, cannot be skipped by the model, is cached per entity set, carries a recomputable stamp, and changes the answer's status when it detects a revision — is that Qloo doing work the product cannot do without it, or is it still a guardrail around a statistics package? If still open, give the smallest change that closes it, in hours.
3. **Is the "what would flip this" band enough?** It names four conditions and today's value against each. Does that convert the null from an endpoint into a pre-registered experiment with a stated ending, or is it decoration?
4. **Rank the remaining work by score-points per hour**, given ~4 hours and this scope: no repository visibility, Devpost text or screenshots. What product, method or evidence work would move this score the most?
5. **Is Impact capped by the null?** If no honest entry can claim a positive result at this Qloo vintage, state the highest honest score and the one thing that would raise it.
6. **Where is the author wrong?** Name the strongest objection, including to the gate: a hash over a reading whose expected value is "nothing changed", a `moved` state that has never fired, three entities out of 101. When does that become circular?
7. **One sentence for the Devpost page**: if a judge read only the first line of the description, what should it say?

## Output

Return a single JSON object, no markdown fence, no commentary.

**Every criterion is scored out of 25. A number above 25 is rejected by the harness**, and so is a `score_total` that is not the exact sum of the four. If you believe a criterion deserves more than 25, that is a statement about the other criteria — write it in `criterion_notes` and lower the other three; do not raise the cap.

```json
{
  "verdict": "SHIP | FIX FIRST | REJECT",
  "score_total": 0,
  "scores": {
    "technological_implementation": 0,
    "design": 0,
    "potential_impact": 0,
    "quality_of_idea": 0
  },
  "criterion_notes": {
    "technological_implementation": "why this number and not 5 higher or 5 lower — the single fact that sets it",
    "design": "same",
    "potential_impact": "same",
    "quality_of_idea": "same — if this is your lowest score, say what a higher-scoring version of the idea would be, in one sentence"
  },
  "raise_each_by_five": {
    "technological_implementation": "the change that would add ~5 points, or 'not reachable this cycle' with the reason",
    "design": "same",
    "potential_impact": "same",
    "quality_of_idea": "same"
  },
  "would_make_top3": false,
  "agentic_gap_closed": false,
  "agentic_verdict": "2-3 sentences",
  "attestation_verdict": "does the mandatory gated read change the entry's status, and how far",
  "impact_ceiling": "the highest honest score at this vintage, with the reason",
  "fatal": "the one thing that would sink it, or null",
  "must_fix": ["specific, ordered, with the score points each is worth"],
  "method_objections": ["statistical or methodological objections"],
  "overstatements": ["claims the entry makes that the evidence does not support"],
  "own_modifications": ["at least three changes not in this brief"],
  "cut": ["what you would remove"],
  "one_line": "if a judge read only one sentence, what should the entry say"
}
```
