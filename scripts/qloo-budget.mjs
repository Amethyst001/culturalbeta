// What the keyed run costs, printed from src/budget.mjs — the same module the desk
// serves and the series step gates on. Run it before spending the budget, and re-run
// it after the basket calls with the real entity count so the trends line stops being
// a bound: node scripts/qloo-budget.mjs --entities 138
import { computeBudget } from "../src/budget.mjs";

const flagIndex = process.argv.indexOf("--entities");
const basketEntities = flagIndex > -1 ? Number(process.argv[flagIndex + 1]) : null;
if (flagIndex > -1 && (!Number.isInteger(basketEntities) || basketEntities < 1)) {
  console.error("--entities needs a positive integer");
  process.exit(2);
}

const b = computeBudget({ basketEntities });
const label = b.trends?.exact ? "computed from the cached baskets" : "upper bound";
console.log(`Qloo call budget for the keyed run (${label})`);
for (const line of b.lines) {
  console.log(`  ${line.label.padEnd(20)} ${String(line.calls ?? "—").padStart(5)}   ${line.note}`);
}
console.log(`  ${"total".padEnd(20)} ${String(b.total).padStart(5)}   ≈ ${b.estimatedMinutes} minutes of sequential calls at 1.5 s per request`);
console.log(`  the peer-basket control arm costs 0 — it is built from the same prices the desk already fetches.`);
process.stdout.write(JSON.stringify(b, null, 1) + "\n");
