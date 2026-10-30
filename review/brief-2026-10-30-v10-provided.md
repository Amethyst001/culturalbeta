# Cultural Beta — score the prize-day entry, with every provision in place

You are a judge on the **Qloo Agentic Hackathon** (Devpost, closes 31 Oct 2026). Do not be kind. A flattering review costs the team a prize.

**Exercise abstract thinking.** Before scoring, reason about the entry at the level of its abstract claim, not only its screens: what exactly is being measured, what would falsify it, whether the instrument, the estimator and the control actually establish what the entry says they establish, and what the product is worth if the answer comes back negative. Then review it — a real critical review of the substance and the execution, not a summary of this brief — and answer every numbered request at the end.

## The premise you must accept

**This team can and will supply anything you name.** The Qloo key is pending today, not missing by design; hosting, a recorded demo, a live URL, additional data pulls, an advisor — if you say the entry needs it, assume it is delivered before the deadline.

So: **score the entry as it will exist on prize day, with every provision you name in place.** Do not deduct for something being unbuilt, unproven, pending, or absent from the screenshots. Deduct only for what a provision *cannot fix*:

- **Rules and terms.** Qloo's terms forbid republishing their response data in a public repo. Fabricated or simulated Qloo data is disqualifying. A maths claim that does not follow from the estimator stays wrong no matter who provides the key.
- **Outcome risk.** The real data may produce small effects, wide intervals, weak replication, or zero flagged names. A provision cannot buy a positive result. Judge whether the product is still worth something in that case.
- **Scope the team has deliberately refused.** One factor, no advice, no trading, no portfolio construction. If you think the scope is wrong, say so and score it — but do not pretend the refusal is an oversight.

## What it is

A **consumer equity desk that reports two kinds of beta side by side** for a book of **101 US consumer names across 11 sub-sectors**.

- **Market beta** — what every terminal already gives you: a holding's sensitivity to the S&P 500.
- **Cultural beta** — a holding's sensitivity to a *taste factor* built from Qloo's cultural graph: a weekly basket of the brands and titles that the holding's sub-sector audience is trending toward.

The claim is narrow and falsifiable: a consumer stock's price risk has a component that comes from its customers' changing taste, Qloo is the only clean instrument for that component, and the desk measures how much that instrument adds over the obvious alternative. The desk measures exposure. It does not size, hedge, route, or advise, and says so on the page.

Window: **106 aligned weekly returns** (2024-10-14 → 2026-10-26), fixed before the key, plus a pre-registered **second 106-week window** (2022-10-03 → 2024-10-14). Seven reference names — **ELF, NKE, LULU, CMG, SBUX, MCD, DIS** — are *featured*: they also carry an audience-level basket built from their own entity, shown next to the sector reading. The other 94 names are priced on their sub-sector basket.

## What changed since the last scored round (87 / 87 / 86 — mean 86.7)

That round was the cleanest read yet: all three reviewers saw all seven screenshots and agreed on the same three criticisms, and none of them was about layout. This round is those three, plus the three that fell out of them.

