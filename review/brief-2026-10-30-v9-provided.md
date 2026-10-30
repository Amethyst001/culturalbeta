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

The claim is narrow and falsifiable: a consumer stock's price risk has a component that comes from its customers' changing taste, and Qloo is the only clean instrument for that component — **and now the desk measures how much that instrument adds over the obvious alternative**. The desk measures exposure. It does not size, hedge, route, or advise, and says so on the page.

Window: **106 aligned weekly returns** (2024-10-14 → 2026-10-26), fixed before the key. Seven reference names — **ELF, NKE, LULU, CMG, SBUX, MCD, DIS** — are *featured*: they also carry an audience-level basket built from their own entity, shown next to the sector reading. The other 94 names are priced on their sub-sector basket.

## What changed since the last scored round (88 / 87 / 87 — mean 87.3)

The last round closed every finding from the round before it and converged, independently, on three new ones — and the two reviewers who looked at the estimator both named the same first item. This round is those three, plus the two fixes that fell out of doing them.

- **A refit-per-draw bootstrap, printed beside the fixed-coefficient one.** The interval the desk shipped last round held the fitted coefficients still and resampled only the scored test weeks, which measures sampling error in the test slice and nothing else. A referee can falsify that in one line by asking what happens when the fit is allowed to move. So every OOS number now carries **two** 90% intervals: the original 400-draw circular block bootstrap, and a second **200-draw** bootstrap that redraws the same 70/36 split *and refits the model inside each draw*, so coefficient-estimation error is in it. Both are printed under the primary window, the second window and the ablation gain, and the method sentence says which is which. A refit draw carries nothing from its training resample into an independent test resample, so that second interval centres near zero and contains the point estimate; where the two disagree, the wider one carries the claim. Per-name refit bounds ship as `oosDeltaR2Lo` / `oosDeltaR2Hi` on `/api/v1/panel` and in the CSV, and a seeded test pins the property on a constructed series: the split is held fixed, the refit interval is wider, and the result is reproducible.
- **The in-sample cell is out of the ablation band.** The band had three cells; the left one, *sector peers over market*, is an in-sample R², which cannot fall when a regressor is added and therefore sat next to a negative out-of-sample cell reading as free positive evidence. The band is now two cells — *Qloo taste over peers* (signed, with both intervals) and *names where taste adds* — and the peers' in-sample gain stays in the CSV where a reviewer can still check it. The sub-copy says why in one sentence.
- **The stub basket block no longer looks like a data bug.** Eight rows reading "Stub brand 0 … Stub movie 1", all at 12.6%, got screenshotted past their tag. On the stub harness the block now collapses to a single labelled state — "8 neighbours · equal weights on the stub · structure only", with the named-neighbour sentence underneath — and the real rows appear only on a keyed run. A new audit check fails the build if a "Stub …" row ever renders again.
- **"holds" became "positive".** The chip under the OOS point said *holds* whenever the mean was above zero, directly above a line reading "crosses zero". It now says *positive* / *negative*, which is what it actually measures; the significance language lives in the interval line and the book verdict.
- **The ablation cells are stacked, not squeezed.** With the in-sample cell gone, two cells in a half-width column wrapped prose to about thirty-five characters. They now run full width of the card.

Disclosure on the round that produced these scores: reviewer 3's slot failed over from the primary model to the fallback after a fetch error, so two of three lines are the same model family as earlier rounds and one is the fallback (Nemotron, 87 — identical to the primary line it replaced, 87). Its asks were the same three as the other two.

## The estimator, stated once

For every priced name: `return ~ SPY` and `return ~ SPY + taste basket`, fitted on the first 70 of 106 weeks and scored on the last 36. ΔR² is the difference in out-of-sample R², signed and never clamped. The ablation repeats it with a same-sector peer basket as a second regressor, so taste has to beat SPY *and* its own sector peers. The rotation placebo shifts every basket by the same circular offset for 400 seeded draws. The second window is the same code on the 106 weeks before the primary window, fixed in `config/book.json` before the key. Nothing is tuned on the returns; the seed, the floor, the split, the flag rule and the replication rule are all in the config.

