# Cultural Beta — score the prize-day entry, with every provision in place

You are a judge on the **Qloo Agentic Hackathon** (Devpost, closes 31 Oct 2026). Do not be kind. A flattering review costs the team a prize.

## The premise you must accept

**This team can and will supply anything you name.** The Qloo key is pending today, not missing by design; hosting, a recorded demo, a live URL, additional data pulls, an advisor — if you say the entry needs it, assume it is delivered before the deadline.

So: **score the entry as it will exist on prize day, with every provision you name in place.** Do not deduct for something being unbuilt, unproven, pending, or absent from the screenshots. Deduct only for what a provision *cannot fix*:

- **Rules and terms.** Qloo's terms forbid republishing their response data in a public repo. Fabricated or simulated Qloo data is disqualifying. A maths claim that does not follow from the estimator stays wrong no matter who provides the key.
- **Outcome risk.** The real data may produce small effects, wide intervals, or zero flagged names. A provision cannot buy a positive result. Judge whether the product is still worth something in that case.
- **Scope the team has deliberately refused.** Exactly seven holdings, one factor, no advice, no trading. If you think the scope is wrong, say so and score it — but do not pretend the refusal is an oversight.

## What it is

A **consumer equity desk that reports two kinds of beta side by side**.

- **Market beta** — what every terminal already gives you: a holding's sensitivity to the S&P 500.
- **Cultural beta** — a new number: a holding's sensitivity to a *taste factor* built from Qloo's cultural graph, where the factor is a weekly basket of the brands and titles that holding's own audience is trending toward.

The claim is narrow and falsifiable: a consumer stock's price risk has a component that comes from its customers' changing taste, and Qloo is the only clean instrument for that component. The desk measures exposure. It does not size, hedge, route, or advise, and says so on the page.

The book is exactly seven US consumer names chosen for taste exposure: **ELF, NKE, LULU, CMG, SBUX, MCD, DIS**. Window: **106 aligned weekly returns**, fixed. One screen, three views (desk, taste map, evidence).

## What the screenshots show

Four attached: desktop desk, desktop holding, desktop evidence, phone desk. These are **post-rebuild**: the current basket construction, the current verdict-first desk, the current evidence table.

Their numbers come from a **stub harness run through the real pipeline** — the layout is final, the magnitudes are not a Qloo result and are not presented as one. Score the *design's honesty under a weak result*, not the stand-in numbers. The attached desk happens to render the FAILS branch, which is the harder case to design: the factor did not survive out of sample and the desk says so in one sentence before it shows any table.

## What is built and verified today