- **The Read page now states what would falsify the desk, in results.** Three named outcomes — *no flag survives the book*, *taste adds nothing over the sector with both intervals crossing zero*, *the pre-registered window does not replicate* — each with the live verdict that would print. The page says the verdicts are generated from the numbers by the code, not typed by hand.
- **The claim is bounded to the book, in the page's own words.** With 36 held-out weeks, one name's ΔR² is coarse; the page now says the desk does not claim point-estimate precision at the name level, and that the claim it does make is a book-level one: average add, share of names, and replication.
- **The negative case is priced honestly.** The Read page says plainly that a negative run yields a pre-registered falsification memo, names the buyer (a factor researcher or buy-side quant testing a culture-channel hypothesis) and the cost (a Qloo subscription plus the desk's compute), and says there is no mass-market buyer rather than implying one. The branch card no longer calls the peer model "itself the usable product": that arm is only read in-sample, so what survives is the committed-price panel plus the negative-result evidence.
- **The peer control is stated as Qloo-free, on the page.** One reviewer read the peer basket as itself Qloo-derived; it is not — it is the equal-weight weekly return of the other names in the sub-sector, from committed prices, with no Qloo data. Both the ablation band and the Evidence desk now say so, and also say the honest consequence: the two regressors are correlated by construction, so a null cell means the sector average carries the channel, not that taste is unpriced.
- **The interval identity is printed at the number, not in the footer.** Every OOS cell — primary window, second window, ablation — now carries a line naming *which* interval carries the claim (the wider of the two). A holding page carries both per-name intervals and the same line; before this round it carried one point estimate. Per-name bounds ship as four CSV/API columns: `oosDeltaR2FixedLo/Hi` and `oosDeltaR2RefitLo/Hi`.
- **The second window is labelled as a different regime.** The header now reads *second window · pre-registered · different regime* with its dates, and the verdict sentence says explicitly that this is not an identical-conditions check: replicating across regimes is the stronger claim and a miss can be a regime difference. The placebo copy likewise says the rotation preserves cross-name alignment, so the null keeps the book's correlation structure — a test against a rotation of the factor, not against random baskets.
- **The ablation cells carry a plain-English reading.** Above the numbers, the band says it in words: the taste basket earns its place over a no-cost sector exposure on N% of names; on the other M% the sector alone carries the signal.

## The estimator, stated once

For every priced name: `return ~ SPY` and `return ~ SPY + taste basket`, fitted on the first 70 of 106 weeks and scored on the last 36. ΔR² is the difference in out-of-sample R², signed and never clamped. The ablation repeats it with a same-sector peer basket — **price-only, no Qloo data** — as a second regressor, so taste has to beat SPY *and* its own sector peers. The rotation placebo shifts every basket by the same circular offset for 400 seeded draws. The second window is the same code on the 106 weeks before the primary window, fixed in `config/book.json` before the key. Nothing is tuned on the returns; the seed, the floor, the split, the flag rule and the replication rule are all in the config.

## What the screenshots show

Seven attached: desktop desk, the plain-English read page (**now with the falsification section and the bounded claim**), the ablation band (two cells, both intervals, the wider-interval rule at the number), the null-case branch card, desktop taste map, desktop holding (**now with both per-name intervals**), desktop evidence (the Qloo requests and the Qloo-free peer statement).

Their numbers come from a **stub harness run through the real pipeline** — the layout is final, the magnitudes are not a Qloo result and are not presented as one. Score the *design's honesty under a weak result*: the stub panel reads a negative ablation and does not replicate on the second window.

## What is built and verified today

- **Zero-dependency Node 24.** No framework, no build step, no runtime packages. Plain HTTP server, hash-routed SPA, hand-written SVG. Every chart is drawn from the computed panel; with no data the app renders an explicit locked state rather than fake numbers.
- **Key server-side only.** Read by the official Qloo event harness from the inherited environment. Never an argument, a URL, a browser bundle entry, a repo file, a screenshot, or a saved artifact. `.env` is gitignored; `.env.example` is committed. Raw responses are cached under a gitignored `fixtures/qloo/`, because Qloo's terms forbid republishing their data.
- **Every Qloo call goes through the event harness** (`qloo exec` / `qloo api`) — entity resolution, a correlation id per call, an honest "which workflow did you run".
- **The harness's real schema is enforced locally.** `trends` 1–5 entities and ≤20 points per call; `recommend` 1–10 signals and ≤20 results. The series fetcher pages date windows at 18 points, infers cadence from the first response, and refuses rather than half-filling a series. The stub harness in the tests enforces the same caps.
- **Factor and estimation.** Weekly taste return = ln(fold-change in trending velocity), with a documented fallback. Basket = affinity-weighted taste returns of non-universe recommendations; weeks where a member has no data are re-weighted, never zero-filled. OLS of `stock return ~ SPY + basket`, Student-t two-sided p-values, BH q across all priced names, a 100-week sample floor that keeps the row and withholds the beta.
- **Five robustness checks, all deterministic.** (1) Out-of-sample ΔR², 70/36 split, never clamped. (2) Circular-rotation placebo, 400 seeded rotations of the whole book together. (3) The pre-registered disjoint second window. (4) The ablation arm: same-sector price-only peers before taste, with the OOS peer-only vs peer+taste comparison. (5) Two bootstraps on every OOS number: 400 fixed-coefficient draws and 200 refit draws, both 8-week circular blocks, both seeded from the config, and per-name as well as book-level.
- **Product surface, same process.** `GET /api/v1/panel`, `GET /api/v1/holding/:ticker`, `GET /api/v1/alerts`, `GET /export/panel.csv`. A missing factor is a named 503 refusal, never a zero-filled beta.
- **Test evidence.** **33 unit tests** (`node --test`), including the ablation suite, the two bootstrap suites, and a per-name fixed-interval suite (one interval per name, seed-deterministic, narrower than the refit one on a constructed series). A dependency-free CDP audit runs **5 routes × 3 viewports** (1440 / 768 / 390): **260/260 checks**, including the falsification section, the two per-name intervals, the wider-interval rule, the Qloo-free peer statement and the regime label, with screenshots saved as evidence.
- **Cold state is designed, not broken.** With no key the desk explains what the first keyed run produces, which numbers are withheld, and names the robustness work.

## Still to deliver on prize day — assume delivered

1. **Hosted live demo.** A public URL serving a precomputed, cached keyed panel, with a visible "RECOMPUTE FROM QLOO" action that runs the real harness end to end under a timeout, plus a 90-second recording of a real run resolving.
2. **The keyed run itself.** 101 resolved entity ids, the real sector baskets, 212 weeks of real taste series, the real betas, the real BH-corrected flags, the real replication verdict — **and the real ablation number**.
3. Anything else you name in your provision list that is buildable before 31 Oct.

## What I want back

1. **Four criterion scores**, each out of 25, using the hackathon rubric, then a total out of 100. Exact format:

```
Technological Implementation: NN/25 — one sentence of justification
Design: NN/25 — one sentence of justification
Potential Impact: NN/25 — one sentence of justification
Quality of Idea: NN/25 — one sentence of justification
TOTAL: NN/100
```

2. **The provision list.** Everything you require this team to actually supply for your score to be true — real data pulls, endpoints, artifacts, evidence — one line each, with the evidence you would accept and whether it is buildable before 31 Oct. Be specific: name the API surface, the file, the screen.
3. **The gap to 95.** State your score, then the exact delta: what would have to be true for each criterion to reach 23–25, and which of those things a provision *cannot* buy.
4. **The product angle.** Is there a product attached to this measurement — an API, a report, an alert, an integration, a buyer who would pay — that multiplies its value without breaking the constraints? Name it concretely, or say plainly there is none. If your answer is the feed already built, say what would make it worth paying for rather than merely available.
5. **The single highest-leverage change** for the remaining time, with the points it would add.
6. **Two more fixes**, ranked, each with points.
7. **One thing to cut**, if anything is bloated.
8. **A verdict**: competitive for a top prize, credible mid-pack, or weak? Say which, plainly.
