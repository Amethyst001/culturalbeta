// The hackathon scores four criteria equally, /25 each. The panel is asked for the
// same four, so a returned score above 25 is a reviewer that did not use the rubric
// it was given. It is kept exactly as written and flagged: clamping it would turn a
// mis-scored review into an ordinary one, and the record is only worth something if
// the arithmetic a judge can redo is the arithmetic that was reported.
export const RUBRIC = ["technological_implementation", "design", "potential_impact", "quality_of_idea"];

export function auditScores(v = {}) {
  const errors = [];
  const s = v.scores ?? {};
  for (const k of RUBRIC) {
    const n = s[k];
    if (!Number.isFinite(n)) errors.push(`${k}: missing`);
    else if (n < 0 || n > 25) errors.push(`${k}: ${n} is outside 0–25`);
  }
  const sum = RUBRIC.reduce((a, k) => a + (Number.isFinite(s[k]) ? s[k] : 0), 0);
  if (Number.isFinite(v.score_total) && v.score_total !== sum) errors.push(`score_total ${v.score_total} ≠ sum ${sum}`);
  const inRange = RUBRIC.every((k) => Number.isFinite(s[k]) && s[k] >= 0 && s[k] <= 25);
  return { errors, sum, inRange, rubricTotal: inRange ? sum : null };
}
