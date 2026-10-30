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

## What changed since the last scored round (91 / 86 / — mean 88.5 on two usable slots)

That round split: one reviewer scored 91 — the highest single slot in the chain — the other 86; the third slot answered with a short meta reply about the rubric and no score, so it is excluded rather than interpreted. Both scoring reviewers asked for the same class of thing: the second null, the second window and the documentation of what is already computed. This round ships those.

- **The ablation now carries its own rotation null.** Last round the 400 circular rotations were scored only against SPY: a p that says "the taste series is aligned with returns at all". The ablation's claim is taste *over sector peers*, so the same 400 shifts are now also scored against the peer models, and that second p prints under the ablation cell (`ablation.oos.placebo.p`, and `ablationPlaceboP` per name). The distinction is stated in the page's own words: a basket can be aligned and still not additive, because the sector average already reflects the taste its audience shares. On the stub panel the two answers differ exactly that way — alignment p 0.06, additive cell −0.31 pts — and the page says which is which instead of letting one number stand for the other.
- **The ablation runs on the pre-registered second window, and prints there.** The peer control is now fitted and scored on both windows, and the band carries a line with the second-window number, its 90% interval and its share of names. A control that holds on one window and not the other is visible rather than summarised away.
- **A fourth falsifier on the Read page.** *The peer control wins in both windows* — if taste loses to peers on the primary and the pre-registered window, the claim that Qloo is the only clean instrument is not established; the sector average is. The page lists four results that would falsify the desk, each with the printed verdict that would appear, generated from the numbers by the code.
- **One machine-readable interval rule.** The page names the wider interval under each number; the API now also says it in a field — `oosClaimInterval: "fixed coefficients" | "refit per draw"` — on every priced row, alongside the four bounds (`oosDeltaR2FixedLo/Hi`, `oosDeltaR2RefitLo/Hi`) and `ablationPlaceboP` in the CSV.
- **The Qloo cost of the taste arm is stated against zero for the control.** Up to 11 sub-sectors × 4 creative types × one recommend call, plus one trends page per basket member; the peer arm costs no Qloo calls at all.
- **The audience reading is tagged in-sample**, at the sentence, so it is not read as a second out-of-sample result.

## The estimator, stated once

For every priced name: `return ~ SPY` and `return ~ SPY + taste basket`, fitted on the first 70 of 106 weeks and scored on the last 36. ΔR² is the difference in out-of-sample R², signed and never clamped. The ablation repeats it with a same-sector peer basket — **price-only, no Qloo data** — as a second regressor, so taste has to beat SPY *and* its own sector peers. Two rotation nulls, both 400 seeded draws with every basket shifted by the same circular offset: one against SPY, one against the peer models. Two bootstraps on every OOS number: 400 fixed-coefficient draws and 200 refit draws, 8-week circular blocks. The second window is the same code on the 106 weeks before the primary window, fixed in `config/book.json` before the key. Nothing is tuned on the returns; the seed, the floor, the split, the flag rule and the replication rule are all in the config.

## What the screenshots show

Seven attached: desktop desk, the plain-English read page (four falsifiers, the two-nulls paragraph, the bounded claim, the negative-case valuation), the ablation band (**two cells, both intervals, the wider-interval rule, the rotation null for the arm, the second-window ablation line, stub tag**), the null-case branch card, desktop taste map, desktop holding (both per-name intervals), desktop evidence (the Qloo requests, the call-count comparison, the Qloo-free peer statement).

Their numbers come from a **stub harness run through the real pipeline** — the layout is final, the magnitudes are not a Qloo result and are not presented as one. Score the *design's honesty under a weak result*: the stub panel reads a negative ablation, an alignment p of 0.06 and no replication on the second window, and the page is written to survive exactly that.

## What is built and verified today

- **Zero-dependency Node 24.** No framework, no build step, no runtime packages. Plain HTTP server, hash-routed SPA, hand-written SVG. Every chart is drawn from the computed panel; with no data the app renders an explicit locked state rather than fake numbers.
- **Key server-side only.** Read by the official Qloo event harness from the inherited environment. Never an argument, a URL, a browser bundle entry, a repo file, a screenshot, or a saved artifact. `.env` is gitignored; `.env.example` is committed. Raw responses are cached under a gitignored `fixtures/qloo/`, because Qloo's terms forbid republishing their data.
- **Every Qloo call goes through the event harness** (`qloo exec` / `qloo api`) — entity resolution, a correlation id per call, an honest "which workflow did you run".
- **The harness's real schema is enforced locally.** `trends` 1–5 entities and ≤20 points per call; `recommend` 1–10 signals and ≤20 results. The series fetcher pages date windows at 18 points, infers cadence from the first response, and refuses rather than half-filling a series. The stub harness in the tests enforces the same caps.
- **Factor and estimation.** Weekly taste return = ln(fold-change in trending velocity), with a documented fallback. Basket = affinity-weighted taste returns of non-universe recommendations; weeks where a member has no data are re-weighted, never zero-filled. OLS of `stock return ~ SPY + basket`, Student-t two-sided p-values, BH q across all priced names, a 100-week sample floor that keeps the row and withholds the beta.
- **Six robustness checks, all deterministic.** (1) Out-of-sample ΔR², 70/36 split, never clamped. (2) Circular-rotation placebo against SPY, 400 seeded rotations of the whole book together. (3) The pre-registered disjoint second window. (4) The ablation arm: same-sector price-only peers before taste, OOS peer-only vs peer+taste, on both windows. (5) The ablation's own rotation null. (6) Two bootstraps on every OOS number: 400 fixed-coefficient draws and 200 refit draws, 8-week blocks, book-level and per-name.
- **Product surface, same process.** `GET /api/v1/panel`, `GET /api/v1/holding/:ticker`, `GET /api/v1/alerts`, `GET /export/panel.csv`. A missing factor is a named 503 refusal, never a zero-filled beta.
- **Test evidence.** **36 unit tests** (`node --test`), including both bootstrap suites, the per-name fixed-interval suite, and three for the ablation placebo (a planted taste factor beats rotation; an unrelated basket is calibrated under the null across worlds; the statistic is seeded, ordered and equal to the ablation's own point estimate). A dependency-free CDP audit runs **5 routes × 3 viewports** (1440 / 768 / 390): **266/266 checks**, with screenshots saved as evidence.
- **Cold state is designed, not broken.** With no key the desk explains what the first keyed run produces, which numbers are withheld, and names the robustness work.

## Still to deliver on prize day — assume delivered

1. **Hosted live demo.** A public URL serving a precomputed, cached keyed panel, with a visible "RECOMPUTE FROM QLOO" action that runs the real harness end to end under a timeout, plus a 90-second recording of a real run resolving.
2. **The keyed run itself.** 101 resolved entity ids, the real sector baskets, 212 weeks of real taste series, the real betas, the real BH-corrected flags, the real replication verdict, **the real ablation number and both rotation p-values**.
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
