# Round 9 — the live-Qloo agent now exists: re-score, and say what is still missing

You are reviewing a submission to the **Qloo Agentic Hackathon** ("Agents, but with taste", Devpost). Deadline: **31 Oct 2026, 04:45 GMT+1**. Roughly 10 hours remain at the time of writing.

Do not be kind. A flattering score costs the team a prize. If the entry is not above 90/100, say exactly what is missing. **Exercise abstract thinking** — step back from the feature list and judge the thing as a whole: what is it, what is it for, is the category right, and does the agent do work the product cannot do without it? Then review it concretely. Review the system described below as if you had to defend it to the Qloo CTO on the panel. Check every claim against what is stated as verified, and say where you think a claim is still over-stated.

## What changed since round 8 (round 8: Nemotron 38/100 FIX FIRST, GLM 74/100 FIX FIRST)

Both of you, independently, named the same decisive construction: **a live Qloo tool that resolves an off-book name and re-runs the estimator at inference, so Qloo is load-bearing inside the agent and not only inside the precomputed panel.** That is now built, tested and verified against the real hackathon endpoint. Everything below is what changed; the rest of the entry is as round 8 described it.

1. **Two live tools, added to the seven committed ones.**
   - `live_brand_trends(name)` — resolves a brand through `qloo api search`, then pulls its weekly trend series, and reports the entity id/type, latest percentile, change over the span, the last-13-week log return, and whether any catalogue revision jump is inside the series. Verified: "How is Gymshark trending on Qloo right now?" → 2 Qloo requests, ~24 s, entity resolved, 20 weekly points, latest percentile 0.89, and the answer states plainly that Gymshark is not in the book.
   - `live_cultural_beta(ticker)` — re-pulls the priced name's whole sub-sector basket through the harness and **re-runs the desk's own estimator at inference**, reporting market beta (partial and market-only), cultural beta with se/t/p, r² and ΔR². Verified on Disney: a fresh 47-page pull reproduced the committed row **exactly** — β 43.81, t 3.17, p 0.0021, r² 0.3356, ΔR² 0.0673. A replay from the page cache costs 8.9 s and zero requests; the cold pull is ~6.5 minutes.
   - A narrower window was the first attempt and is wrong: movie/TV entities only return from 2025-04 at a short `start_date`, which silently re-weights the basket and moves Disney to 42.12. The tool pulls at pipeline depth for that reason.
2. **Spending is bounded and journaled.** One live tool call per answer, a hard per-answer cap, a 96-page ceiling per re-run, a 120-request/day budget with reserve-then-refund-to-actual accounting persisted to disk, and a gate that keeps the live tools invisible unless the deployment explicitly enables them (`AGENT_LIVE_QLOO=1`). No write path anywhere: the agent cannot run the pipeline or move a committed number.
3. **Latency and the provider.** The primary now answers real asks: the same round-8 question came back in **24.5 s, 3 rounds, 2 tool calls, quoting β 43.81, q 0.164 and the frozen held-out slice correctly.** A single `retry-after` backoff before falling through fixed the round-8 failure mode (HTTP 429 on the free tier). Round 8's 45 s was measured on a rate-limited fallback.
4. **Verification.** 92/92 unit tests (14 new for the live path: budget accounting, input validation, caps, alignment, regression equivalence, both tools against an injected fake harness). Browser audit 401/401 across five routes and three viewports (1440/768/390 px).
5. **Still not done, and we are not hiding it:** the repo is not public; the site is not hosted (Oracle VM provisioned, vhost and TLS not installed). Both are pass/fail gates and are the next work, in that order. Also open: pre-registered minimum-detectable-effect bounds are not yet published; each answer does not yet print an exact Qloo receipt (endpoint, entity ids, correlation id, timestamp) although the cached responses carry correlation ids; and the basket-composition sensitivity check a reviewer asked for (5 vs 10 seeds) has not been run.

## What is unchanged, verified

- **Product:** a consumer-equity desk reporting, for each of **101 US consumer names**, a market beta and a **cultural beta** on a weekly taste basket built from Qloo's `population_percentile` trends for that sub-sector. Per-name OLS `ret ~ SPY + basket`, 102 aligned weeks (2024-10-14 → 2026-10-26), 67/35 split fixed before the keyed run. All Qloo access goes through the official `@qloo/qloo-harness` 0.1.26 CLI.
- **Result:** mean in-sample ΔR² **+0.67 points**, **0 of 80** names flagged at Benjamini–Hochberg q ≤ 0.10. Rotation placebo p 0.898, week permutation p 0.778, 6-week block permutation p 0.830, max-of-p rule. Dispersion power at the observed spread is 0%, printed as uninformative rather than as a kill.
- **The held-out slice cannot test anything:** Qloo's last percentile revision is week ending **2025-12-22**; the final 44 of 102 weeks are carry-forward and **all 35 scored weeks sit inside that tail**, so the scored regressor is identically zero. The desk prints **"no test"**, not a negative.
- **Cost:** 3,065 Qloo requests spent against 3,624 planned for the panel; the live path adds the small per-answer counts above.
- **Data handling:** no Qloo response data in the repository (`fixtures/qloo/`, `output/` ignored), key server-side only, MIT licence, `.env.example` documents the shape.

## Your job

1. **Score it cold**, /25 on each of the four criteria and /100 total, as it stands **with** the live agent. Say whether it makes the top three. Do not adjust for effort, and do not credit intent.
2. **Is the agentic clause now satisfied?** Judge specifically: does one bounded live read per answer make Qloo load-bearing at inference, or is this still a statistics tool with a chatbot that occasionally calls an API? If it is still not closed, give the smallest change that closes it.
3. **Does the live re-run change what the entry can claim?** A single name reproducing exactly is a reproducibility demonstration, not out-of-sample evidence. Say what you would accept as proof, and what the entry should claim instead.
4. **Rank the remaining work by score-points per hour**, given ~10 hours and the two unmet hard gates. Be specific about the order: public repo, TLS hosting, latency, receipts, effect-size bounds, basket sensitivity, and anything you think we have not listed.
5. **Is Impact capped by the null?** If no honest entry can claim a positive result at this Qloo vintage, state the highest honest score and what the entry should claim instead.
6. **Drop your own modifications:** at least three concrete changes the author has not proposed — product, framing, evidence, interface or demo. Say what you would **cut**.
7. **Where is the author wrong?** Name the strongest objection to this design, including to the live tool itself (e.g. cost exposure, a tool that can be steered by a brand name, reproducibility confused with validation).

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
  "live_tool_verdict": "does the live read change the entry's status, and how far",
  "fatal": "the one thing that would sink it, or null",
  "must_fix": ["specific, ordered"],
  "method_objections": ["statistical or methodological objections"],
  "overstatements": ["claims the entry makes that the evidence does not support"],
  "own_modifications": ["at least three changes not in this brief"],
  "cut": ["what to remove"],
  "score_per_hour_rank": ["ordered work items"],
  "path_to_90": ["what would have to be true for an honest 90+"],
  "highest_honest_score_this_vintage": 0,
  "judge_60s": "what a judge understands in the first minute",
  "headline_rewrite": "one sentence",
  "best_next_model_construction": "the single most valuable build"
}
```
