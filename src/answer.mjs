// Reasoning models sometimes put their scratchpad in `content` and then forget to
// close the tag: observed from dahl MiniMax M2.7 as `<think>Now I can see ... Let me
// explain this clearly to the user.\n\n<answer>`, with no closing tag at all. A
// closed-pair regex leaves that whole scratchpad on screen in front of the answer.
const OPEN_THINK = /<(think|thinking|scratchpad)>/i;
const CLOSED_THINK = /<(think|thinking|scratchpad)>[\s\S]*?<\/\1>/gi;
const ANY_TAG = /<\/?(think|thinking|scratchpad)>/gi;

export function cleanAnswer(raw) {
  const text = String(raw ?? "").trim();
  let out = text.replace(CLOSED_THINK, "");
  if (OPEN_THINK.test(out)) {
    // Unclosed: the model put the answer after its scratchpad and marked the seam with
    // an extra blank line — observed as "...Let me explain this clearly to the user.\n\n\n
    // Disney's cultural beta ...". Without that seam, the first blank line is the best
    // available cut. If there is no break at all there is nothing to cut against, so the
    // opener is removed and the text left as-is: visible scratchpad is still better than
    // a silently empty answer.
    const seam = out.search(/\r?\n\r?\n\r?\n/);
    if (seam > -1) out = out.slice(out.indexOf("\n", seam) + 1).replace(/^\s*\n/, "");
    else {
      const cut = out.search(/\r?\n\r?\n/);
      out = cut > -1 ? out.slice(cut).replace(/^\s+/, "") : out;
    }
  }
  return out.replace(ANY_TAG, "").trim() || text.replace(ANY_TAG, "").trim() || text;
}