## What the screenshots show

Seven attached: desktop desk, **the plain-English read page**, **the ablation band — two cells, both intervals, stub tag**, **the null-case branch card with both branches drawn**, desktop taste map, desktop holding (the stub basket block is now one labelled state, not eight fake rows), desktop evidence. (The phone desk was attached two rounds back and is unchanged apart from the derived state tag.)

Their numbers come from a **stub harness run through the real pipeline** — the layout is final, the magnitudes are not a Qloo result and are not presented as one. Score the *design's honesty under a weak result*. The attached desk renders the "does not replicate" branch with a negative ablation: verdict sentence first, then the replication chip, then a control band that says taste added nothing over peers, then the branch card that says what the entry is still worth. That is the harder case to design and the one a real keyed run may well produce.

## What is built and verified today

- **Zero-dependency Node 24.** No framework, no build step, no runtime packages. Plain HTTP server, hash-routed SPA, hand-written SVG. Every chart is drawn from the computed panel; with no data the app renders an explicit locked state rather than fake numbers.
- **Key server-side only.** Read by the official Qloo event harness from the inherited environment. Never an argument, a URL, a browser bundle entry, a repo file, a screenshot, or a saved artifact. `.env` is gitignored; `.env.example` is committed. Raw responses are cached under a gitignored `fixtures/qloo/`, because Qloo's terms forbid republishing their data.
- **Every Qloo call goes through the event harness** (`qloo exec` / `qloo api`) — entity resolution, a correlation id per call, an honest "which workflow did you run".
- **The harness's real schema is enforced locally.** `trends` 1–5 entities and ≤20 points per call; `recommend` 1–10 signals and ≤20 results. The series fetcher pages date windows at 18 points, infers cadence from the first response, and refuses rather than half-filling a series. The stub harness in the tests enforces the same caps.
- **Factor and estimation.** Weekly taste return = ln(fold-change in trending velocity), with a documented fallback. Basket = affinity-weighted taste returns of non-universe recommendations; weeks where a member has no data are re-weighted, never zero-filled. OLS of `stock return ~ SPY + basket`, Student-t two-sided p-values, BH q across all priced names, a 100-week sample floor that keeps the row and withholds the beta.
- **Five robustness checks, all deterministic.** (1) Out-of-sample ΔR², 70/36 split, never clamped. (2) Circular-rotation placebo, 400 seeded rotations of the whole book together. (3) The pre-registered disjoint second window. (4) **The ablation arm**: same-sector peers before taste, with the OOS peer-only vs peer+taste comparison — the control that says whether Qloo earns its place at all. (5) **Two bootstraps on every OOS number**: 400 fixed-coefficient draws and 200 refit draws, both 8-week circular blocks, both seeded from the config.
- **Products surface, same process.** `GET /api/v1/panel`, `GET /api/v1/holding/:ticker`, `GET /api/v1/alerts`, `GET /export/panel.csv`. A missing factor is a named 503 refusal, never a zero-filled beta.
- **Test evidence.** **32 unit tests** (`node --test`), including the ablation suite (planted taste over a real peer effect is recovered; peers alone leave no taste gain; the peer basket is equal-weight, self-excluding and null when alone) and the two bootstrap suites (a point estimate gets a positive standard error; the interval is ordered and seed-deterministic; every resampled index stays inside the test window; the refit draw holds the split fixed, is reproducible from its seed, and comes out wider on a constructed series). A dependency-free CDP audit runs **5 routes × 3 viewports** (1440 / 768 / 390): **239/239 checks**, including label-collision, tap-target, overflow, contrast, ablation-band shape, both-intervals-present and stub-row checks, with screenshots saved as evidence.
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
