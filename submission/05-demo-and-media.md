# Demo video and project media

## Video demo (90 seconds, one take)

Record at **1200×800 or 1600×1000**, 30 fps, browser at 100% zoom, no extensions, no
bookmarks bar. Voiceover is optional — the captions below are burned into the screen as
lower-thirds or typed as text in the description, so the video works muted (judges often
watch muted).

| Time | Screen | On-screen caption | Voiceover |
|---|---|---|---|
| 0:00–0:10 | Desk, top of page | *Every consumer stock has a market beta. This desk asks a second question.* | "Every consumer equity model prices one number: how a stock moves with the market. This desk prices the second one — how much of that movement is taste." |
| 0:10–0:24 | Verdict sentence + chips | *80 priced names. Zero taste-risk flags. Grade: in-sample.* | "Eighty priced names, zero taste-risk flags. And the grade says in-sample, because the held-out test could not run. That word is doing a lot of work, and the desk will show you why." |
| 0:24–0:38 | Table; hover/scroll one row | *Market beta vs SPY · cultural beta vs the sub-sector's Qloo basket* | "Each row carries the market beta you already have, and a cultural beta against a basket built from Qloo — brands, films, artists and shows the audience actually engages with." |
| 0:38–0:52 | Holding page (DIS) | *One name, fully opened: estimates, errors, q, and the basket* | "Open a name and you get the estimate, its error, the t, the Benjamini–Hochberg q, and the basket it was priced against — here YouTube, AMC, Captain Marvel, Ariana Grande. Every number is identified on the weeks the basket actually moves: thirty of a hundred and two." |
| 0:52–1:06 | Evidence page → grade card | *The nulls: rotation 0.898 · week 0.778 · block 0.830* | "The falsification attempt was fixed before the run: a peer basket with no Qloo data, a sentiment exclusion, three nulls, and a replication window. Every null matches or beats the real alignment." |
| 1:06–1:20 | Vintage card | *Qloo's last revision: 2025-12-22. All 35 scored weeks are frozen.* | "And here is the part most entries would hide. Qloo's series stops moving 44 weeks before the price window ends. Every scored week sits inside that tail, so the taste regressor is zero, the held-out test has power equal to size, and the cell says no test — not a near-zero sold as a result." |
| 1:20–1:30 | Read page, then API/CSV | *Same numbers, plain English · `/api/v1/panel` · `/export/panel.csv`* | "The same numbers in plain English, with what would prove the desk wrong, and a versioned API for anyone who wants to check it themselves." |

**Delivery notes.** One take, no cursor wandering, no zooming. Move only when the row you
are talking about changes. Do not apologise for the result in the audio — state it as a
finding. The video is 1:30; anything under 3:00 is fine, but shorter is better.

## Video description (paste into YouTube)

```
Cultural Beta — a taste-factor desk for US consumer equities.

Market beta prices a stock against the S&P 500. Cultural beta prices its exposure to
taste, using a weekly basket built from Qloo's recommend and trending endpoints, one
basket per sub-sector, with every holding excluded so a sector cannot explain itself.

101 names, 11 sub-sectors, 102 weeks, and a pre-registered falsification attempt:
67/35 split, a no-Qloo peer control, a sentiment exclusion, three nulls, and a disjoint
replication window fixed before the run.

Headline: 0 of 80 priced names carry a taste headwind that survives its screen. In sample
the basket adds +0.67 pts of r², and every null matches or beats that alignment
(rotation p 0.898, week p 0.778, 6-week block p 0.830).

The held-out test is untestable at this data vintage: Qloo's last revision is the week
ending 2025-12-22, all 35 scored weeks are carry-forward, so the taste regressor is
identically zero in the scored slice. The desk marks that cell "no test" and grades the
book in sample, rather than reporting a near-zero as a result.

Try it: {{PUBLIC_URL}}
Code: {{REPO_URL}}
API: /api/v1/panel · /api/v1/alerts · /export/panel.csv
```

## Gallery images

Devpost: up to 15, JPG/PNG, ≤ 5 MB, 3:2 preferred. All are captured from the running desk at
1200×800 and live in `review/thumbs/`. Upload in this order; the first image is what the
gallery grid shows largest.

| # | File | Caption to paste |
|---|---|---|
| 1 | `thumbnail-3x2.png` | The desk answers in one sentence. The chip says IN-SAMPLE because the held-out slice is empty — not because the test was skipped. |
| 2 | `gallery-evidence.png` | The grade before the table: 0 of 80 flagged, the out-of-sample cell labelled "not a test", and all three null p-values printed to three decimals. |
| 3 | `gallery-vintage.png` | The finding that changed the product. Qloo's series stops moving on 2025-12-22; the final 44 of 102 weeks are carry-forward, and all 35 scored weeks sit inside them. |
| 4 | `gallery-holding.png` | One name, fully opened. DIS: market beta, cultural beta, t, q, the basket it was priced against, and the dispersion warning that says this is a reading with its error, not a ranking. |
| 5 | `gallery-map.png` | The taste map: market beta against cultural beta for every priced name, so a reader can see the book's shape in one glance. |
| 6 | `gallery-read.png` | The same result in plain English, including the four things that would prove the desk wrong. |
| 7 | `phone-desk.png` (from `review/shots-2026-10-30T16-57-11/`) | On a phone, the frozen-slice disclosure survives the first screen. Cropped to 3:2 before upload. |

## Thumbnail

`review/thumbs/thumbnail-3x2.png` — 1200×800, the desk's own hero. Title, verdict and the
window pill are legible at grid size; the table is not shown because at thumbnail scale it
turns to grey noise.
