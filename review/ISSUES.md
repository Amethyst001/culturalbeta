# Issue register — round 7 (2026-10-30)

Source: `review/panel-2026-10-30T16-46-00.md` (reviewer 1 = NVIDIA Nemotron, structure;
reviewer 2 = Groq GPT-OSS 120B, product, 49/100; reviewer 3 = NVIDIA Nemotron, craft,
returned a 147-character fragment and is unusable), plus my own audit of the build.

Every item below is either **FIX** (in this batch), **STALE** (the panel was looking at an
older build or misread the screen — no change), or **BLOCKED** (needs the deploy/recording
step, not code). The point of the register is that no item is silently dropped.

Disposition rule: an item is only accepted if fixing it makes the desk *more* honest or
*more* usable. Items that ask the desk to suppress its own measured numbers are rejected
where the number is correctly labelled — a desk that hides a reading because a reviewer
finds it inconvenient is a worse product.

---

## P0 — blocks the entry or invalidates a claim

| # | Item | Evidence | Fix / disposition |
|---|------|----------|-------------------|
| P0-1 | No public URL, no recorded demo, no Devpost submission | Panel 1 #1, panel 2 #1 | **BLOCKED on deploy + recording.** Deploy kit is written for the shared nginx host (`deploy/install.sh`, `deploy/README.md`). Domain `culturalbeta.ktnamethyst.me` → 84.8.134.19 already resolves. Needs one go-ahead to install on the host (it shares nginx with cockpit). |
| P0-2 | Per-name cultural beta is printed as if identified out of sample; DIS shows +43.81 ± 13.84 | Panel 1 #2, panel 2 #2 | **FIX (partial).** The beta *is* identified in sample, on the 19–31 weeks per name where the basket moves; suppressing it would delete the product. What was missing is that fact on the row itself: the sub-label now reads `± se · 23/102 wk`, and the existing identification note is promoted above the table. A full suppression is rejected — it is the desk's central measurement and it carries its own error. |
| P0-3 | Headline stat card `+0.67 pts ΔR² FROM TASTE` reads as a positive result against a NO SIGNAL grade | Panel 1 #7, panel 2 #3/#7 | **FIX.** Label becomes `ΔR² from taste · in sample`; the highlight is only applied when the factor actually holds out of sample. The number stays (it is real and disclosed) but stops competing with the grade. |

## P1 — costs points on an axis

| # | Item | Evidence | Fix / disposition |
|---|------|----------|-------------------|
| P1-1 | `LIVE QLOO` badge implies fresh cultural data | Panel 1 #3, panel 2 #4/#11 | **FIX.** `live Qloo` → `Qloo-sourced`, and the state line appends `series ends 2025-12-22`. Applied to desk and evidence. |
| P1-2 | `RECOMPUTE THE DESK` is a false affordance | Panel 1 #5, panel 2 #6 | **FIX (relabel, not disable).** The button is real: it re-derives the panel from the cached paid responses in ~2 s and refuses to spend budget. It never refreshed the Qloo series, so the label was wrong. Now `Re-derive the panel` with a note saying it uses cached responses and makes no new calls. |
| P1-3 | p-value labels disagree across screens; the value shown as "date permutation" is the 6-week block | Panel 1 #4/#6, panel 2 #10 | **FIX.** One chip and one sentence list all three nulls with three decimals and their real names: rotation, week permutation, 6-week block. The evidence card repeats the same list. |
| P1-4 | Signal column shows `tailwind` for a name that fails the q filter, under a header that claims q ≤ 0.10 | Panel 1 #8, panel 2 #8 | **FIX.** An unflagged name with |t| ≥ 2 now reads `|t| ≥ 2 · q 0.4x` and loses the word tailwind, which read as a finding. |
| P1-5 | On a phone the frozen-slice disclosure sits below the fold | Panel 1 #9, panel 2 #9 | **FIX.** A one-line mobile-only basis note sits under the state line; the full band stays on desktop. |
| P1-6 | Request table gives no coverage accounting for the 18 unresolved and 3 unpriced | Panel 1 #9, panel 2 #14/#15 | **FIX.** Coverage sentence moves above the table: 80 priced with a cultural beta, 3 without a complete price history, 18 with no Qloo entity. |
| P1-7 | Pre-registration asserted but not pointed at | Panel 2 #16 | **ALREADY ANSWERED IN PRODUCT** (evidence and read page both name `config/book.json` as the file fixed before the keyed run). No separate public URL exists yet; that arrives with the repository link at submission. |
| P1-8 | Basket construction and beta units undefined | Panel 2 #22/#23 | **FIX.** One sentence added to the method list: equal-weight blend of each sub-sector's non-holding recommend entities, weekly return = mean log change in `population_percentile`; cultural beta is percentage points of a name's weekly return per one point of basket return. |
| P1-9 | Date badge `2024-10-14 → 2026-10-26` is "in the future" | Panel 1 #6, panel 2 #5 | **STALE / REJECTED.** Today is 2026-10-30; 2026-10-26 is the last completed week and the last aligned price bar. The reviewer's clock was wrong. The pill now carries a `last completed week` title for the reader who wonders. |
| P1-10 | "taste map, holding page, API, alerts feed" claimed but not shown | Panel 1 #13 | **STALE.** All five exist and are audited (`/api/v1/panel`, `/api/v1/holding/:t`, `/api/v1/alerts`, `/export/panel.csv`, `#/map`, `#/holding/:t`, `#/read`). The reviewer saw only two screenshots. |
| P1-11 | `Read it in plain English` points at an identical page | Panel 2 #25 | **STALE.** `#/read` is a separate prose page with a different document structure. |
| P1-12 | 3 names with incomplete price history still show a market beta | Panel 2 #14 | **STALE.** They show `no prices` / `not printed`, no beta. Verified in `desk.json` (`status: "no prices"`). |
| P1-13 | "All Consumer 101" overstates coverage | Panel 2 #15/#18 | **FIX (partial).** The roster note already says 80 of 101 carry a cultural beta; the sector-pill count now carries `(80 priced)` in its title. |

