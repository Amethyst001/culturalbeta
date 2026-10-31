// The product surface must not sell the frozen held-out slice as a test: with the
// book's scored weeks frozen (valueAdd.oos.scoring.testable false) every ok row
// carries oosTestable:false and null OOS numbers in /api/v1/panel, the CSV export
// ships the per-row flag beside the emptied cells, and the alerts feed cannot arm.
// The server is spawned with the live gate off, so this test spends zero Qloo calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Quote-aware split: note cells may contain commas and are escaped by the server.
function csvLine(line) {
  const cells = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { cells.push(cur); cur = ""; }
    else cur += c;
  }
  cells.push(cur);
  return cells;
}

async function withDeskServer(run) {
  const child = spawn(process.execPath, [resolve(ROOT, "server/desk-server.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PORT: "0", AGENT_LIVE_QLOO: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(new Error("server did not start in 5s")), 5000);
      let buf = "";
      child.stdout.on("data", (c) => {
        buf += c;
        const m = buf.match(/localhost:(\d+)/);
        if (m) { clearTimeout(timer); ok(Number(m[1])); }
      });
      child.on("exit", (code) => fail(new Error(`server exited ${code}`)));
    });
    return await run(port);
  } finally {
    child.kill();
  }
}

test("a frozen held-out slice nulls every ok row's OOS numbers in the panel feed", async () => {
  await withDeskServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/api/v1/panel`);
    assert.equal(res.status, 200);
    const feed = await res.json();
    const sc = feed.valueAdd.oos.scoring;
    assert.equal(sc.testable, false, "committed desk is a frozen book; if a recompute moved the slice, this test's premise changed");
    const ok = feed.rows.filter((r) => r.status === "ok");
    assert.ok(ok.length > 0, "the book has priced rows");
    for (const r of ok) {
      assert.equal(r.oosTestable, false, `${r.ticker} must be marked not testable`);
      assert.equal(r.oosDeltaR2, null, `${r.ticker} oosDeltaR2 must be null`);
      assert.equal(r.oosDeltaR2FixedLo, null, `${r.ticker} fixed lo must be null`);
      assert.equal(r.oosDeltaR2FixedHi, null, `${r.ticker} fixed hi must be null`);
      assert.equal(r.oosDeltaR2RefitLo, null, `${r.ticker} refit lo must be null`);
      assert.equal(r.oosDeltaR2RefitHi, null, `${r.ticker} refit hi must be null`);
      assert.equal(r.oosClaimInterval, null, `${r.ticker} claim interval must be null`);
      assert.ok(r.audience == null || (r.audience.oosTestable === false && r.audience.oosDeltaR2 === null), `${r.ticker} audience OOS must be gated too`);
    }
    // The committed panel still carries the row-level artifact; the feed must not.
    const dis = ok.find((r) => r.ticker === "DIS");
    assert.ok(dis, "DIS is priced");
    assert.equal(dis.oosDeltaR2, null, "DIS -0.058 must not surface as a number");
    for (const r of feed.rows.filter((x) => x.status !== "ok")) {
      assert.equal(r.oosTestable, null, `${r.ticker} is unpriced: no OOS verdict either way`);
    }
  });
});

test("the CSV export carries the per-row oosTestable flag beside emptied OOS cells", async () => {
  await withDeskServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/export/panel.csv`);
    assert.equal(res.status, 200);
    const lines = (await res.text()).trim().split(/\r?\n/);
    const head = lines[0].split(",");
    const iT = head.indexOf("oosTestable");
    const iD = head.indexOf("oosDeltaR2");
    const iS = head.indexOf("status");
    const iTk = head.indexOf("ticker");
    assert.ok(iT >= 0, "header must name the per-row oosTestable column");
    assert.ok(iD >= 0, "header must keep the oosDeltaR2 column");
    const rows = lines.slice(1).map(csvLine);
    const ok = rows.filter((r) => r[iS] === "ok");
    assert.ok(ok.length > 0, "the book has priced rows");
    for (const r of ok) {
      assert.equal(r[iT], "false", `${r[iTk]} must carry oosTestable=false in the CSV`);
      assert.equal(r[iD], "", `${r[iTk]} must ship an empty oosDeltaR2 cell`);
    }
    const dis = rows.find((r) => r[iTk] === "DIS");
    assert.ok(dis, "DIS is in the export");
    assert.equal(dis[iT], "false");
    assert.equal(dis[iD], "");
  });
});

test("the alerts feed stays a watchlist while the held-out slice is frozen", async () => {
  await withDeskServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/api/v1/alerts`);
    assert.equal(res.status, 200);
    const alerts = await res.json();
    assert.equal(alerts.status, "watchlist-only", "a frozen slice cannot arm the feed");
    assert.equal(alerts.count, 0);
    assert.match(alerts.rule, /held-out slice testable/, "the printed rule must name the testable guard");
    for (const s of alerts.suppressed) {
      assert.equal(s.oosTestable, false, `${s.ticker} suppressed row is marked not testable`);
      assert.equal(s.oosDeltaR2, null, `${s.ticker} suppressed row carries no OOS number`);
    }
    assert.ok(alerts.suppressed.some((s) => s.reasons.some((w) => /held-out slice is frozen/.test(w))), "at least one reason names the frozen slice");
  });
});
