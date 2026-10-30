import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanAnswer } from "../src/answer.mjs";

test("a closed scratchpad is removed and the answer kept", () => {
  assert.equal(cleanAnswer("<think>step 1\n\nstep 2</think>The answer is 1."), "The answer is 1.");
  assert.equal(cleanAnswer("<thinking>hmm</thinking> Done."), "Done.");
});

test("an unclosed scratchpad is cut at the seam the model left", () => {
  // Real shape from dahl MiniMax M2.7, captured from the deployed desk on 2026-10-30:
  // the scratchpad runs for four paragraphs and the answer starts after an extra
  // blank line. Cutting at the first blank line would keep the scratchpad.
  const raw = "<think>Now I can see the full picture.\n\nBut more importantly, the flag state shows.\n\nSo there are two reasons.\n\nLet me explain this clearly to the user.\n\n\nDisney's cultural beta of 43.81 has a raw p of 0.0021.\n\nThe flag rule cannot run.";
  const out = cleanAnswer(raw);
  assert.equal(out.startsWith("Disney's cultural beta of 43.81"), true);
  assert.equal(/think|Let me explain/i.test(out), false, "no scratchpad survives");
  assert.equal(out.includes("The flag rule cannot run."), true, "the whole answer survives");
});

test("without a seam the first blank line is the best cut", () => {
  assert.equal(cleanAnswer("<think>scratch\n\nAnswer here."), "Answer here.");
});

test("a scratchpad with no break at all leaves text rather than nothing", () => {
  const out = cleanAnswer("<think>only scratchpad");
  assert.equal(out, "only scratchpad");
  assert.equal(/</.test(out), false);
});

test("a plain answer is untouched", () => {
  assert.equal(cleanAnswer("Plain answer."), "Plain answer.");
  assert.equal(cleanAnswer("  spaced  "), "spaced");
});

test("the committed panel question is never mangled by cleaning", () => {
  // Guards the real failure mode: a cleaner that trims a legitimate multi-paragraph
  // answer. Every paragraph of a tag-free answer must survive intact.
  const body = "First point.\n\nSecond point.\n\nThird point.";
  assert.equal(cleanAnswer(body), body);
});

test("an untagged scratchpad before a three-newline seam is dropped", () => {
  // The exact shape MiniMax M2.7 returned on 2026-10-30 through the fallback chain.
  const raw = "2. Even in-sample, the BH q = 0.164 exceeds the 0.10 threshold\n\n"
    + "The detectability data shows the effect is only 75.8% of what is needed.\n\n\n"
    + "Disney is not flagged for two reasons. The flag rule requires an out-of-sample test, "
    + "and the held-out slice is frozen at this Qloo vintage, so the test cannot complete.";
  const out = cleanAnswer(raw);
  assert.equal(out.startsWith("Disney is not flagged for two reasons."), true, "the answer is kept");
  assert.equal(/Even in-sample/.test(out), false, "the scratchpad is gone");
});

test("a short tail after a seam is not treated as the answer", () => {
  const raw = "A long first paragraph that is the answer.\n\n\nEnd.";
  assert.equal(cleanAnswer(raw), raw);
});
