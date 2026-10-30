// Pooled panel estimator: one cultural beta per sub-sector instead of one per name.
//
// The per-name fits are identified only on the weeks a sector basket actually
// moves (19-31 of 102), so each slope is a wide, unstable number. Pooling keeps
// the same variation but shares one slope across the names in a sub-sector, which
// is the restriction the per-name results cannot test on their own. Name fixed
// effects are swept out by within-transformation — no dummy matrix, no rank
// problem — and the market slope is one common coefficient, stated as such.
//
// Inference clusters by week: every name is scored on the same calendar, so
// week-to-week shocks are shared across the book and i.i.d. standard errors would
// be too small. The null permutes the week order of the baskets, the same
// construction the book-level placebos use, so the pooled verdict is comparable
// with the rest of the desk.

const mean = (a) => { let s = 0; for (const v of a) s += v; return s / a.length; };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

function matVec(M, v) {
  const out = new Array(M.length).fill(0);
  for (let i = 0; i < M.length; i++) for (let j = 0; j < v.length; j++) out[i] += M[i][j] * v[j];
  return out;
}

// Within-transform one series for one name: subtract that name's own mean.
function demean(col, n, k) {
  const out = new Float64Array(col.length);
  for (let i = 0; i < k; i++) {
    const off = i * n;
    let m = 0;
    for (let t = 0; t < n; t++) m += col[off + t];
    m /= n;
    for (let t = 0; t < n; t++) out[off + t] = col[off + t] - m;
  }
  return out;
}

function tP(t, df) {
  // Two-sided Student t, same incomplete-beta route as src/ols.mjs.
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return NaN;
  const x = df / (df + t * t);
  return ibeta(x, df / 2, 0.5);
}

function lgamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973462228e-2, -0.5395239384953e-5];
  let xx = x, y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++xx;
  return -tmp + Math.log((2.5066282746310005 * ser) / y);
}

function betacf(x, a, b) {
  const eps = 3e-14, fpmin = 1e-30;
  const qab = a + b, qap = a + 1, qam = a - 1;
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

function ibeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(x, a, b)) / a;
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

// Build the within-transformed design once; permutations only rebuild the
// cultural columns, which is the cheap part.
function design(items, sectorIds, perm) {
  const n = items[0].y.length;
  const k = items.length;
  const S = sectorIds.length;
  const indexOfSector = (id) => sectorIds.indexOf(id);
  const y = new Float64Array(k * n);
  const mkt = new Float64Array(k * n);
  const cul = Array.from({ length: S }, () => new Float64Array(k * n));
  const yRaw = new Float64Array(k * n);
  const xRaw = new Float64Array(k * n);
  const bRaw = Array.from({ length: S }, () => new Float64Array(k * n));
  for (let i = 0; i < k; i++) {
    const it = items[i], off = i * n;
    const s = indexOfSector(it.sector);
    for (let t = 0; t < n; t++) {
      yRaw[off + t] = it.y[t];
      xRaw[off + t] = it.x[t];
      bRaw[s][off + t] = it.basket[perm ? perm[t] : t];
    }
  }
  y.set(demean(yRaw, n, k));
  mkt.set(demean(xRaw, n, k));
  for (let s = 0; s < S; s++) cul[s].set(demean(bRaw[s], n, k));
  return { y, mkt, cul, n, k, S };
}

