// The price half must work with no Qloo key at all: real Yahoo weekly bars,
// one-regressor market beta. This also pins the real-data e.l.f. reproduction —
// the brief's reference was 1.92 on simulated data; on real prices ELF fits
// 2.03 ± 0.41, and that is the number the desk must keep reporting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("market-only endpoint serves the real price half without Qloo", async () => {
  const child = spawn(process.execPath, [resolve(ROOT, "server/desk-server.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PORT: "0" },
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
    const res = await fetch(`http://localhost:${port}/api/market-only.json`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.rows.length, 7);
    assert.equal(body.window.weeks, 106);
    assert.equal(body.window.alignedDates, undefined, "window must not ship 106 dates to the browser");
    const elf = body.rows.find((r) => r.ticker === "ELF");
    assert.ok(Math.abs(elf.marketBeta - 2.03) < 0.05, `ELF market beta ${elf.marketBeta}`);
    assert.ok(Math.abs(elf.marketSE - 0.41) < 0.03, `ELF market s.e. ${elf.marketSE}`);
    assert.equal(elf.weeks, 106);
    for (const r of body.rows) assert.ok(r.marketBeta != null && Number.isFinite(r.marketBeta));
  } finally {
    child.kill();
  }
});
