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

## What changed since the last scored round (87 / 90 / 90 — mean 89.0)

The last round was unanimous on one defect, and it was a real one: the **"lower bound" framing was wrong**. Controlling for a peer basket does not bound a causal total in either direction; it isolates the layer of taste the sector does not already price. That sentence is gone from the desk, the read page and the README, replaced by a statement of the estimand. The same round asked for the power limit to be stated, for the stub-magnitude tag to reach the two picture-like cards, for the two branches to look co-equal, and for the raw-data boundary to be pinned in the shipped surface. All five are in.

- **An ablation arm — the control experiment.** For every priced name the desk now fits a **same-sector peer basket** first: the equal-weight weekly return of the *other* names in that sub-sector, computed from committed prices, with no Qloo input at all. Then it adds the taste basket and reports what taste adds on top. Because a nested in-sample R² can never fall when you add a regressor, the number that matters is **out-of-sample**: a 70/36 split on the same window, peer-only forecast against peer+taste forecast, printed as a signed number of points of OOS R² **and the share of names where taste adds anything**. The evidence page carries it as a three-cell band: *sector peers over market* (in-sample), *Qloo taste over peers* (signed, good or bad), *names where taste adds* (share of priced). On the attached stub run this prints **−0.31 points on 52% of names** — a loss — which is the point: the desk is built to print the negative result as readily as the positive one. The control is deliberately narrow, because peers carry the same taste exposure: the number is the layer of taste the sector does not already price, which is the estimand — not a bound on a causal total. Individual peer ΔR² and the OOS taste gain ship on `/api/v1/panel` and in the CSV, so a reviewer can re-run the comparison themselves.
- **The framing is corrected, not reworded.** The ablation number is described as what it is: the **non-overlapping layer** — the share of taste a vendor-free peer basket cannot explain. The desk now says explicitly that reading it as a lower bound on a causal total would be an error in either direction, and why: over-controlling absorbs part of the channel, under-controlling gives taste credit for sector co-movement.
- **The power limit is stated where the number is.** The robustness band says that 36 test weeks is a short window, that a zero-crossing interval is the expected result at this length, and that no provision can buy power — only a longer window can. A judge is not left to infer it from the width of the interval.
- **The null branch is co-equal, not a footnote.** Both branches of the null-case card are boxed the same size; only the marker and tint distinguish the one this run lands in, so neither reads as the designed-for case.
- **The stub tag reaches the picture-like cards.** The ablation band and the taste map carry "stub harness · magnitudes are layout only" at the card title, in the same accent colour as the state tag, so a screenshot of the layout exercise cannot be read as a Qloo result even out of context.
- **The data boundary is pinned in the product.** The evidence page states it: raw Qloo responses stay in the local cache, and the hosted surface serves derived numbers only — what the terms allow, and an unfiltered republish is not.
- **Every headline number now carries a 90% interval.** The desk re-draws the out-of-sample test weeks **400 times in 8-week circular blocks** — consecutive weeks stay together so autocorrelation survives the resample — re-scores the same fixed coefficients on each draw, and reports the spread of the book mean. The interval is printed under the OOS ΔR² on both windows **and** under the ablation gain, and where it crosses zero the page says "crosses zero" in as many words. On the attached run the primary interval is ±0.47 pts around +0.34 (crosses zero), the second window ±0.50 around +0.14, and the taste-over-peers gain ±0.32 around −0.31. Same 400 draws when the panel is keyed; the seed lives in the config like every other draw.
- **The null case is designed, not apologised for.** A card on the evidence page states both branches *before* the keyed run — what the desk sells if taste adds over peers, and what it is worth if it does not (a pre-registered negative a research desk can cite, a sector-peer exposure model that needs no vendor, and an alerts feed where every suppressed name shows its reason). Whichever branch the numbers land in is marked "where this run lands".
- **The desk opens on the strongest evidence.** Default order is now by Benjamini–Hochberg q, so the first rows a judge sees are the names that survived their own correction — not the noisiest beta in the book. The signal column is the sort control, and the verdict chips explain the *current* grade instead of glossing a branch the panel is not in.
- **The taste map is now an instrument, not a picture.** Hovering a dot names the tickers inside it, clicking (or pressing Enter on) a dot opens that sub-sector on the desk with the filter applied, a hairline leader ties every label to its own dot, and a legend states what the dot colour and size mean. The labels are still measured against each other after painting.
- **The state tag is derived, not hardcoded.** A panel run computed by the stub harness renders "STUB HARNESS · LAYOUT ONLY" in the accent colour; only a panel computed from real cached Qloo responses can read "LIVE QLOO". This answers the one unanimous finding of the 85.3 panel.
- **A plain-English page** — `#/read`, ~430 words, linked from the desk's verdict line and the footer. It now includes the fourth question, *does Qloo add anything the sector already shows?*, plus **how sure the numbers are** (the interval) and **what the desk is worth if the answer is no**.
- **Alerts carry a plain-English line.** Every entry in `/api/v1/alerts` ships a `plain` sentence — a firing name reads "Home Depot carries a measured taste headwind (cultural beta -0.87): … and that held out of sample on this name", and a suppressed name states its reason in prose.
- **The book is 101 names / 11 sub-sectors** — beauty & personal care, apparel & footwear, restaurants & coffee, media & entertainment, grocery & mass retail, home & housing, beverages & tobacco, packaged food & household, specialty & auto retail, travel & leisure, autos & mobility.
- **Baskets are per sub-sector, not per name**, so the factor is comparable across every name in a sector and the Qloo budget stays flat: 101 searches, 44 sector recommends (11 × 4 creative types), 28 audience recommends (7 × 4), ~372 paged trends calls — **under 600 calls for 101 names**, against ~3,600 for per-name baskets. Every name in the universe is excluded from every basket by entity id and normalised name.
- **Multiplicity is handled.** 101 names on one factor is 101 |t| tests; at |t| ≥ 2 about five flag by chance. The flag now needs cultural beta < 0 **and** |t| ≥ 2 **and** Benjamini–Hochberg q ≤ 0.10 across the priced book. The q is printed on every row and in the CSV.
- **A pre-registered disjoint second window.** The same estimator, sample floor, 400 draws and seed re-run unchanged on the 106 weekly returns immediately before the primary window. The slice and the replication rule (OOS ΔR² > 0 and placebo p ≤ 0.10) are fixed in `config/book.json` before any keyed run. Names without prior prices are dropped from the cohort, not allowed to cancel the replication; the exclusion count is printed and shipped. The desk verdict is HOLDS / MARGINAL / FAILS from the primary result **and** whether it replicates.
- **An alerts feed** — `GET /api/v1/alerts` returns firing names plus every suppressed name with its reason, so "no alert" is inspectable.
- **CSV export**: `/export/panel.csv` with sector, q, both windows' betas, peer ΔR² and the OOS taste gain.
- **Mobile fixed properly**: the evidence view reflows to cards, signal/trace lines align, tap targets clear 28px.

