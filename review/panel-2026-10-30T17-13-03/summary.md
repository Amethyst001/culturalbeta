# External review panel — 2026-10-30T17-13-03

Brief: `review/brief-round8.md`

## NVIDIA NIM / Nemotron 3.5 Super VL 120B

- verdict: **FIX FIRST** · total **38/100**
- scores: TI 12/25 · Design 9/25 · Impact 7/25 · Idea 10/25
- fatal: The held-out test has zero power because the scored regressor is identically zero across all 35 weeks, and the two hard gates (public repo, external hosting) are unmet, so the entry is neither externally reviewable nor statistically falsifiable.
- best next construction: A live judge-facing tool that lets the agent resolve an off-book consumer entity via Qloo, pull its trend series, and recompute that name's cultural beta in real time, making Qloo load-bearing at inference.
- headline rewrite: Cultural beta fails to predict consumer stock returns: a transparent null result with a chatbot attached.
- judge in 60s: A consumer equity screener that added Qloo 'cultural beta' to market beta, found no significant signal, and attached a slow chatbot that reads static files; no public repo and no live URL.
- must_fix:
  - Make the repo public with the MIT license visible in the About section.
  - Deploy external hosting with TLS on the Oracle VM.
  - Replace the 45-second fallback LLM path with a sub-second deterministic answer bank for the demo so a cold judge does not wait.
  - Stop reporting 'no test' as a result; declare the held-out test invalid due to an identically zero regressor and publish pre-registered effect-size bounds.
  - Attach an exact Qloo receipt (endpoint, entity IDs, timestamp) to every agent answer.
- method_objections:
  - The held-out regressor is identically zero for all 35 scored weeks (carry-forward tail), so the test has zero power at any effect size.
  - 44 of 102 weeks are carry-forward from the last Qloo revision (2025-12-22); the taste basket is stale for 43% of the sample.
  - 18 of 101 names are unresolved by Qloo, creating survivorship bias in the 80 priced names.
  - Mean in-sample ΔR² of +0.67 points is economically trivial and zero names survive Benjamini-Hochberg at q ≤ 0.10.
  - The dispersion test has 0% power at the observed spread, so the placebo suite cannot detect the effect it claims to rule out.
  - Weekly OLS with sector taste baskets is not shown to address autocorrelation or look-ahead bias.
- overstatements:
  - The agent answers with 'the exact Qloo request and the uncertainty' — the verified transcript is truncated by token limits and an earlier run overclaimed significance while omitting q = 0.164.
  - The entry 'would not work without Qloo' is true for the desk but false for the agent layer, which reads static JSON and makes no Qloo calls.
  - Calling the agent 'load-bearing' when it is a read-only Q&A layer over committed output files.
  - Presenting 'no test' as a valid output rather than an admission that the held-out slice is mechanically empty.

## BeatAPI / GLM 5.3 Flash (free)

- verdict: **FIX FIRST** · total **74/100**
- scores: TI 21/25 · Design 17/25 · Impact 17/25 · Idea 19/25
- fatal: Two unmet hard gates (public repo, external hosting) plus a 45-second cold answer latency on a rate-limited fallback provider — a judge clicking the demo right now sees a blank screen or waits three-quarters of a minute.
- best next construction: The live Qloo tool: agent resolves one off-book consumer entity via the harness, fetches its trend series, and runs the precomputed regression spec against the sector basket at inference time, returning a beta, a t, and an honest 'no flag possible this vintage' caveat — the agent becomes the only way a name enters the desk, not a narrator of it.
- headline rewrite: An agentic research desk that asks, and can falsify, whether Qloo taste data carries equity-return signal — with every answer cited to a Qloo response.
- judge in 60s: A statistical desk that tests whether Qloo cultural-taste data predicts consumer equity returns beyond the market, with falsification placebos, and an agent you ask questions of that cites exact rows and Qloo provenance. First minute should show: one name (Disney), why it fails the flag rule, one live agent answer with tool trace.
- must_fix:
  - Make the repo public and finish vhost+TLS on the Oracle VM — these are pass/fail gates, do them before any agent work
  - Ship the live Qloo tool (one resolve + one trend fetch per session, hard cap) so the agent makes Qloo calls at inference
  - Fix the 45s latency: cap rounds at 2 for the demo, trim tool results to the fields the prompt needs, stream partial answers so a judge sees progress at second 3
  - Replace the rate-limited primary with a provider that works cold; test the demo path at 04:00 UTC from a clean browser
  - Preload the #/ask page with 4-5 one-click example questions so the judge never types
  - Verify the 12 new agent tests actually run and pass before submission
- method_objections:
  - The held-out test has literally zero power: all 35 scored weeks use a carry-forward regressor that is identically zero. Printing 'no test' is honest but it means the headline deliverable — out-of-sample validation — does not exist at this vintage, and no amount of in-sample ΔR² compensates.
  - The dispersion test power calculation (0% at observed spread) means the entire falsification battery can only detect implausibly huge effects; the placebos (p 0.78–0.90) are consistent with 'no signal' AND with 'signal too small to see'. The entry should say which.
  - In-sample ΔR² of +0.67 points across 80 names is economically negligible; even with BH discipline, the natural interpretation is that sector-level Qloo taste baskets add essentially nothing over SPY. That is a publishable null, not a positive result.
  - Trend basket construction via 10 seeded entities with Qloo affinity ranks is opaque — the basket composition changes the beta, and there is no sensitivity analysis on basket composition (e.g., 5 vs 10 seeds).
  - 102 weekly observations with two regressors leaves thin power per name; |t|≥2 plus BH q≤0.10 across 80 names is a very conservative joint bar, fine for honesty, but it guarantees the null flag count.
- overstatements:
  - 'Desk prints no test rather than a negative' is presented as rigor but it also means the entry cannot demonstrate the pipeline produces a decision — a system whose headline output is 'uninformative' needs to be framed as such, not as a feature.
  - The agent transcript is called 'verified against the panel' but the same question previously produced an overclaim ('significant' without q) — the system prompt is a mitigation, not a guarantee; do not present the agent as reliable.
  - 83/101 resolution is reported but the entry does not surface which important names failed to resolve or why 18 unresolved entities were dropped — a judge will ask.

## dahl / MiniMax M2.7

_Unavailable: 502 <!DOCTYPE html>
<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->
<!--[if IE 7]>    <html class="no-js ie7 oldie" lang="en-US"> <![endif]-->
<!--[if IE 8]>    <html class="no-js ie8 oldie" lang="en-US"> <![endif]-->
<!--[if gt IE 8]><!--> <html class="no-js" lang="en-US"> <!_
