// Consumer-sentiment exclusion. The desk's claim is that the taste basket
// measures a *cultural* channel. The obvious rival is that it is a lagging
// consumer-confidence proxy: brands people search for and films they stream move
// with how confident they feel. So the factor has to survive a published
// sentiment index as a second regressor, not only the market and the sector.
//
// The index is the University of Michigan Consumer Sentiment Index (FRED:
// UMCSENT) — monthly, public, and not Qloo data, so the fixture can live in the
// repo. Monthly levels are step-filled to the weekly calendar and differenced
// across the month boundary; that is coarse by construction and is stated as
// coarse, because a monthly series cannot be made weekly by interpolation.
import { ols } from "./ols.mjs";

const MONTH_START = (iso) => iso.slice(0, 7);

// Each week carries the month-over-month change printed at the month it belongs
// to, zero elsewhere: the regressor moves four or five times a year, and the
// desk says so rather than inventing a weekly sentiment series.
export function alignSentiment(monthly, dates) {
  if (!monthly?.length) return null;
  const byMonth = new Map();
  for (const m of monthly) byMonth.set(MONTH_START(m.date), m.value);
  const months = [...byMonth.keys()].sort();
  const delta = new Map();
  for (let i = 1; i < months.length; i++) {
    const prev = byMonth.get(months[i - 1]);
    const cur = byMonth.get(months[i]);
    if (prev == null || cur == null) continue;
    delta.set(months[i], cur - prev);
  }
  const out = new Array(dates.length);
  for (let i = 0; i < dates.length; i++) {
    const d = delta.get(MONTH_START(dates[i]));
    out[i] = d == null ? 0 : d;
  }
  const moving = out.filter((v) => v !== 0).length;
  return { series: out, months: months.length, moving, monthsCovered: [...byMonth.keys()].filter((k) => delta.has(k)).length };
}

export function sentimentOos({ y, market, sentiment, basket, trainShare = 0.66 }) {
  const n = y.length;
  const k = Math.min(Math.max(Math.round(n * trainShare), 24), n - 12);
  const tr = (a) => a.slice(0, k);
  const te = (a) => a.slice(k);
  const base = ols(tr(y), [tr(market), tr(sentiment)]);
  const joint = ols(tr(y), [tr(market), tr(sentiment), tr(basket)]);
  const cols = [te(market), te(sentiment), te(basket)];
  const predict = (beta, m) => te(y).map((_, i) => beta[0] + cols.slice(0, m).reduce((s, c, j) => s + beta[j + 1] * c[i], 0));
  const yTe = te(y);
  const m = yTe.reduce((a, b) => a + b, 0) / yTe.length;
  const sst = yTe.reduce((s, v) => s + (v - m) ** 2, 0);
  const r2 = (yhat) => 1 - yTe.reduce((s, v, i) => s + (v - yhat[i]) ** 2, 0) / sst;
  const yhatBase = predict(base.beta, 2);
  const yhatJoint = predict(joint.beta, 3);
  const r2Base = r2(yhatBase);
  const r2Joint = r2(yhatJoint);
  return {
    trainWeeks: k,
    testWeeks: n - k,
    r2Base,
    r2Joint,
    tasteExtraOosR2: r2Joint - r2Base,
    sentimentBeta: joint.beta[2],
    sentimentT: joint.t[2],
    comp: { trainWeeks: k, testWeeks: n - k, yTe, yhatBase, yhatJoint },
  };
}

export function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da === 0 || db === 0 ? null : num / Math.sqrt(da * db);
}
