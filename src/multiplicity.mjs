// Benjamini–Hochberg q-values. A hundred names means a hundred |t| tests on the
// same factor; an uncorrected |t| >= 2 screen flags about five names by chance
// alone, so the flag rule screens on t and confirms on q.
export function benjaminiHochberg(pvals) {
  const n = pvals.length;
  if (!n) return [];
  const order = pvals.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  const q = new Array(n);
  let running = 1;
  for (let k = n - 1; k >= 0; k--) {
    const [p, i] = order[k];
    running = Math.min(running, (p * n) / (k + 1));
    q[i] = Math.min(1, running);
  }
  return q;
}