## P2 — cosmetic or already covered

| # | Item | Disposition |
|---|------|-------------|
| P2-1 | 0 OF 80 FLAGGED dominates | **REJECTED.** It is the finding. Demoting it would hide the result behind the caveat. |
| P2-2 | Audit / test-count badges missing | **FIX.** Footer gains `tests 63/63 · ui audit 350/350` from committed run artefacts, so the claim is visible rather than asserted. |
| P2-3 | Plain-English page should be ≤200 words | **STALE.** It is a structured argument, not a summary; that is deliberate. |
| P2-4 | "one factor" vs two betas | **FIX.** Subtitle now reads "one taste factor, with the market as its control". |
| P2-5 | Cultural beta column sorting implies a ranking | **REJECTED as a defect, ACCEPTED as a caveat.** The dispersion test already says the column is not a ranking, and it is printed at the top of the holding pages. |

---

## Path to a high score, per axis

Scoring is the hackathon's four axes, 25 each. The panel's 49/100 is a text-only read of a
build that still carried a misleading badge and an over-highlighted in-sample card; the six
P1 fixes above are exactly the points it could not see being fixed.

| Axis | Panel | After this batch (est.) | What is left on the table | Ceiling |
|------|-------|-------------------------|---------------------------|---------|
| Technological Implementation | 12 | 19–21 | The last points are the public URL + demo (P0-1) and a repository link. Nothing else is missing: 350/350 UI checks across 5 routes × 3 viewports, 63 unit tests, versioned API, CSV, alerts. | 24 |
| Design | 14 | 20–22 | Mobile fold fixed, contradictory badges removed, nulls unified. Remaining gap is judge taste, not a defect. | 23 |
| Potential Impact | 8 | 12–14 | **Hard-capped by the data**, not by the build. A taste factor that cannot be tested out of sample cannot be claimed as a risk premium. The honest version — a desk that prices taste and proves the vintage cannot test it — is defensible but not investable. Only a newer Qloo revision that moves inside the scored window lifts this. | 16 at this vintage |
| Quality of Idea | 15 | 18–20 | Pre-registered falsification, three nulls, dispersion power curve, frozen-tail disclosure. The idea is strong; the evidence is what caps it. | 22 |
| **Total** | **49** | **69–77** | | **≈ 85 at this vintage** |

**98 is not reachable on this data, and the panel is right about why.** Roughly 20 of the
missing points sit on Potential Impact, and no amount of UI work moves them: the cultural
regressor is constant in all 35 scored weeks, so the entry can never show a held-out taste
effect. Chasing 98 would mean either inventing variation Qloo does not supply (forbidden) or
claiming an in-sample number as a result (dishonest). The desk's answer is the one already on
the page: price the exposure, prove the vintage, and say exactly what a test would need.

The realistic target is **low-to-mid 80s**, reached by the deploy + demo + repository link,
not by further copy edits.
