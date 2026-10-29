// Ordinary least squares with standard errors. Deterministic code, no model.
// y = b0 + b1*x1 + ... + bk*xk + e. Returns betas, SEs, t-stats, two-sided p-values.

function betacf(x, a, b) {
  const eps = 3e-14, fpmin = 1e-30;
  let qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpmin) d = fpmin;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c; if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d; h *= d * c;
    aa = -((a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c; if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < eps) break;
  }
  return h;
}

function lgamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973462228e-2, -0.5395239384953e-5];
  let xx = x, y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++xx;
  return -tmp + Math.log((2.5066282746310005 * ser) / y);
}

export function tDistP(t, df) {
  // two-sided p-value for Student t
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return NaN;
  const x = df / (df + t * t);
  return incompleteBetaRaw(x, df / 2, 0.5);
}

function incompleteBetaRaw(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(x, a, b)) / a;
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

// X is an array of rows; add intercept column if requested.
export function ols(y, xcols) {
  const n = y.length;
  if (n === 0) throw new Error("ols: empty y");
  const k = xcols.length;
  for (const col of xcols) if (col.length !== n) throw new Error("ols: regressor length mismatch");
  // design matrix rows: [1, x1, ..., xk]
  const p = k + 1;
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const row = [1, ...xcols.map((c) => c[i])];
    for (let a = 0; a < p; a++) {
      Xty[a] += row[a] * y[i];
      for (let b = 0; b < p; b++) XtX[a][b] += row[a] * row[b];
    }
  }
  const inv = invert(XtX);
  if (!inv) throw new Error("ols: singular XtX — check regressor collinearity");
  const beta = new Array(p);
  for (let a = 0; a < p; a++) {
    beta[a] = 0;
    for (let b = 0; b < p; b++) beta[a] += inv[a][b] * Xty[b];
  }
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const yhat = beta[0] + xcols.reduce((s, c, j) => s + beta[j + 1] * c[i], 0);
    sse += (y[i] - yhat) ** 2;
  }
  const df = n - p;
  if (df <= 0) throw new Error("ols: insufficient degrees of freedom");
  const sigma2 = sse / df;
  const se = inv.map((row, a) => Math.sqrt(sigma2 * row[a]));
  const t = beta.map((b, i) => (se[i] === 0 ? Infinity : b / se[i]));
  const pTwo = t.map((tv) => tDistP(Math.abs(tv), df));
  return { beta, se, t, p: pTwo, df, n, r2: 1 - sse / sst(y) };
}

function sst(y) {
  const m = y.reduce((s, v) => s + v, 0) / y.length;
  return y.reduce((s, v) => s + (v - m) ** 2, 0);
}

function invert(m) {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    if (Math.abs(a[piv][col]) < 1e-12) return null;
    [a[col], a[piv]] = [a[piv], a[col]];
    const d = a[col][col];
    for (let j = 0; j < 2 * n; j++) a[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col];
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[col][j];
    }
  }
  return a.map((row) => row.slice(n));
}
