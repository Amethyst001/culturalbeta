# Submission draft — Devpost fields and the 90-second demo

Status: draft. Numbers are taken from `output/desk.json` at the current vintage
(80 priced of 101 names, 102 weeks ending 2026-10-26, Qloo's last revision 2025-12-22).
Replace `[DESK URL]` once hosted.

---

## One line

A consumer equity desk that prices **market beta** and **cultural beta** side by side —
and reports the honest answer when Qloo's taste factor cannot be tested out of sample.

## Elevator pitch (≤ 200 chars)

Market beta says how a stock moves with the index. Cultural beta says how much of that is
exposure to taste. 101 US consumer names, a Qloo-built taste basket per sub-sector, and a
pre-registered falsification attempt.

## What it does

For each of 101 US consumer names in 11 sub-sectors, the desk reports:

- **Market beta** — weekly return on the S&P 500.
- **Cultural beta** — the coefficient on a weekly taste basket built from Qloo
  `/v2/trending`, one basket per sub-sector, affinity-weighted, with every consumer stock
  removed so a sector cannot explain itself.
- **A signal screen** — negative cultural beta, |t| ≥ 2, Benjamini–Hochberg q ≤ 0.10
  across the book.
- **A pre-registered falsification attempt** — a fixed 67/35 split, a peer-basket control
  that uses no Qloo data, a sentiment exclusion, three independent-in-name nulls, and a
  disjoint replication window fixed before the keyed run.

Seven surfaces: desk, taste map, evidence, per-name holding page, plain-English read page,
JSON/CSV API, alerts feed.

## The finding, stated plainly

**No name carries a taste headwind that survives its own screen (0 of 80 priced).** In
sample the basket adds +0.67 pts of r², and every null matches or beats the real alignment
(rotation p 0.90, week permutation p 0.78, 6-week-block permutation p 0.83).

**The held-out test is untestable on this vintage, and the desk says so.** Qloo's
`population_percentile` for every basket member last changes in the week ending
**2025-12-22**. The final 44 of 102 window weeks are a carry-forward, and all 35 scored
weeks sit inside that tail: the taste regressor is identically zero there, so the
held-out condition has power equal to size at any effect. The cell reads **"no test"**, the
grade is **NO SIGNAL (IN-SAMPLE)**, and the perturbation value (−0.05 pts) is labelled as
such. A post-hoc split inside the revised region is shipped as a labelled diagnostic, not a
verdict: median −0.49 pts, 38% positive, 9 moving test weeks.

That refusal is the entry: the pipeline is built so that a null cannot be dressed up as a
finding, and so that a frozen endpoint cannot pass for a negative result.

## How it is built

- **Qloo is load-bearing.** `/search` resolves each name to a brand entity (83 of 101);
  `recommend` builds one basket per sub-sector per creative type; `/v2/trending` supplies
  the weekly series. Without live Qloo responses the desk refuses to print — there is no
  simulated data anywhere, enforced by a null-route test.
- **Deterministic statistics, no model in the loop**: OLS with standard errors, a
  rotation null, a week-order permutation, a 6-week-block permutation, a moving-block
  bootstrap, a refit-per-draw interval, a pooled panel with name fixed effects and
  week-clustered errors, a dispersion test with a disclosed power curve.
- **Provenance per row**: the exact request, the cached response, the price URL. Cached
  Qloo responses stay out of the public tree; only computed betas and request URLs are
  served.
- **Budget computed, not asserted**: 120 searches, 72 basket calls and 3,624 trend
  requests for the full book, derived from the same paging arithmetic the client spends.

## Built with

`node.js`, `qloo-api`, `javascript`, `html`, `css`, `yahoo-finance`, `statistics`

## What not to claim

- Not investment advice, not a trading system, no backtest of a strategy.
- Not "Qloo predicted returns" — the entry measures exposure, and the OOS arm is empty.
- Not "101 names priced" — 101 in the book, 83 resolved, 80 priced, 3 with no prices.
- Not "no effect exists" — no signal in sample, and no held-out test available.

---

## 90-second demo script

Screen recording, 1440 wide, one take, no cursor wandering. Voiceover optional; captions
on screen carry it if muted.

| time | screen | line |
|---|---|---|
| 0:00–0:08 | Desk, top | "Every consumer stock has a market beta. This desk asks a second question: how much of that movement is exposure to taste?" |
| 0:08–0:20 | Verdict sentence + chips | "Eighty priced names, zero taste-risk flags — and the grade says in-sample, because the held-out test could not run." |
| 0:20–0:34 | Scroll the table, one row hover | "Each row: market beta against the S&P, cultural beta against its sub-sector's Qloo taste basket, and the screen it had to pass." |
| 0:34–0:48 | Click a holding | "The taste basket is built from Qloo, not from the stock's own price — brands, films, artists and shows its audience actually engages with." |
| 0:48–1:02 | Evidence page | "Every number opens its own evidence: the Qloo request, the cached response, the price source. Without live Qloo the desk refuses to print." |
| 1:02–1:16 | Vintage card / OOS cell | "Here is the part most entries would hide. Qloo's series freezes 44 weeks before the price window ends, so the pre-registered held-out slice is empty. The desk marks it 'no test' rather than selling a near-zero as a result." |
| 1:16–1:28 | Read page, plain English | "Same numbers in plain English, including what would prove the desk wrong — and each of those checks is a computation with a printed verdict." |
| 1:28–1:30 | Alerts feed / CSV | "And an API: panel, alerts, CSV." |

## Pre-flight checklist

- [ ] Desk reachable at `[DESK URL]` over HTTPS
- [ ] `/api/v1/panel` returns 101 rows, 80 `ok`
- [ ] `/api/v1/alerts` returns `status: watchlist-only`, `count: 0`
- [ ] `/export/panel.csv` has the `oosTestable` column
- [ ] Repo public and clean: no `.env`, no `fixtures/qloo/`, no raw Qloo response
- [ ] Video ≤ 3 minutes (this cut is 1:30), unlisted or public on YouTube
- [ ] Written answer to "how does Qloo make this work" points at `/search`, `recommend`, `/v2/trending`