- **Zero-dependency Node 24.** No framework, no build step, no runtime packages. Plain HTTP server, hash-routed SPA, hand-written SVG. Nothing is a mock: every chart is drawn from the computed panel, and with no data the app renders an explicit locked state rather than fake numbers.
- **Key server-side only.** The key is read by the official Qloo event harness from the inherited environment. It is never an argument, a URL, a browser bundle entry, a repo file, a screenshot, or a saved artifact. `.env` is gitignored; `.env.example` is committed. Raw responses are cached under a gitignored `fixtures/qloo/`, because Qloo's terms forbid republishing their data.
- **Every Qloo call goes through the event harness** (`qloo exec` / `qloo api`), not raw HTTP. That buys entity resolution, a correlation id per call, and an honest answer to "which workflow did you run".
- **The basket is built from Qloo, not from the book.** For each holding, `exec recommend` is run over four creative types (brand, movie, artist, tv_show), ten candidates per type. Candidates are kept only if affinity is positive, then the holding itself — and any name matching its query — is excluded **by entity id and by normalised name**. What survives is the holding's basket, affinity-weighted, weights renormalised to 1. So e.l.f.'s basket can never be Nike.
- **The harness's real schema is enforced locally.** The harness validates before any call: `trends` accepts 1–5 entities and at most 20 points per call, `recommend` 1–10 signals and at most 20 results. The series fetcher pages date windows at 18 points per call, infers the cadence from the first response, and refuses rather than half-filling a series. The stub harness in the tests enforces the same caps, so a regression fails in CI rather than on the keyed run.
- **Factor and estimation.** Weekly taste return = ln(fold-change in trending velocity), with a documented fallback field. Basket = affinity-weighted taste returns of the non-holding entities above; weeks where a member has no data are re-weighted across the members that do, never zero-filled. OLS of `stock return ~ SPY + basket`, Student-t two-sided p-values, flag = negative cultural beta at |t| ≥ 2. A small-sample floor refuses to score a holding with fewer than 100 trending weeks.
- **Two robustness tests, both real.** (1) **Out-of-sample ΔR²**: refit on the first 70 weeks, score the last 36, never clamped, may be negative. (2) **Circular-rotation placebo**: 400 seeded rotations of the baskets, all holdings shifted together — this preserves factor autocorrelation and cross-holding alignment and destroys only the alignment to returns; p = (1 + #{rotations ≥ real}) / (1 + draws).
- **Verdict-first desk.** Above the table: one sentence stating what the window found, then outcome chips — HOLDS / MARGINAL / FAILS, flagged count, out-of-sample ΔR², placebo p — and a note that FAILS means the factor did not survive, not that the desk failed. A null result is a stated outcome, not an empty grid.
- **The measurement is also a product surface.** Three endpoints, served by the same process, verified 200: `GET /api/v1/panel` (versioned, `schema 1.0.0`, every holding's beta with its provenance), `GET /api/v1/holding/:ticker` (404 `UNKNOWN_HOLDING` otherwise), `GET /export/panel.csv`. The desk is the demo of the feed, not a dead end.
- **Test evidence.** 16 unit tests (`node --test`) including a stub harness that exercises the transport without a key, an invariant that the ΔR² decomposition and the placebo p are internally consistent, and a null-route guard proving the pipeline exits non-zero and writes nothing rather than printing a 0.00 beta when Qloo data is absent. A dependency-free CDP browser audit runs three viewports (1440 / 768 / 390) against both states: **165/165 checks on the cold state, 147/147 on a populated state**.
- **Cold state is designed, not broken.** With no key the desk explains exactly what the first keyed run will produce, says which numbers are withheld, and names the two robustness tests that will print — so a judge opening it early still understands the product.

## What the last panel asked for, and what happened

The previous round scored this **82.7 mean** (84 / 81 / 83). Worth knowing before you score, so you don't spend your review re-discovering it:

- **"The basket is circular — it's the other six holdings."** Correct, and fixed. See the basket construction above. This is now a Qloo recommendation over non-holding entities with explicit exclusion.
- **"A null result would look like a broken page."** Fixed — that is the verdict sentence and chips on the attached desk.
- **"The measurement dies on the page."** Fixed — the three endpoints above.
- **"There should be a second fixed window so the result isn't a single draw."** Not adopted yet. Say whether you want it, and whether a pre-registered second window is worth the added degrees of freedom.
- **"Mobile: tap targets and the provenance table overflow."** Partly addressed; judge the phone screenshot and say if it is still short.

For context on why the refusals exist: the factor is fixed before the key arrives, the window is fixed, the two robustness tests are fixed, and none of them will be changed after the real numbers print. Whatever the keyed run shows ships.

## Still to deliver on prize day — assume delivered

1. **Hosted live demo.** A public URL serving a precomputed, cached keyed panel, with a visible "RECOMPUTE FROM QLOO" action that runs the real harness end to end under a timeout, plus a 60-second recording of a real run resolving.
2. **The keyed run itself.** Seven resolved entity ids, the real baskets, the real 106 weeks, the real betas.
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
4. **The product angle.** Is there a product you can attach to this measurement — an API, a report, an alert, an integration into an existing workflow, a buyer who would pay — that multiplies its value without breaking the stated constraints? Name it concretely, or say plainly that there is none. If your answer is the JSON feed already built, say what would make that feed worth paying for rather than merely available.
5. **The single highest-leverage change** for the remaining time, with the points it would add.
6. **Two more fixes**, ranked, each with points.
7. **One thing to cut**, if anything is bloated.
8. **A verdict**: competitive for a top prize, credible mid-pack, or weak? Say which, plainly.