function fit(d, { ridge = 0, withCultural = true } = {}) {
  const { y, mkt, cul, n, k, S } = d;
  const N = k * n;
  const P = withCultural ? 1 + S : 1;
  // Column 0 is the common market slope; 1..S the sub-sector cultural slopes.
  const col = (j, off) => (j === 0 ? mkt[off] : cul[j - 1][off]);
  const XtX = Array.from({ length: P }, () => new Array(P).fill(0));
  const Xty = new Array(P).fill(0);
  for (let r = 0; r < N; r++) {
    const row = [];
    for (let j = 0; j < P; j++) row.push(col(j, r));
    for (let a = 0; a < P; a++) {
      Xty[a] += row[a] * y[r];
      for (let b = 0; b < P; b++) XtX[a][b] += row[a] * row[b];
    }
  }
  let lambda = 0;
  if (ridge > 0 && withCultural) {
    // One penalty scale for every sub-sector — the mean cultural diagonal — so a
    // basket that barely moves is shrunk toward zero and the rest are not.
    let diagSum = 0;
    for (let j = 1; j < P; j++) diagSum += XtX[j][j];
    lambda = ridge * (diagSum / (P - 1) || 1);
    for (let j = 1; j < P; j++) XtX[j][j] += lambda;
  }
  const inv = invert(XtX);
  if (!inv) throw new Error("panel: singular design");
  const beta = matVec(inv, Xty);
  const u = new Float64Array(N);
  let sse = 0, sst = 0;
  for (let r = 0; r < N; r++) {
    let yhat = 0;
    for (let j = 0; j < P; j++) yhat += beta[j] * col(j, r);
    u[r] = y[r] - yhat;
    sse += u[r] * u[r];
    sst += y[r] * y[r];
  }
  // Cluster-robust covariance by week: the sandwich with week sums of X'u.
  const meat = Array.from({ length: P }, () => new Array(P).fill(0));
  for (let t = 0; t < n; t++) {
    const g = new Array(P).fill(0);
    for (let i = 0; i < k; i++) {
      const r = i * n + t;
      for (let j = 0; j < P; j++) g[j] += col(j, r) * u[r];
    }
    for (let a = 0; a < P; a++) for (let b = 0; b < P; b++) meat[a][b] += g[a] * g[b];
  }
  const G = n;
  const adj = (G / (G - 1)) * ((N - 1) / (N - P));
  const invMeat = [];
  for (let i = 0; i < P; i++) {
    invMeat.push([]);
    for (let j = 0; j < P; j++) {
      let s = 0;
      for (let a = 0; a < P; a++) for (let b = 0; b < P; b++) s += inv[i][a] * meat[a][b] * inv[j][b];
      invMeat[i].push(s * adj);
    }
  }
  return {
    beta: beta.slice(), se: invMeat.map((row, j) => Math.sqrt(Math.max(0, row[j]))),
    r2: sst === 0 ? null : 1 - sse / sst, sse, sst, lambda,
  };
}

// Same panel, but each name keeps its own market loading instead of sharing one.
// A common slope of 0.75 across 80 names is an assumption the per-name claim
// depends on being false, so the restriction is removed rather than argued about:
// each name's return is first regressed on its own market return (within-name), and
// the residual — the part of the return no market loading can explain — is what the
// cultural columns are fitted to. That is algebraically the same as a name × market
// interaction with name fixed effects, done in two passes so the design stays small.
function fitCulturalOnly(d, yResid, { ridge = 0 } = {}) {
  const { cul, n, k, S } = d;
  const N = k * n;
  const col = (j, off) => cul[j][off];
  const XtX = Array.from({ length: S }, () => new Array(S).fill(0));
  const Xty = new Array(S).fill(0);
  for (let r = 0; r < N; r++) {
    const row = [];
    for (let j = 0; j < S; j++) row.push(col(j, r));
    for (let a = 0; a < S; a++) {
      Xty[a] += row[a] * yResid[r];
      for (let b = 0; b < S; b++) XtX[a][b] += row[a] * row[b];
    }
  }
  let lambda = 0;
  if (ridge > 0) {
    let diagSum = 0;
    for (let j = 0; j < S; j++) diagSum += XtX[j][j];
    lambda = ridge * (diagSum / S || 1);
    for (let j = 0; j < S; j++) XtX[j][j] += lambda;
  }
  const inv = invert(XtX);
  if (!inv) throw new Error("panel: singular cultural design");
  const beta = matVec(inv, Xty);
  const u = new Float64Array(N);
  let sse = 0;
  for (let r = 0; r < N; r++) {
    let yhat = 0;
    for (let j = 0; j < S; j++) yhat += beta[j] * col(j, r);
    u[r] = yResid[r] - yhat;
    sse += u[r] * u[r];
  }
  const meat = Array.from({ length: S }, () => new Array(S).fill(0));
  for (let t = 0; t < n; t++) {
    const g = new Array(S).fill(0);
    for (let i = 0; i < k; i++) {
      const r = i * n + t;
      for (let j = 0; j < S; j++) g[j] += col(j, r) * u[r];
    }
    for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) meat[a][b] += g[a] * g[b];
  }
  const G = n;
  const adj = (G / (G - 1)) * ((N - 1) / (N - S));
  const se = [];
  for (let j = 0; j < S; j++) {
    let s = 0;
    for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) s += inv[j][a] * meat[a][b] * inv[j][b];
    se.push(Math.sqrt(Math.max(0, s * adj)));
  }
  let sst = 0;
  for (let r = 0; r < N; r++) sst += yResid[r] * yResid[r];
  return { beta: beta.slice(), se, sse, sst, lambda, r2: sst === 0 ? null : 1 - sse / sst };
}

