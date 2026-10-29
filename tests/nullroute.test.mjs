// Acceptance test 2 (null-route): with Qloo fixtures emptied, compute-betas must
// exit non-zero, print nothing to output/, and never emit "0.00" for a beta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("compute-betas refuses without Qloo data", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "cb-nullroute-"));
  try {
    const res = spawnSync(process.execPath, [resolve(ROOT, "scripts/compute-betas.mjs")], {
      env: { ...process.env, CULTURALBETA_QLOO_DIR: dir },
      encoding: "utf8",
      cwd: ROOT,
    });
    assert.equal(res.status, 2, `expected exit 2, got ${res.status}\n${res.stdout}${res.stderr}`);
    assert.match(res.stderr, /REFUSING TO PRINT/);
    assert.match(res.stderr, /QLOO_REQUIRED/);
    assert.doesNotMatch(res.stdout + res.stderr, /cultural 0\.00|culturalBeta":\s*0\b/);
    assert.ok(!existsSync(resolve(ROOT, "output/desk.json")) || !res.stdout.includes("Saved"), "must not save a desk from empty Qloo");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
