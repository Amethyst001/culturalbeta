# Cultural Beta — score this as the submitted entry

You are a judge on the **Qloo Agentic Hackathon** (Devpost, closes 31 Oct 2026). Do not be kind. A flattering review costs the team a prize.

## The premise you must accept

**The Qloo API key will be present before submission.** It is pending today, not missing by design. So judge the entry as it will exist on prize day, not as it looks in a demo without data. Anything the key fixes (empty data, "no results", unresolved names) is not a defect you should charge for. Anything the key cannot fix is.

One caveat you should factor in honestly: the seven holdings below are fixed, and the real Qloo data may produce small effects, wide intervals, or no flagged names at all. The product must still be worth something in that case, so judge whether the design survives a null result.

## What it is

A **consumer equity desk that reports two kinds of beta side by side**.

- **Market beta** — what every terminal already gives you: a holding's sensitivity to the S&P 500.
- **Cultural beta** — a new number: a holding's sensitivity to a *taste factor* built from Qloo data, where the factor is a weekly basket of the brands and titles the holding's own customer base is trending toward.

The claim the desk makes is narrow and defensible: a stock's price risk has a component that comes from its customers' changing taste, and Qloo is the only clean instrument for that. The desk measures exposure. It does not size, hedge, route or advise, and it says so on the page.

The book is exactly seven US consumer names chosen for taste exposure: **ELF, NKE, LULU, CMG, SBUX, MCD, DIS**. Window: **106 aligned weekly returns**, fixed. One screen, three views (desk, holding, evidence).

## What is actually built and verified

- **Zero-dependency Node 24.** No framework, no build step, no runtime packages. Plain HTTP server, hash-routed SPA, hand-written SVG charts. Nothing is a mock: every chart is drawn from the computed panel, and with no data the app renders an explicit locked state rather than fake numbers.
- **Key server-side only.** The Qloo key lives in an env var read by the proxy; it is never in the browser bundle, the repo, the screenshots or any saved artifact. `.env` is gitignored, `.env.example` is committed. Raw Qloo responses are cached under `fixtures/qloo/`, which is gitignored because Qloo's terms forbid republishing their data.
- **Provenance to the request.** Every number on screen can be walked back to the exact Qloo request parameters and the cached raw response that produced it. The evidence view shows the request grammar, the factor construction, the price source and the per-holding rows.
- **Factor and estimation.** Weekly taste return = ln(fold-change in trending velocity), leave-one-out affinity weighted basket per holding, normalised to 1, OLS of `stock return ~ SPY + basket`, Student-t two-sided p-values, flag = negative cultural beta at |t| ≥ 2. Small-sample floor refuses to score a holding with fewer than 100 trending weeks.
- **Two robustness tests, both real.** (1) **Out-of-sample ΔR²**: refit on the first 70 weeks, score the last 36, never clamped, may be negative. (2) **Circular-rotation placebo**: 400 seeded rotations of the taste baskets, all holdings shifted together, which preserves factor autocorrelation and cross-holding alignment while destroying only the alignment to returns; p = (1 + #{rotations ≥ real}) / (1 + draws). Both are surfaced as a "Does it survive?" band on the desk, as a per-holding line, and in an evidence limits card.
- **Test evidence.** 11 unit tests (`node --test`) including invariants that the ΔR² decomposition and the placebo p are internally consistent. A dependency-free CDP browser audit runs three viewports (1440 / 768 / 390) against both states: **165/165 checks pass on the cold state**, **141/141 on a populated state**, including a null-route guard and a check that the robustness band never renders an em-dash placeholder.
- **Cold state is designed, not broken.** With no key the desk explains exactly what the first keyed run will produce (ΔR², median |t|, out-of-sample ΔR², placebo p) and states what is withheld — so a judge opening it before the key lands still understands the product.

## Constraints that are deliberate, not oversights

- Exactly 7 holdings, 106 weeks. Not a screener, not a universe.
- No auth, no accounts, no database, no persistence.
- No portfolio builder, optimiser, trading or backtest-performance claims. The desk measures exposure; it does not act on it.
- One factor, one market benchmark. No multi-factor model.

## What the screenshots are, and are not

Four screenshots are attached: desktop desk, desktop holding, desktop evidence, phone desk. They show the **populated layout** — the real components, copy, typography, table, robustness band and evidence drawer. The numeric magnitudes in them are **stand-ins for layout review only**, not a Qloo result. The real run may be weaker: smaller ΔR², fewer or zero flagged names, a placebo p that fails to separate. Score the *design's honesty under a weak result*, not the stand-in numbers.

## What I want back

1. **Four criterion scores**, each out of 25, using the hackathon rubric, then a total out of 100. Use this exact format:

```
Technological Implementation: NN/25 — one sentence of justification
Design: NN/25 — one sentence of justification
Potential Impact: NN/25 — one sentence of justification
Quality of Idea: NN/25 — one sentence of justification
TOTAL: NN/100
```

2. **The single highest-leverage change** for the remaining time, with the points it would add.
3. **Two more fixes**, ranked, each with the points it would add.
4. **One thing to cut**, if anything is bloated.
5. **A verdict**: is this competitive for a top prize, a credible mid-pack entry, or a weak entry? Say which, plainly.
6. **What would move Technological Implementation from your score to 20+.** Be concrete.

Score the entry that will be submitted. Ignore what is merely pending.
