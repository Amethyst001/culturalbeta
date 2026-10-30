# Taste is a risk factor. Here is the evidence that it isn't — yet.

Every consumer equity model already has one number for a stock: how much it moves with the
market. This desk builds the second one — how much of that movement is exposure to taste —
and then does the thing most data demos avoid. It reports what happens when the data cannot
answer, and marks the cell **"no test"** instead of printing a near-zero and calling it a
result.

**Try it in 60 seconds:** open the desk → read the one-sentence verdict → click any row →
open Evidence → find the card called *When Qloo's numbers stop moving*. If the last card
makes you trust the first four less, it is doing its job.

---

## The question

Qloo indexes what people actually love — brands, films, artists, shows — as a function of
population affinity. If taste shapes demand, and demand prices, then a *sector's* taste
should show up as a common factor in the companies that sell into it, distinct from the
market and distinct from the sector itself.

That is a testable claim, and a falsifiable one. So the desk makes it falsifiable on
purpose: a fixed window, a fixed split, a control that uses no Qloo data, and three nulls
that have to be cleared before any name gets called a taste risk.

## What the desk does

For **101 US consumer names across 11 sub-sectors** the desk fits, name by name:

$$
r_{i,t} \;=\; \alpha_i \;+\; \beta^{M}_{i}\, r^{M}_{t} \;+\; \beta^{C}_{i}\, b_{s(i),t} \;+\; \varepsilon_{i,t}
$$

where \( r_{i,t} \) is the name's weekly return, \( r^{M}_{t} \) is SPY, and
\( b_{s(i),t} \) is the weekly return of the taste basket for name \( i \)'s sub-sector.
\( \beta^{M}_{i} \) is the market beta every desk already has. \( \beta^{C}_{i} \) is the
cultural beta — the number this project is about.

A name is flagged as a **taste risk** only if all three hold at once:

| Filter | Why it is there |
|---|---|
| \( \beta^{C}_{i} < 0 \) | a headwind, not a tailwind |
| \( |t_i| \ge 2 \) | distinguishable from zero |
| Benjamini–Hochberg \( q \le 0.10 \) across the book | 80 names at 5% would flag four by chance alone |

Coverage is stated, not implied: **83 of 101** names resolved to a Qloo brand entity,
**80** have a full price history and carry a cultural beta, **3** have no complete price
series, and **18** resolved to nothing — those keep their row with the market half measured
and the cultural column withheld, plus the exact queries that failed and how many candidates
came back. A name is never dropped to make the coverage look better, and a beta is never
guessed.

## How the exposure is built

Each sub-sector's basket is an affinity-weighted blend of the **non-holding** entities Qloo
recommends for that audience, across four creative types — brand, movie, artist, TV show:

$$
b_{s,t} \;=\; \sum_{j \in B_s} w_{j,s}\; \Delta \log \pi_{j,t},
\qquad
w_{j,s} \;=\; \frac{a_{j,s}}{\sum_{k \in B_s} a_{k,s}}
$$

Here \( \pi_{j,t} \) is Qloo's `population_percentile` for entity \( j \) in week \( t \),
\( a_{j,s} \) is its affinity to sub-sector \( s \), and \( B_s \) excludes **every name in
the universe by construction** — so a sector cannot explain itself. The basket is one factor
shared by every name in the sector, which is what makes the number comparable across the
book, and what makes it cheap: the call count grows with sectors, not with names.

All Qloo traffic goes through the official `@qloo/qloo-harness` CLI — `api search` for
entity resolution, `exec recommend` per sub-sector and creative type, `exec trends` for the
weekly series, with `api insights` as a fallback when a resolution refuses an id. Nothing
raw-HTTPs the endpoint and guesses at response shapes.

## The falsification attempt

Fixed in `config/book.json` before any keyed run:

- a **67/35 split** of the 102-week window (2024-10-14 → 2026-10-26);
- a **peer-basket control** — the equal-weight return of the other names in the sub-sector,
  from committed prices, **no Qloo data at all** — fitted first, so taste has to add on top;
- a **sentiment exclusion**, so the basket is not a relabelled confidence index;
- **three nulls**: a circular rotation of the baskets, a week-order permutation, and a
  6-week block permutation that respects the refresh cadence;
- a **disjoint replication window** immediately before the primary one, fixed before the run.

A positive claim has to clear **every** null — a max-of-\(p\) rule, conservative by
construction. The friendliest \(p\) is never used on its own, because choosing a null after
seeing its p-value is not a test.

## What the book says

**Zero of 80 priced names carry a taste headwind that survives its own screen.**

In sample the basket adds **+0.67 pts of \(r^2\)** on average, and every null matches or
beats that alignment:

| Null | p-value |
|---|---|
| Rotation of the baskets | 0.898 |
| Week-order permutation | 0.778 |
| 6-week block permutation | 0.830 |

And the cross-section is not heterogeneous in a way the window can detect: the spread of
per-name cultural betas is **805** against **1,869** from estimation noise alone and a
rotation-null mean of **1,352**. The test is keyed to a disclosed power curve, and at the
spread this book actually shows its power is **0%** — which means the non-detection is
*uninformative*, not a kill. The desk says exactly that, rather than claiming the names are
alike.

## What the data could not say

This is the finding that changed the product.

Qloo's `population_percentile` for every basket member stops changing in the week ending
**2025-12-22**. The final **44 of the 102** window weeks are a carry-forward: identical
level, a weekly log change of exactly zero, for every name. The pre-registered 67/35 split
puts **all 35 scored weeks inside that tail**.

