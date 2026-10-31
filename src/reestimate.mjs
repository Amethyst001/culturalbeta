// The gate was a witness: it could tell a reader that Qloo had revised, but the
// number in the answer stayed the committed one. This module makes the gate an
// input. When the freshness attestation reports a revision newer than the panel
// tail, the server re-runs the desk's own estimator on the affected basket and the
// answer carries the re-estimated beta beside the committed one.
//
// Two rules keep it honest:
//   1. Nothing is invented. The re-estimate is produced by the same live tool the
//      analyst can call, over a fresh Qloo pull at the pipeline's depth.
//   2. The committed number is never overwritten. The answer prints both, with the
//      committed one labelled as the reading of record and the live one labelled as
//      computed at inference. A reader can always tell which is which.
//
// The orchestration is injectable so it can be tested without a key: `run` is the
// live tool's run function.

const fmt = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v).toFixed(d));

function nameOf(m) {
  const ticker = m?.entity?.ticker ?? m?.ticker ?? "?";
  const label = m?.entity?.name ? ` (${m.entity.name})` : "";
  return `${ticker}${label}`;
}

// Re-estimate up to `max` of the revised names. Sequential, so the daily budget
// journal is written by one call at a time and a failure stops the loop instead of
// spending on the rest.
export async function reestimateAfterRevision({ moved = [], run, max = 2 } = {}) {
  const tickers = [];
  for (const m of moved) {
    const t = m?.entity?.ticker ?? m?.ticker;
    if (t && !tickers.includes(t) && tickers.length < max) tickers.push(t);
  }
  if (!tickers.length) return { triggered: false, reason: "no_revised_name_in_book", tickers: [], results: [] };
  if (typeof run !== "function") return { triggered: false, reason: "no_live_tool", tickers, results: [] };

  const results = [];
  let spent = 0, replayed = 0, pages = 0;
  for (const ticker of tickers) {
    let out;
    try {
      out = await run({ ticker });
    } catch (e) {
      results.push({ ticker, ok: false, error: String(e?.code ?? e?.message ?? "live_failed") });
      continue;
    }
    if (!out || out.error) {
      results.push({ ticker, ok: false, error: out?.error ?? "live_failed", code: out?.code ?? null });
      continue;
    }
    spent += Number(out.qloo?.requests ?? 0);
    replayed += Number(out.qloo?.replayedPages ?? 0);
    pages += Number(out.qloo?.pages ?? 0);
    results.push({
      ticker,
      ok: true,
      committed: out.committed ?? null,
      live: out.live?.cultural ?? null,
      deltaR2: out.live?.deltaR2 ?? null,
      change: out.change ?? null,
      weeks: out.window ?? null,
      requests: out.qloo?.requests ?? 0,
      replayedPages: out.qloo?.replayedPages ?? 0,
      correlationIds: out.qloo?.correlationIds ?? [],
      files: out.qloo?.files ?? [],
    });
  }
  return { triggered: results.some((r) => r.ok), tickers, results, spent, replayed, pages };
}

// The sentence the answer carries. Server-authored, not model-authored: the model
// may still be describing the committed number, so the addendum states which
// number is which and never replaces the body.
export function revisionAddendum({ moved = [], reestimation = null, caveat = null } = {}) {
  const tailNote = caveat ? ` ${caveat}` : "";
  const names = moved.map(nameOf).join(", ");
  if (!reestimation?.results?.length) {
    return `Live revision check: Qloo reports a revision newer than this panel (${names || "an attested name"}). The re-estimate could not run${reestimation?.reason ? ` (${reestimation.reason})` : ""}, so the numbers above are the committed panel and are stale against the live feed.${tailNote}`;
  }
  const ok = reestimation.results.filter((r) => r.ok);
  const failed = reestimation.results.filter((r) => !r.ok);
  if (!ok.length) {
    return `Live revision check: Qloo reports a revision newer than this panel (${names || "an attested name"}), but the live re-estimate returned no number (${failed.map((r) => `${r.ticker}: ${r.error}`).join("; ")}). The numbers above are the committed panel.${tailNote}`;
  }
  const lines = ok.map((r) => {
    const before = fmt(r.committed?.culturalBeta, 2);
    const after = fmt(r.live?.beta, 2);
    const tBefore = fmt(r.committed?.culturalT, 2);
    const tAfter = fmt(r.live?.t, 2);
    const r2Before = fmt(r.committed?.deltaR2, 4);
    const r2After = fmt(r.deltaR2, 4);
    return `${r.ticker}: cultural beta ${before} → ${after} (t ${tBefore} → ${tAfter}; ΔR² ${r2Before} → ${r2After})`;
  });
  const spend = reestimation.spent
    ? `${reestimation.spent} new Qloo request${reestimation.spent === 1 ? "" : "s"}, ${reestimation.replayed} replayed from the page cache`
    : `${reestimation.replayed} pages replayed from the page cache, no new Qloo request`;
  const tail = failed.length ? ` ${failed.map((r) => `${r.ticker}: ${r.error}`).join("; ")}.` : "";
  return `Re-estimated at inference because Qloo revised after this panel was built — ${lines.join("; ")}. The first number in each pair is the committed reading of record; the second is the same estimator re-run on a fresh pull at the pipeline's depth (${spend}).${tail}${tailNote}`;
}

// What the payload exposes to the UI, kept separate from the prose so a page can
// render the pair as a table rather than re-parsing the sentence.
export function revisionPayload(reestimation, moved = []) {
  if (!reestimation) return null;
  return {
    triggered: Boolean(reestimation.triggered),
    reason: reestimation.reason ?? null,
    tickers: reestimation.tickers ?? [],
    moved: moved.map((m) => ({
      ticker: m?.entity?.ticker ?? m?.ticker ?? null,
      name: m?.entity?.name ?? null,
      latestRevision: m?.latestRevision ?? null,
    })),
    spent: reestimation.spent ?? 0,
    replayed: reestimation.replayed ?? 0,
    results: (reestimation.results ?? []).map((r) => ({
      ticker: r.ticker,
      ok: r.ok,
      error: r.error ?? null,
      committed: r.ok ? { beta: r.committed?.culturalBeta ?? null, t: r.committed?.culturalT ?? null, deltaR2: r.committed?.deltaR2 ?? null } : null,
      live: r.ok ? { beta: r.live?.beta ?? null, t: r.live?.t ?? null, deltaR2: r.deltaR2 ?? null, weeks: r.weeks?.liveWeeks ?? null } : null,
      change: r.change ?? null,
      requests: r.requests ?? 0,
      replayedPages: r.replayedPages ?? 0,
      correlationIds: r.correlationIds ?? [],
    })),
  };
}
