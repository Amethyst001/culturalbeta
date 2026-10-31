# Devpost submission text — DRAFT for the owner (not the submission; owner lifts and edits)

> Draft prepared 2026-10-31 ~02:25. Everything below is derivable from committed files and
> served endpoints. Voice: the desk's own. No investment advice, no overclaim. Replace the
> links if the owner uses a different demo URL. Numbers: 102 weeks, 80/101 priced, 0/80
> flags, mean ΔR² +0.67 pts, MDE 13.66 pts, replay DIS 52.775 → 43.809, tests 177/177,
> audit 641/641.

---

## Cultural Beta — taste as a priced risk factor, with the receipt attached

**Links.** Demo: https://culturalbeta.ktnamethyst.me · Repo: https://github.com/Amethyst001/culturalbeta (MIT)

### Inspiration

Market beta says how a stock moves with the index. It says nothing about *why* a consumer
name moves — and taste is the part of consumer demand that data vendors like Qloo can now
see weekly. The hackathon rule was blunt: if the submission works the same without Qloo,
it's the wrong thing. So we built the desk around a harder question than "can we show a
Qloo number?" — **can Qloo's taste data survive being treated as a priced risk factor,
under the same discipline a quant desk applies to any other factor?** The agent exists
because that question has to be answered at inference time, on live data, in front of you.

### What it does

A consumer-equity research desk covering **101 US consumer names across 11 sub-sectors**:

- **The book** — every name priced two ways: market beta against SPY, and **cultural beta**
  against its sub-sector's taste basket, built by blending Qloo's weekly
  `population_percentile` trends with Qloo affinities. Per-name OLS on 102 aligned weeks,
  sortable, searchable, one click from each row to its full evidence page.
- **The verdict, stated as a measurement** — 0 of 80 priced names clear the pre-registered
  flag rule (negative cultural beta, |t| ≥ 2, Benjamini–Hochberg q ≤ 0.10 across the book).
  The desk does not hide the null; it sizes it: the design detects a ΔR² of 13.7 points at
  80% power, the book's in-sample increment is 0.67 points — about 20× smaller. **That is a
  resolution reading, not an absence claim.**
- **The agent, with receipts** — ask anything; a bounded multi-provider agent answers with
  desk tools (rank holdings, open a name, compare, show the factor). Every answer carries
  the Qloo calls behind it: endpoints, entity ids, correlation ids, page counts, spend.
- **The freshness gate — and this is the part that makes Qloo load-bearing.** Before an
  answer that states a beta is served, the *server* (not the model) asks Qloo about the
  entities the question cites and stamps the result `att-<12-hex>` — a SHA-256 over the
  visible fields — above the answer. Three states: `pass`, `moved`, `unattested`.
- **On `moved`, the gate is the estimator.** If Qloo has revised, the server re-runs the
  live estimator for the affected names and prints committed vs re-estimated beta, t and
  ΔR² side by side, in the answer payload. This fired on real data: after two basket
  entities reported a 2025-12-15 revision, Disney re-estimated **52.77 → 43.81**.
- **The revision replay** — one flag (`?replay=1`, or a JSON endpoint, or an ask parameter)
  re-serves the desk as it stood at the 2025-12-01 vintage against the committed panel:
  same estimator, per-vintage BH, integrity-checked. Median |Δβ| 0.589, 0 flag flips,
  47 pages replayed, **0 new Qloo requests**. Labelled on screen: *Replay · not a live
  revision*. No simulated data anywhere.
- **A published red team** — an adversarial pass attacked our own null and is shipped with
  the repo: the 0/80 survives every variant tried; one per-name held-out presentation was
  found to be an artifact (a frozen test basket) and is now gated off every surface behind
  a per-row `oosTestable` flag — frozen rows print "no test", never a number.

### How we built it

Node.js (ESM), zero runtime dependencies on the desk path. All Qloo access goes through
the official `@qloo/qloo-harness` CLI with correlation ids; a page-hash cache and hard caps
(≤ 400 calls/series) bound spend; the replay path re-serves cached responses at zero cost.
The agent fleet (Opus 5.5 / GPT-OSS 120B / GLM / MiniMax fallbacks) runs a read-only tool
loop with 429 backoff and bounded rounds; answers are post-processed to strip reasoning
scratchpads (including one untagged variant we caught live). Statistical layer: per-name
OLS, Benjamini–Hochberg across the book, rotation/permutation/block placebos, basket-
construction falsification (three alternative constructions), and a pre-registered
minimum-detectable-effect analysis **published before any external review saw the result**.
Verification: **177 unit tests** and a **641-check Chrome-DevTools-Protocol browser audit**
across 8 routes × 3 viewports, both committed and re-runnable with one command.

### Challenges

The honest one: **Qloo's taste series last moved in the week ending 2025-12-22**, so the
pre-registered held-out slice has an identically-zero regressor for every name — there is
no out-of-sample test at this vintage, and the desk says so in those words. We made the
call to ship the instrument and the re-test commitment (first post-submission Qloo vintage
that moves percentiles → full re-run within 10 business days; otherwise "still frozen",
dated 2027-01-31) rather than manufacture a testable-looking number. A revision-replay
defect (the probe window ended before the revision it was looking for) had to be found and
fixed the night before the deadline; the desk's own red team then caught our OOS
presentation — both fixes are in the repo with tests.

### What we learned

- **A null is a result only if you size it.** Publishing the MDE next to the measured
  effect is what separates "we found nothing" from "nothing this size could have been
  missed."
- **Attestation is cheap; dependency is not.** The difference between decorating an answer
  with a freshness badge and making the vendor's data an inference *input* is whether the
  estimator re-runs when the feed moves. Reviewers pushed us there, and they were right.
- The desk's most credible sentence is the one that costs it: *the held-out slice cannot
  test anything at this vintage.*

### What's next / who it's for

The build is a **diligence and revision-audit instrument for teams already buying Qloo** —
the seat a quant or risk team needs to know when a taste factor is stale and what
re-estimating actually does. Next: the dated re-test when Qloo's percentiles move; more
live tools; a state-of-the-desk screen. No revenue is claimed; no performance is claimed;
the only performance claim the desk makes is about its own resolution.

### Built with

node.js · @qloo/qloo-harness · Qloo trends + insights APIs · vanilla ES modules ·
Chrome DevTools Protocol · nginx + systemd
