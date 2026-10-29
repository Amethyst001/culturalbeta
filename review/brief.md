# Review brief — Cultural Beta desk (round 2)

Round 1 verdict from every model that answered: **"hackathon demo, not an institutional desk."**
Both blamed the same thing: a full-width black "NO QLOO. NO FACTOR." block leading the page.
Those changes are now made. This round asks whether the verdict moved, and what is left.

## The product

A consumer-equity desk for the Qloo Agentic Hackathon (Devpost, closes 31 Oct 2026; judges
include the Qloo CTO; rubric 25 points each for Technological Implementation, Design, Potential
Impact, Quality of Idea).

Thesis: **market beta prices index exposure; cultural beta prices exposure to taste.** For seven
US consumer names, over 106 aligned weekly returns, the desk reports both coefficients side by
side, plus a flag when the taste loading is negative and significant.

Method, uncompromised:
- Taste momentum per brand: Qloo `/v2/trending` weekly `velocity_fold_change` → `ln` return.
- Basket per holding: shared-audience affinity from Qloo `/v2/insights`, leave-one-out, normalised.
- Regression per holding: weekly return ~ SPY return + basket return → cultural beta, s.e., t, p.
- **ΔR²** = full-model r² − market-only r², and its mean across the book. In-sample, stated as such.
- Flag rule: cultural beta < 0 with |t| ≥ 2.
- Sample floor: fewer than 100 weekly Qloo points → row stays, beta is withheld, never zeroed.
- Null route: with Qloo responses emptied, the pipeline refuses to print. Enforced by a test.

## Hard limits (do not propose around these)

- No simulated Qloo data anywhere, and no zero fallback. The Qloo key is still pending, so the
  cultural column is genuinely empty in the screenshots.
- No portfolio builder, optimiser, sizing, order routing, or return claims.
- Exactly seven holdings, no auth, no accounts, no database.
- Everything is dependency-free: hand-rolled SVG, no chart library, no webfont.
- One builder, ships in two days.

## What changed since round 1 (in direct response to you)

1. The black hero is gone. The cold state is now: headline → one-line status notice (~90–130px)
   → four stats → the live price table → a short policy block. The apology no longer leads.
2. Bebas Neue is gone. Georgia headlines (bold + italic accent), monospace numerals, system sans
   micro-labels.
3. Table hierarchy: two-row headers ("Market beta / ± std. error"), t-stat and r² removed from the
   desk table (they live on the holding page), cultural beta shown as diverging bar + value + s.e.
4. Accent (#7f2d22) now carries the headline italic, negative betas, the flag, the status notice.
5. Refresh moved from the footer to the masthead, next to the run state.
6. Phone: table rows become labelled cards instead of hidden columns.
7. Added: ΔR² stat in the strip, a ΔR² line per holding, a one-line flag rule, an Evidence card
   ("What this desk is, and is not") covering universe choice, fixed window and multiple testing,
   and deep links from each row's TRACE to its own evidence row.
8. Automated audit: 106/106 checks across 4 routes × 2 viewports. Screenshots attached are the
   current cold desk at 1440×1100 and 390×844.

## What is still unverified

- No live Qloo response has ever been fetched: the key is pending. Entity ids, trending weekday
  coverage, affinity field names and the resulting betas are all unconfirmed.
- The live (populated) layout has been exercised only against temporary fixtures outside the repo,
  then deleted. It is not shown here because showing it would mean showing simulated numbers.
- The claim that Qloo is load-bearing rests on ΔR² being non-trivial with real data. Unknown today.

## Questions

1. Verdict now: institutional desk, or still a hackathon demo? Name the single biggest remaining tell.
2. Concrete placement-level fixes only (spacing, hierarchy, type, colour, order). No new features
   you would not ship in one day.
3. Cold state: is "price half live, taste half withheld" the right call, or should the market numbers
   be masked until Qloo is connected? Defend the choice for a Qloo CTO who knows the data is yours.
4. Is ΔR² + the flag rule + the limits card enough for a quant judge, or is one more number needed?
   If so, name exactly one and say what it buys.
5. What would you cut? The Evidence route is the current candidate for bloat.
6. 90-second demo beat order **assuming the key never arrives**: what is on screen, in what order,
   and what is said? The recording must be honest.
