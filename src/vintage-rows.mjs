// The replay desk is the panel as it stood at the pre-revision vintage. Every
// estimate printed as "committed" in replay mode must come from that same vintage
// row: beta, t and ΔR² together. Swapping only the beta (as the first cut did)
// paired a vintage beta with the 102-week t and ΔR², so the re-estimation table
// read "t 3.17 → 3.17" while beta moved 52.77 → 43.81.
export function vintageRowsFromMovers(movers = []) {
  const out = new Map();
  for (const m of movers ?? []) {
    const beta = Number(m?.betaBefore);
    if (!m?.ticker || !Number.isFinite(beta)) continue;
    const t = Number(m.tBefore);
    const d = Number(m.deltaR2Before);
    out.set(String(m.ticker), { beta, t: Number.isFinite(t) ? t : null, deltaR2: Number.isFinite(d) ? d : null });
  }
  return out;
}

export function applyVintageRows(rows = [], before = new Map()) {
  return rows.map((r) => {
    const v = before.get(String(r.ticker));
    if (!v) return r;
    const next = { ...r, culturalBeta: v.beta };
    if (v.t != null) next.culturalT = v.t;
    if (v.deltaR2 != null) next.deltaR2 = v.deltaR2;
    return next;
  });
}
