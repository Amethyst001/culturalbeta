# Round 10 — hosted, attested, and bounded: re-score the entry as it now stands

You are reviewing a submission to the **Qloo Agentic Hackathon** ("Agents, but with taste", Devpost). Deadline: **31 Oct 2026, 04:45 GMT+1**. About six hours remain when this is written.

Do not be kind. A flattering score costs the team a prize. If the entry is not above 90/100, say exactly what is missing. **Exercise abstract thinking** — step back from the feature list and judge the thing as a whole: what is it, what is it for, is the category right, and does the agent do work the product cannot do without Qloo? Then review it concretely, as if you had to defend it to the Qloo CTO on the panel. Check every claim against what is stated as verified, and name where a claim is still over-stated. Actually review: read the evidence below, not the summary of it.

## What changed since round 9 (round 9 ceilings: 63/100 and 68/100, both FIX FIRST)

Round 9's decisive objection, from both reviewers independently: *"a single bounded live read per answer does not make Qloo load-bearing — the model can decline to call a tool, so a claim that the panel is current rests on committed files alone."* That is now closed by construction, not by prompting:

1. **The desk is hosted, with TLS, and this is verified from outside.** `https://culturalbeta.ktnamethyst.me` answers 200 on `/`, `/api/desk.json` (402 KB), `/api/v1/panel`, `/api/agent.json`, `/api/freshness.json`, `/api/v1/alerts`, `/export/panel.csv`; plain HTTP 301s to HTTPS. It runs as a systemd service on 127.0.0.1:8790 behind an additive nginx vhost on a host that serves three other sites — the other vhosts answered 200 immediately after the reload, and the vhost was added with `nginx -t` passing before any reload. One pre-existing outage was found on the host (an unrelated site's backend, refusing connections since 18:12, before this deploy) and was left alone.
2. **Every answer now carries a mandatory live Qloo attestation, and it is not a tool the model can skip.** `/api/ask` runs the check itself, concurrently with the model call, on every answer. It asks Qloo for the newest weeks for one entity drawn from the panel's own Disney basket (Youtube, brand, weight 0.1257) through the official harness, and prints what came back. Verified **from the deployed host**, not the laptop:
   `{"checked":true,"weeksPulled":20,"latestWeek":"2026-10-31","latestRevision":null,"verdict":"newer_weeks_no_change","requests":1,"pages":1,"fromCachedPage":false,"correlationIds":["exec-e76c92b3-0215-43a6-b4c0-699f2b284639"]}`
   — 9.6 s, one request, a correlation id the host received itself. The reading says Qloo now publishes weeks **past** the panel window end (2026-10-26) and that no value differs from the week before it in the twenty pulled. Scoped honestly: one reference entity, one page — an attestation that the feed is still frozen at book level, not a re-pull of every basket.
3. **Per-answer receipts.** Every answer returns the Qloo calls behind it — endpoint, entity ids, correlation id, timestamp, page count, and whether the page was live or replayed — with secrets redacted. A replay is labelled as a replay with the time it was fetched.
4. **A pre-registered effect-size bound, published.** The entry no longer says only "no test". To flag the book's own mean in-sample increment (ΔR² 0.67 pts) at 80% power under the pre-registered rule would need **~2,201 weeks, 42.3 years, 21.6× the window available**; the per-name median MDE is **13.7 ΔR² points against 0.67 observed**. The MDE is a design property — weeks, residual scale, basket variance and the multiplicity rule — and does not depend on any observed t. The desk states the effect size it could have detected, and states that the one it measured is below it.
5. **The basket-construction falsification is run and negative.** Three alternative constructions (top 3 / top 5 / top 10 pool members by affinity) plus the committed one, same estimator, same 102-week cut, same prices, **zero new Qloo requests**: **0 flag flips across all variants; no construction flags any name.** The null is stable to construction. But the betas themselves are not: median |Δβ| 11.1 against the committed basket, p90 66, and Spearman rank correlation **0.14–0.16** between constructions. The desk prints both halves — the flag is robust, the ranking is not — rather than only the convenient one.
6. **An answer-quality defect found on the deployed host and fixed.** A fallback model emitted `<think>…` scratchpad into the content with no closing tag, and the old closed-pair regex let it through: a judge would have seen the model's reasoning in front of its answer. Captured, fixed with a tolerant cleaner (`src/answer.mjs`), regression-tested against the verbatim captured string.
7. **The ask endpoint is now bounded and self-terminating.** The tool loop used to end in `NO_FINAL_ANSWER` when a model kept exploring; it now makes its last round with `tool_choice: "none"` and a one-line instruction to answer from the evidence already returned. A single stalled call is retried once on the same provider instead of falling through to a worse model, and the whole chain is capped at 100 s — below nginx's 180 s, so a slow answer refuses cleanly instead of becoming a 504. Measured on the deployed host: **50 s**, 3 rounds, 2 tools, a clean answer and a receipt.
8. **The first paint is no longer blank.** The page renders a frame and marks the active tab before the nine JSON reads land, then replaces it; the browser audit waits on the app's own ready signal instead of a fixed sleep, and loads each route as a real document so no route is graded against another route's leftover state.
9. **Verification:** 144/144 unit tests (was 92 at round 9). The browser audit is re-run against the public URL, not localhost: **547/554 checks (99%)**.

## What is unchanged and verified

- **Product:** a consumer-equity desk reporting, for each of **101 US consumer names**, a market beta and a **cultural beta** on a weekly taste basket built from Qloo's `population_percentile` trends for that sub-sector. Per-name OLS `ret ~ SPY + basket`, 102 aligned weeks (2024-10-14 → 2026-10-26), 67/35 split fixed before the keyed run. All Qloo access goes through the official `@qloo/qloo-harness` 0.1.26 CLI.
- **Result:** mean in-sample ΔR² **+0.67 points**, **0 of 80** names flagged at Benjamini–Hochberg q ≤ 0.10. Rotation placebo p 0.898, week permutation p 0.778, 6-week block permutation p 0.830, max-of-p rule. Dispersion power at the observed spread 0%, printed as uninformative rather than as a kill.
- **The held-out slice cannot test anything:** Qloo's last percentile revision is week ending **2025-12-22**; the final 44 of 102 weeks are carry-forward and all 35 scored weeks sit inside that tail, so the scored regressor is identically zero. The desk prints **"no test"**, not a negative. The new live attestation is the evidence that this is still true *today*, from a machine that is not the author's.
- **Runtime findings from the deploy:** the harness CLI refuses to run on the host's node 20 (`engines.node >=22.19.0`), so the service runs a private Node 22 in `/opt/node22` and the distro node the other sites pin is untouched; the hackathon credential authenticates **only** against `https://hackathon.api.qloo.com`, and a fresh host defaults to the public endpoint and returns `QLOO_AUTH` — the desk then reports the check as unavailable, not as a reading. Both are now in the installer, because both cost a deploy cycle.
- **Data handling:** no Qloo response data in the repository (`fixtures/qloo/`, `output/` ignored), key server-side only, MIT licence, `.env.example` documents the shape.

## Still open, not hidden

- **The repository is not public yet.** It is the lead pass/fail gate and needs the owner's explicit go-ahead; ~9 commits exist with no remote.
- **Answer latency is ~50 s, and that is the model, not the desk.** Measured on the deployed host 2026-10-30: a short completion takes 0.9 s, a 180-word answer 3–5 s, one tool round with the full prompt ~11 s, and the shared free inference pool stalls for 45 s or more under load. GLM 5.3 Flash is capped at one request per minute; the 120B vision model originally configured as primary returned no response in 30 s from two different networks. The asked-for target is a 5 s answer: that is not reachable through a three-round tool loop on these tiers, and the honest routes to it are streaming the answer (first token <1 s) or precomputing the suggested questions, neither of which is built yet. The desk page itself loads in 1.7 s.
- **Three audit checks still fail for one reason:** the 90-second bar the audit sets for the ask is shorter than the measured answer time, so the ask route times out under audit but answers in the browser. Judges will feel this as "it thinks for a while", not as a broken page.
- **Devpost text and screenshots** are the owner's; `submission/` is untouched.

## Your job

1. **Score it cold**, /25 on each of the four criteria and /100 total, as it stands. Say whether it makes the top three. Do not adjust for effort, and do not credit intent.
2. **Is the agentic clause now satisfied?** Specifically: a mandatory, model-independent, per-answer live Qloo read, with receipts and a correlation id from the deployed host — does that make Qloo load-bearing at inference, or is it a ritual that a statistics tool performs around a chatbot? If still not closed, give the smallest change that closes it.
3. **Does the effect-size bound change what the entry can claim?** An MDE 20× the observed effect, published before the panel sees it, and a null stable to basket construction — is that a result, a design failure, or both? Say what the entry may claim and what it must not.
4. **Rank the remaining work by score-points per hour**, given ~6 hours: public repo, latency, provider reliability, submission text, anything we have not listed.
5. **Is Impact capped by the null?** If no honest entry can claim a positive result at this Qloo vintage, state the highest honest score.
6. **Drop your own modifications:** at least three concrete changes the author has not proposed — product, framing, evidence, interface or demo. Say what you would **cut**.
7. **Where is the author wrong?** Name the strongest objection to this design, including to the attestation itself: one entity, one page, a fifteen-minute cache, a reading whose expected value is "nothing changed" — when does that become circular?

## Output

Return a single JSON object, no markdown fence, no commentary:

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
  "would_make_top3": false,
  "agentic_gap_closed": false,
  "agentic_verdict": "2-3 sentences",
  "attestation_verdict": "does the mandatory live read plus receipts change the entry's status, and how far",
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
