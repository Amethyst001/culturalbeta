# Round 8 — transform review: what is this, and what should it become?

You are reviewing a submission to the **Qloo Agentic Hackathon** ("Agents, but with taste", Devpost). Deadline: **31 Oct 2026, 04:45 GMT+1**. Roughly 11 hours remain at the time of writing.

Do not be kind. A flattering score costs the team a prize. If the entry is not above 90/100, say exactly what is missing. **Exercise abstract thinking** — step back from the feature list and judge the thing as a whole: what is it, what is it for, and is the category right? Then review it concretely. Do not review the prose alone; review the system described below as if you had to defend it to the Qloo CTO on the panel.

## The judging frame

- Theme: "Agents, but with taste." The brief says: *"Build an agentic tool, an agent-powered app, or wire Qloo into an agent that already exists."* And: *"If your submission would work the same without Qloo, you're building the wrong thing."*
- Four criteria, equally weighted: **Technological Implementation, Design, Potential Impact, Quality of the Idea.**
- Hard requirements: a functional demo link; a public code repo with all source, assets and instructions; a text description of what it does and why it is Qloo-powered; **external hosting / fully published**; an **open-source license visible in the repo's About section**. (Demo videos are not required.)

## What exists, verified

**The product.** A consumer-equity research desk. For each of **101 US consumer names across 11 sub-sectors**, it reports two numbers: a **market beta** (weekly return on SPY) and a **cultural beta** — the coefficient on a weekly taste basket built from Qloo's trending endpoint for that name's sub-sector.

- **Estimator:** per-name OLS `ret ~ SPY + sector basket`; 102 aligned weeks (2024-10-14 → 2026-10-26); 67/35 train/test split fixed in config before the keyed run.
- **Baskets:** one per sub-sector, built by `qloo exec recommend` signalled by up to ten resolved entities of that sector; every name in the book is excluded by id and normalised name; member weights are Qloo's own affinity ranks. All Qloo calls go through the official `@qloo/qloo-harness` CLI. 83 of 101 names resolved to a Qloo entity; 80 priced; 3 lack a complete price history; 18 unresolved names carry no beta rather than a guessed one.
- **Falsification:** 400-draw rotation placebo (p 0.898), week permutation (p 0.778), 6-week block permutation (p 0.830); a max-of-p rule. Dispersion test: cross-sectional variance 805 vs analytic noise 1,869 vs rotation-null mean 1,352; power at the observed spread is **0%**, so non-detection is printed as uninformative, not as a kill.
- **The result:** mean in-sample ΔR² = **+0.67 points**; **0 of 80** names flagged after Benjamini–Hochberg q ≤ 0.10. **No held-out claim:** Qloo's last `population_percentile` revision is the week ending **2025-12-22**; the final **44 of 102** weeks are carry-forward, and **all 35 scored weeks** sit inside that tail. The scored regressor is identically zero, so the held-out test has no power at any effect size. The desk prints "no test" rather than a near-zero as a negative.
- **Cost:** 3,065 Qloo requests spent against a planned 3,624 (121 searches, 72 basket calls, 2,872 trend requests, 358 cached pages).
- **Verification:** 63 unit tests before this round; the new agent adds 12 (suite run pending at brief time). A Chrome DevTools audit checks five routes at three viewports; 353/353 checks pass. Screenshots committed.
- **Repo:** MIT `LICENSE`, README with method and instructions, `.env.example`, no Qloo response data committed (`fixtures/qloo/` and `output/` are ignored). The key is server-side only.
- **Not yet done:** external hosting (Oracle VM provisioned, vhost + TLS not installed); repo not yet public; two hard gates therefore unmet.

## What was just added: the analyst agent

The honest problem with the entry as it stood: it is a **deterministic statistical instrument**. It satisfies "would not work without Qloo" completely, but it does not satisfy the literal agentic clause — no planner, no tool selection, no model anywhere in the loop.

The addition is a **read-only analyst agent** at `#/ask`:

- **Tools (7), all read-only over the committed panel:** `desk_summary`, `search_book`, `get_holding`, `get_basket`, `get_taste_series`, `get_nulls`, `get_provenance`.
- **Loop:** the model plans, calls tools, receives results, and answers; max 8 tool calls / 5 rounds; 400-character question cap; 120 questions/hour global; 2-second per-IP gap; answers cached by question and panel revision.
- **No Qloo spend and no write path:** a question cannot run the pipeline or call Qloo. It reads `output/desk.json`, `output/series.json` and each row's Qloo provenance. The tool trace is shown in the UI, so every claim is inspectable.
- **Provider chain:** any OpenAI-compatible endpoint with tool calling, configured from environment only (no provider or key in the repo); tried in order. The primary has been returning HTTP 429 on its free tier, so the live demo currently answers on fallback 1.
- **System prompt** forbids advice, fabricated numbers, substituting a similar ticker, and calling a per-name p "significant" without its BH q.
- **Latency:** 45 seconds for a three-round answer on fallback 1. That is a real UX problem for a judge clicking cold.

**Real transcript** (fallback 1, 2 tool calls, 3 rounds, verified against the panel):

> Disney is not flagged because the desk's held-out slice is frozen at this Qloo vintage (last revision 2025-12-22), so the flag rule cannot complete for any name, including Disney. Separately, Disney does not meet the flag rule itself: it requires a negative cultural beta with |t| at least 2 and a Benjamini-Hochberg q at or below 0.10 across priced names. Disney's cultural beta is positive (43.81, t = 3.17) and its q is 0.164, above the 0.10 threshold, so it does not survive the book-wide correction. Book-wide, zero names are flagged, and the held-out test… [answer truncated by the model's token limit]

An earlier run of the same question said the beta was "significant" while omitting q = 0.164. That is exactly the failure mode the prompt now forbids; it is disclosed here because a reviewer should know the agent can overclaim when under-instructed.

## The author's proposed transform (critique this, do not merely approve it)

The desk is the **evidence**; the agent is the **interface**. A judge should not read four pages to understand one name. They should ask, and the agent should answer with the exact numbers, the exact Qloo request, and the uncertainty — and refuse when the data cannot support an answer.

Beyond that, the proposed direction is to make the agent **load-bearing, not explanatory**:

1. **Sector briefing agent:** given a sub-sector, it plans across the panel, builds the one-page exposure memo from the actual rows, and cites each claim to a row and a Qloo response.
2. **Live Qloo tool (optional, capped):** let the agent resolve one off-book entity and fetch its trend series through the official harness, under a hard per-session request cap — so the agent is genuinely choosing Qloo calls at inference, not only reading precomputed output.
3. **Alert triage agent:** when the panel changes, it reads the alert feed, explains why each name did or did not fire, and drafts the watchlist note.

## Your job

1. **Score it cold**, /25 on each criterion and /100 total, as it stands with the agent layer. State whether it would make the top three. Do not adjust for effort.
2. **Is the agentic clause now satisfied?** Does the Q&A layer close the gap, or does the entry still read as a statistics tool with a chatbot attached? If the latter, give the **smallest** change that makes the agent load-bearing rather than explanatory.
3. **Drop your own modifications.** At least three concrete changes you would make that the author has not proposed — product, framing, evidence, interface, or demo. Say what you would **cut**.
4. **Rank the remaining work by score-points per hour**, given ~11 hours and the two unmet hard gates (hosting, public repo). What is the order of operations?
5. **Is Impact capped by the null?** If the dataset's frozen tail means no honest entry can claim a positive result at this vintage, what is the highest honest score, and what should the entry claim instead?
6. **Where is the author wrong?** Name the strongest objection to the design above, including the agent layer.

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
  "fatal": "the one thing that would sink it, or null",
  "must_fix": ["specific, ordered"],
  "method_objections": ["statistical or methodological objections"],
  "overstatements": ["claims the entry makes that the evidence does not support"],
  "own_modifications": ["at least three changes you would make that are not in the brief"],
  "cut": ["what to remove"],
  "score_per_hour_rank": ["ordered work items"],
  "path_to_90": ["what would have to be true for an honest 90+"],
  "highest_honest_score_this_vintage": 0,
  "judge_60s": "what a judge understands in the first minute",
  "headline_rewrite": "one sentence",
  "best_next_model_construction": "the single most valuable build"
}
```