The consequence is not "a weak test". It is an empty one. In every scored week
\( b_{s,t} = 0 \), so for *any* coefficient:

$$
\hat{\beta}^{C}_{i}\, b_{s,t} \;=\; 0
$$

The held-out prediction is identically the market-only fit, whatever the true taste
exposure is. The test's power equals its size at every effect, and the perturbation value
that falls out (−0.05 pts) is the training fit being re-projected, not a measurement of
taste.

So the desk does four things in public:

1. The held-out cell reads **"no test"**, not a negative.
2. The grade is **NO SIGNAL (IN-SAMPLE)** — no sign in the book, and no separable null.
   The word *in-sample* is part of the grade, not a footnote.
3. A post-hoc split placed *where the data moves* is shipped as a **labelled diagnostic**:
   median ΔR² −0.49 pts, positive on 38% of names, on a median of 9 moving test weeks. It
   cannot move the grade, and it says so in the same paragraph.
4. The alerts feed **refuses to arm**. Every suppressed name arrives with a reason, and the
   book-level status says the nulls cannot arm a watchlist at this vintage.

The disjoint replication window is untestable on this pull for the same kind of reason:
Qloo's levels cover **58 of its 106 weeks**, below the 100-week sample floor, so the
estimator never ran there. The desk reports that as *untestable*, not as a failure to
replicate.

## Why we shipped the null instead of a better story

It would have been easy to hide the frozen tail: truncate the window, move the split, or
report the in-sample \(r^2\) gain and let a reader assume it held up. Each of those makes a
better demo and a worse instrument.

The product thesis is that **a research desk is only worth what it refuses to claim**. The
same pipeline that finds a taste signal has to be able to say "not here, not with this
window" — otherwise its positive results mean nothing either. The frozen tail is now a
first-class feature: a data-quality card, a chip on every screen, and a sentence in the API
payload, so an ingestion client cannot mistake *not found* or *not testable* for *no signal*.

## How it is built

- **Pipeline:** price fetch → Qloo entity resolution → per-sector basket → weekly series →
  compute betas. Deterministic: no model in the loop, no LLM in the statistics.
- **Inference:** OLS with standard errors, Benjamini–Hochberg multiplicity, circular-rotation
  and two permutation nulls, a moving-block bootstrap, a refit-per-draw interval, a pooled
  panel with name fixed effects and week-clustered errors, a dispersion test with a
  disclosed power curve.
- **Provenance per row:** the exact Qloo request, the cached response path, and the price
  URL. The desk will not print a cultural beta it cannot trace to a live response, and it
  never falls back to zeros — enforced by a null-route test.
- **Budget, computed not asserted:** the full run plans 120 searches, 72 basket calls and
  3,624 trend requests from the same paging arithmetic the client spends. The paid run
  actually spent **3,065** (121 searches, 72 basket calls, 2,872 trend requests, replayed
  from 358 cached pages). The numbers are served at `/api/budget.json`.
- **Seven surfaces:** desk, taste map, evidence, per-name holding page, plain-English read
  page, a versioned JSON/CSV API (`/api/v1/panel`, `/api/v1/holding/:t`, `/api/v1/alerts`,
  `/export/panel.csv`), and an alerts feed.
- **Enforced quality:** 63 unit tests and a Chrome DevTools audit of **353 checks** across 5
  routes × 3 viewports, including tap targets, horizontal overflow, and the claim that the
  grade chip matches the computed state. The audit artefacts are committed.

## Challenges

**Entity resolution is where consumer data bites.** 18 of 101 names did not resolve. The
desk reports why, per name: no listing, a corporate name where a brand string was needed, or
no name match. Fourteen of the 18 were searched under a single query — so for those the miss
is a limit on what was asked, not a finding that the brand is outside Qloo. Getting this
right mattered more than the hit rate: a guessed mapping would have poisoned the basket.

**Qloo's API returns no request id.** Provenance therefore had to be designed rather than
logged: the exact request plus a cache path, held locally, never committed, and printed on
the row so a judge can audit a number without seeing the data.

**The budget is real money.** The client computes its cost before it spends: the official
harness pays an id re-resolution beside every trends page, which doubles the request count
per page. Once that was understood, the cache design followed — and the actual run came in
under plan because cached pages replay for free.

**The honest result is a harder product than a fake one.** Every surface had to be rewritten
around "in sample only" without becoming a disclaimer wall. The rule we settled on: the
caveat lives *at the number*, not in a footer — a reader who never scrolls still cannot
misread it.

## What one more revision buys

The desk states what a test needs: **moving weeks inside the scored slice**. With a Qloo
revision that lands after 2025-12-22, the pre-registered split runs unchanged, and the same
command re-derives the panel from cached responses at near-zero cost. If the taste channel is
real, that run will show it; if it is not, the desk will say that too, on the same page, with
the same nulls.

## What this is not

Not investment advice. Not a trading system. No portfolio, no optimiser, no backtest of a
strategy — and no Sharpe ratio, because a return claim needs a varying cultural series across
a held-out window and, at this vintage, that window is empty. A number built on a frozen
regressor would be manufactured, so none is published.

Affinity scores describe aggregate taste populations, never individuals.

---

**Built with** Node.js, the Qloo API through `@qloo/qloo-harness`, Yahoo Finance weekly bars,
plain OLS and resampling — no ML, no LLM in the estimator.

**Links:** demo `{{PUBLIC_URL}}` · code `{{REPO_URL}}` · video `{{VIDEO_URL}}`