export function panelNameMarket(items, { ridge = 0.05, permDraws = 400, seed = 20261029 } = {}) {
  if (!items.length) throw new Error("panel: no holdings");
  const n = items[0].y.length;
  if (items.some((it) => it.y.length !== n || it.basket.length !== n || it.x.length !== n)) {
    throw new Error("panel: series length mismatch");
  }
  const sectorIds = [...new Set(items.map((it) => it.sector))].sort();
  const k = items.length;
  const N = k * n;

  // Pass one: strip each name's own market loading, leaving the part of its return
  // a market beta cannot explain.
  const residualise = (d) => {
    const out = new Float64Array(N);
    let sse = 0;
    const betas = [];
    for (let i = 0; i < k; i++) {
      const off = i * n;
      let sxx = 0, sxy = 0;
      for (let t = 0; t < n; t++) { sxx += d.mkt[off + t] ** 2; sxy += d.mkt[off + t] * d.y[off + t]; }
      const b = sxx > 0 ? sxy / sxx : 0;
      betas.push(b);
      for (let t = 0; t < n; t++) {
        out[off + t] = d.y[off + t] - b * d.mkt[off + t];
        sse += out[off + t] ** 2;
      }
    }
    return { resid: out, sse, betas };
  };

  const base = design(items, sectorIds, null);
  const m1 = residualise(base);
  let sstWithin = 0;
  for (let r = 0; r < N; r++) sstWithin += base.y[r] ** 2;
  const full = fitCulturalOnly(base, m1.resid);
  const ridged = ridge > 0 ? fitCulturalOnly(base, m1.resid, { ridge }) : null;

  const rnd = mulberry32(seed);
  const realDelta = full.r2;
  let ge = 0, sum = 0;
  const draws = [];
  for (let d = 0; d < permDraws; d++) {
    const perm = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    const pd = design(items, sectorIds, perm);
    const dm = residualise(pd);
    const pf = fitCulturalOnly(pd, dm.resid);
    draws.push(pf.r2); sum += pf.r2;
    if (pf.r2 >= realDelta) ge++;
  }
  const sorted = [...draws].sort((a, b) => a - b);
  const df = n - 1;

  const bySector = sectorIds.map((id, s) => {
    const b = full.beta[s], se = full.se[s];
    const t = se > 0 ? b / se : Infinity;
    return { id, names: items.filter((it) => it.sector === id).length, beta: b, se, t, p: tP(Math.abs(t), df), ridgeBeta: ridged ? ridged.beta[s] : null };
  });

  return {
    names: k,
    obs: N,
    weeks: n,
    sectors: [...bySector].sort((a, b) => a.beta - b.beta),
    market: (() => {
      const meanB = m1.betas.reduce((a, b) => a + b, 0) / k;
      return {
        meanBeta: meanB,
        min: Math.min(...m1.betas),
        max: Math.max(...m1.betas),
        sd: Math.sqrt(m1.betas.reduce((s, b) => s + (b - meanB) ** 2, 0) / (k - 1)),
      };
    })(),
    withinR2: { marketOnly: 1 - m1.sse / sstWithin, full: 1 - full.sse / sstWithin },
    deltaR2: realDelta,
    null: { draws: permDraws, seed, real: realDelta, p: (1 + ge) / (1 + permDraws), mean: sum / permDraws, p95: sorted[Math.min(sorted.length - 1, Math.floor(permDraws * 0.95))] },
    ridge: ridged ? { factor: ridge, lambda: ridged.lambda } : null,
    note: "post-hoc addition after external review: each name keeps its own market loading (partialled out first), name fixed effects swept out, one cultural slope per sub-sector, standard errors clustered by week",
  };
}