## What the screenshots show

Seven attached: desktop desk, **the plain-English read page**, **the ablation band with its interval and stub tag**, **the null-case branch card with both branches drawn**, desktop taste map, desktop holding, desktop evidence. (The phone desk was attached two rounds back and is unchanged apart from the derived state tag.)

Their numbers come from a **stub harness run through the real pipeline** — the layout is final, the magnitudes are not a Qloo result and are not presented as one. Score the *design's honesty under a weak result*. The attached desk renders the "does not replicate" branch with a negative ablation: verdict sentence first, then the replication chip, then a control band that says taste added nothing over peers, then the branch card that says what the entry is still worth. That is the harder case to design and the one a real keyed run may well produce.

## What is built and verified today

- **Zero-dependency Node 24.** No framework, no build step, no runtime packages. Plain HTTP server, hash-routed SPA, hand-written SVG. Every chart is drawn from the computed panel; with no data the app renders an explicit locked state rather than fake numbers.
- **Key server-side only.** Read by the official Qloo event harness from the inherited environment. Never an argument, a URL, a browser bundle entry, a repo file, a screenshot, or a saved artifact. `.env` is gitignored; `.env.example` is committed. Raw responses are cached under a gitignored `fixtures/qloo/`, because Qloo's terms forbid republishing their data.
- **Every Qloo call goes through the event harness** (`qloo exec` / `qloo api`) — entity resolution, a correlation id per call, an honest "which workflow did you run".
- **The harness's real schema is enforced locally.** `trends` 1–5 entities and ≤20 points per call; `recommend` 1–10 signals and ≤20 results. The series fetcher pages date windows at 18 points, infers cadence from the first response, and refuses rather than half-filling a series. The stub harness in the tests enforces the same caps.
- **Factor and estimation.** Weekly taste return = ln(fold-change in trending velocity), with a documented fallback. Basket = affinity-weighted taste returns of non-universe recommendations; weeks where a member has no data are re-weighted, never zero-filled. OLS of `stock return ~ SPY + basket`, Student-t two-sided p-values, BH q across all priced names, a 100-week sample floor that keeps the row and withholds the beta.
- **Four robustness tests, all deterministic.** (1) Out-of-sample ΔR², 70/36 split, never clamped. (2) Circular-rotation placebo, 400 seeded rotations of the whole book together. (3) The pre-registered disjoint second window. (4) **The ablation arm**: same-sector peers before taste, with the OOS peer-only vs peer+taste comparison — the control that says whether Qloo earns its place at all.
- **Products surface, same process.** `GET /api/v1/panel`, `GET /api/v1/holding/:ticker`, `GET /api/v1/alerts`, `GET /export/panel.csv`. A missing factor is a named 503 refusal, never a zero-filled beta.
- **Test evidence.** **31 unit tests** (`node --test`), including the ablation suite (planted taste over a real peer effect is recovered; peers alone leave no taste gain; the peer basket is equal-weight, self-excluding and null when alone) and the bootstrap suite (a point estimate gets a positive standard error, the interval is ordered and seed-deterministic, and every resampled index stays inside the test window). A dependency-free CDP audit runs **5 routes × 3 viewports** (1440 / 768 / 390): **230/230 checks**, including label-collision, tap-target, overflow, contrast and ablation-band checks, with screenshots saved as evidence.
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
