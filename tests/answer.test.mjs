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