export function pooledPanel(items, { ridge = 0.05, permDraws = 400, seed = 20261029 } = {}) {
  if (!items.length) throw new Error("panel: no holdings");
  const n = items[0].y.length;
  if (items.some((it) => it.y.length !== n || it.basket.length !== n || it.x.length !== n)) {
    throw new Error("panel: series length mismatch");
  }
  const sectorIds = [...new Set(items.map((it) => it.sector))].sort();
  const total = design(items, sectorIds, null);
  const marketOnly = fit(total, { withCultural: false });
  const full = fit(total, { withCultural: true });
  const ridged = ridge > 0 ? fit(total, { withCultural: true, ridge }) : null;
  const df = n - 1;
  const live = total.k;

  const rnd = mulberry32(seed);
  const realDelta = full.r2 - marketOnly.r2;
  let ge = 0, sum = 0;
  const draws = [];
  // The permutation only reshuffles the cultural columns; y and the market column
  // never move, so the market-only fit is the same in every draw.
  const marketR2 = marketOnly.r2;
  for (let d = 0; d < permDraws; d++) {
    const perm = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    const pd = design(items, sectorIds, perm);
    const pf = fit(pd, { withCultural: true });
    const delta = pf.r2 - marketR2;
    draws.push(delta); sum += delta;
    if (delta >= realDelta) ge++;
  }
  const sorted = [...draws].sort((a, b) => a - b);

  const bySector = sectorIds.map((id, s) => {
    const b = full.beta[1 + s], se = full.se[1 + s];
    const t = se > 0 ? b / se : Infinity;
    return {
      id,
      names: items.filter((it) => it.sector === id).length,
      beta: b, se, t,
      p: tP(Math.abs(t), df),
      ridgeBeta: ridged ? ridged.beta[1 + s] : null,
      ridgeShift: ridged ? ridged.beta[1 + s] - b : null,
    };
  });
  const sectors = [...bySector].sort((a, b) => a.beta - b.beta);

  return {
    names: live,
    obs: live * n,
    weeks: n,
    sectors,
    market: { beta: full.beta[0], se: full.se[0], t: full.se[0] > 0 ? full.beta[0] / full.se[0] : Infinity },
    withinR2: { marketOnly: marketOnly.r2, full: full.r2 },
    deltaR2: realDelta,
    ridge: ridged ? { factor: ridge, lambda: ridged.lambda, maxAbsShift: Math.max(...bySector.map((s) => Math.abs(s.ridgeShift ?? 0))) } : null,
    null: { draws: permDraws, seed, real: realDelta, p: (1 + ge) / (1 + permDraws), mean: sum / permDraws, p95: sorted[Math.min(sorted.length - 1, Math.floor(permDraws * 0.95))] },
    note: "post-hoc addition after external review: name fixed effects swept out by within-transformation, one common market slope, one cultural slope per sub-sector, standard errors clustered by week",
  };
}
