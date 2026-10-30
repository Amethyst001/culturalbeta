# Cultural Beta — score the prize-day entry, with every provision in place

You are a judge on the **Qloo Agentic Hackathon** (Devpost, closes 31 Oct 2026). Do not be kind. A flattering review costs the team a prize.

## The premise you must accept

**This team can and will supply anything you name.** The Qloo key is pending today, not missing by design; hosting, a recorded demo, a live URL, additional data pulls, an advisor, an export endpoint — if you say the entry needs it, assume it is delivered before the deadline.

So: **score the entry as it will exist on prize day, with every provision you name in place.** Do not deduct for something being unbuilt, unproven, pending, or absent from the screenshots. Deduct only for what a provision *cannot fix*:

- **Rules and terms.** Qloo's terms forbid republishing their response data in a public repo. Fabricated or simulated Qloo data is disqualifying. A maths claim that does not follow from the estimator stays wrong no matter who provides the key.
- **Outcome risk.** The real data may produce small effects, wide intervals, or zero flagged names. A provision cannot buy a positive result. Judge whether the product is still worth something in that case.
- **Scope the team has deliberately refused.** Exactly seven holdings, one factor, no advice, no trading. If you think the scope is wrong, say so and score it — but do not pretend the refusal is an oversight.

## What it is

A **consumer equity desk that reports two kinds of beta side by side**.

- **Market beta** — what every terminal already gives you: a holding's sensitivity to the S&P 500.
- **Cultural beta** — a new number: a holding's sensitivity to a *taste factor* built from Qloo's cultural graph, where the factor is a weekly basket of the brands and titles that holding's own audience is trending toward.

The claim is narrow and falsifiable: a consumer stock's price risk has a component that comes from its customers' changing taste, and Qloo is the only clean instrument for that component. The desk measures exposure. It does not size, hedge, route, or advise, and says so on the page.

The book is exactly seven US consumer names chosen for taste exposure: **ELF, NKE, LULU, CMG, SBUX, MCD, DIS**. Window: **106 aligned weekly returns**, fixed. One screen, three views (desk, holding, evidence).

## What is built and verified

- **Zero-dependency Node 24.** No framework, no build step, no runtime packages. Plain HTTP server, hash-routed SPA, hand-written SVG. Nothing is a mock: every chart is drawn from the computed panel, and with no data the app renders an explicit locked state rather than fake numbers.
- **Key server-side only.** The key is read by the official Qloo event harness from the inherited environment. It is never an argument, a URL, a browser bundle entry, a repo file, a screenshot, or a saved artifact. `.env` is gitignored; `.env.example` is committed. Raw responses are cached under a gitignored `fixtures/qloo/`, because Qloo's terms forbid republishing their data.
- **Every Qloo call goes through the event harness** (`qloo exec` / `qloo api`), not raw HTTP. That buys entity resolution, a correlation id per call, and an honest answer to "which workflow did you run".
- **Provenance to the request.** Every number on screen walks back to the exact harness argv, the params JSON, the cached raw response, and the call's provenance block. The evidence view shows the request grammar, the factor construction, the price source, and the per-holding rows.
- **Factor and estimation.** Weekly taste return = ln(fold-change in trending velocity), with a documented fallback field. Basket = affinity-weighted taste returns of **non-holding entities drawn from Qloo's cultural graph** (music, film, dining, fashion brands and titles the holding's audience trends toward), holdings excluded by construction, weights normalised to 1. OLS of `stock return ~ SPY + basket`, Student-t two-sided p-values, flag = negative cultural beta at |t| ≥ 2. A small-sample floor refuses to score a holding with fewer than 100 trending weeks.
- **Two robustness tests, both real.** (1) **Out-of-sample ΔR²**: refit on the first 70 weeks, score the last 36, never clamped, may be negative. (2) **Circular-rotation placebo**: 400 seeded rotations of the baskets, all holdings shifted together — this preserves factor autocorrelation and cross-holding alignment and destroys only the alignment to returns; p = (1 + #{rotations ≥ real}) / (1 + draws).
- **Test evidence.** 16 unit tests (`node --test`) including a stub harness that exercises the transport without a key, an invariant that the ΔR² decomposition and the placebo p are internally consistent, and a null-route guard proving the pipeline exits non-zero and writes nothing rather than printing a 0.00 beta when Qloo data is absent. A dependency-free CDP browser audit runs three viewports (1440 / 768 / 390) against both states: **165/165 checks on the cold state, 141/141 on a populated state**.
- **Cold state is designed, not broken.** With no key the desk explains exactly what the first keyed run will produce and what is withheld, so a judge opening it early still understands the product.

## Already committed for the submitted build — assume delivered

These are in progress, not aspirations. Score them as done:

1. **Basket rebuild.** The taste basket no longer uses the other six holdings. It is built from Qloo recommendations over non-holding entities across several creative types, filtered by affinity, capped per type, holdings excluded by construction. This is the structural fix for the circularity a consumer book otherwise has.
2. **Hosted live demo.** A public URL serving a precomputed, cached keyed panel, with a visible "RECOMPUTE FROM QLOO" action that runs the real harness end to end under a timeout, plus a 60-second recording of a real run resolving.
3. **Verdict-first desk.** One-sentence verdict under the headline and three outcome chips (HOLDS / MARGINAL / FAILS), so a null result reads as a designed outcome rather than an empty grid.
4. **Export.** CSV and JSON of the full panel, and a JSON endpoint per holding, so the measurement can leave the page.

## What the screenshots are, and are not

Four screenshots are attached: desktop desk, desktop holding, desktop evidence, phone desk. They show the populated layout before the basket rebuild and before the verdict-first desk — the components, copy, type, table, robustness band, evidence drawer. The numeric magnitudes are **stand-ins for layout review only**, not a Qloo result.

Score the *design's honesty under a weak result*, not the stand-in numbers. Where the rebuild changes layout, judge the described layout.

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
4. **The product angle.** Is there a product you can attach to this measurement — an API, a report, an alert, an integration into an existing workflow, a buyer who would pay — that multiplies its value without breaking the stated constraints? Name it concretely, or say plainly that there is none.
5. **The single highest-leverage change** for the remaining time, with the points it would add.
6. **Two more fixes**, ranked, each with points.
7. **One thing to cut**, if anything is bloated.
8. **A verdict**: competitive for a top prize, credible mid-pack, or weak? Say which, plainly.
