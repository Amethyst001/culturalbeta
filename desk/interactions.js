/* Interaction layer for the Cultural Beta desk.

   INTEGRATION NOTE — desk/app.js · liveTable()
   The page renders a whole-row target only where a #/holding/ link exists, which
   today is the featured row's "open" trace link. Exact edit: in liveTable(), make
   the ticker the holding link in all three branches. In the ok branch replace
     <span class="tick">${r.ticker}</span>
   with <a class="tick" href="#/holding/${r.ticker}">${r.ticker}</a> and do the same
   in the unresolved and not-ok branches. Keep `depth` and the trace link as they
   are, so "trace" still opens evidence and "open" still opens the holding.
   Leave coldTable() alone: without DESK there is no holding reading to open, and
   its rows should keep pointing at evidence. interactions.js upgrades any row
   containing a #/holding/ link; it invents no destination for rows that have none.
   No other app.js change is required: the observer detaches app.js's own th/row
   onclick assignments for every element this module takes over.
*/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAMP = /^att-[0-9a-f]{12}$/i;
const CORRELATION = /^(exec|req)-/i;
const JSON_FILE = /^(?:\.{0,2}\/)?(?:[\w.-]+\/)*[\w.-]+\.json$/i;

const root = document.querySelector("#app, main, [data-app]") ?? document.body;

const textOf = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const isMissing = (v) => v === "" || /^(?:—|–|-|n\/a)$/i.test(v);
const uncomma = (s) => s.replace(/[−–]/g, "-").replace(/,/g, "");

function looseNumber(s) {
  if (isMissing(s)) return null;
  const m = uncomma(s).match(/[+-]?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

// A whole cell counts as numeric only when the text is a number plus units,
// so a company name that happens to contain a digit is never read as a number.
function strictNumber(s) {
  if (isMissing(s)) return null;
  const m = uncomma(s).replace(/[%·×Δ]/g, " ").match(/^\s*([+-]?\d+(?:\.\d+)?)\s*(?:pts?|weeks?|wks?|y(?:ears?)?|names?|panel)?\s*$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function columnIsNumeric(tbody, index) {
  const cells = [...tbody.rows].map((row) => row.cells[index]).filter(Boolean);
  if (cells.some((td) => td.classList.contains("num"))) return true;
  let seen = 0;
  for (const td of cells) {
    const t = textOf(td);
    if (isMissing(t)) continue;
    if (strictNumber(t) === null) return false;
    seen++;
  }
  return seen > 0;
}

function appendRows(tbody, rows) {
  const frag = document.createDocumentFragment();
  for (const row of rows) frag.append(row);
  tbody.append(frag);
}

function upgradeTable(table) {
  const tbody = table.tBodies[0];
  const head = table.tHead?.rows[0];
  if (!tbody || !head || !tbody.rows.length) return;
  const headers = [...head.cells];
  if (headers.some((th) => th.colSpan > 1)) return;

  table.dataset.upgraded = "table";
  const numeric = headers.map((_, i) => columnIsNumeric(tbody, i));
  const original = [...tbody.rows];
  const subs = headers.map((th) => {
    const el = th.querySelector(".thsub");
    if (!el) return null;
    const full = textOf(el);
    return { el, base: full.replace(/^sorted by q · /, ""), hadNote: /^sorted by q · /.test(full) };
  });
  const noteIndex = subs.findIndex((sub) => sub?.hadNote);
  const state = { index: -1, dir: 0 };

  function paint() {
    headers.forEach((th, i) => {
      if (!th.hasAttribute("data-sortable")) return;
      const active = state.index === i;
      th.dataset.sortable = active ? (state.dir > 0 ? "asc" : "desc") : "none";
      if (active) th.setAttribute("aria-sort", state.dir > 0 ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
    });
    subs.forEach((sub, i) => {
      if (!sub) return;
      const qNote = (state.index === i || state.index < 0) && i === noteIndex;
      const next = qNote ? `sorted by q · ${sub.base}` : sub.base;
      if (sub.el.textContent !== next) sub.el.textContent = next;
    });
  }

  function toggle(i) {
    if (state.index !== i) {
      state.index = i;
      state.dir = 1;
    } else if (state.dir === 1) {
      state.dir = -1;
    } else {
      state.index = -1;
      state.dir = 0;
    }

    if (state.index < 0) {
      appendRows(tbody, original);
    } else {
      const keyed = [...tbody.rows].map((row, pos) => {
        const td = row.cells[i];
        const t = td ? textOf(td) : "";
        const key = numeric[i]
          ? looseNumber(t)
          : isMissing(t) ? null : t;
        return { row, pos, key };
      });
      keyed.sort((a, b) => {
        const am = a.key === null, bm = b.key === null;
        if (am || bm) return am === bm ? a.pos - b.pos : (am ? 1 : -1);
        const c = numeric[i]
          ? a.key - b.key
          : String(a.key).localeCompare(String(b.key), "en", { numeric: true, sensitivity: "base" });
        return c ? c * state.dir : a.pos - b.pos;
      });
      appendRows(tbody, keyed.map((entry) => entry.row));
    }
    paint();
  }

  headers.forEach((th, i) => {
    if (!textOf(th)) return;
    if (!th.querySelector(".th")) th.classList.add("sort-plain");
    th.dataset.sortable = "none";
    th.tabIndex = 0;
    th.setAttribute("role", "button");
    const label = textOf(th.querySelector(".th") ?? th).replace(/[▲▼]/g, "").trim();
    if (label) th.setAttribute("aria-label", `Sort by ${label}`);
    th.onclick = null; // app.js re-renders the route instead of sorting in place
    th.addEventListener("click", (event) => {
      event.preventDefault();
      toggle(i);
    });
    th.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle(i);
    });
  });
  paint();
}

function updateScroll(tw) {
  const overflow = tw.scrollWidth - tw.clientWidth > 2;
  tw.dataset.overflow = overflow ? "1" : "0";
  tw.dataset.end = tw.scrollLeft + tw.clientWidth >= tw.scrollWidth - 2 ? "1" : "0";
  tw.dataset.stuck = tw.scrollTop > 1 ? "1" : "0";
}

function upgradeScroll() {
  for (const tw of root.querySelectorAll(".tw")) {
    if (tw.dataset.upgraded) continue;
    const table = tw.querySelector("table");
    if (!table) continue;
    tw.dataset.upgraded = "scroll";
    tw.tabIndex = 0;
    if ((table.tBodies[0]?.rows.length ?? 0) > 14) tw.dataset.long = "1";
    tw.addEventListener("scroll", () => updateScroll(tw), { passive: true });
    updateScroll(tw);
  }
}

function upgradeRows() {
  for (const tr of root.querySelectorAll("tbody tr")) {
    if (tr.dataset.upgraded === "row") continue;
    const link = tr.querySelector('a[href^="#/holding/"]');
    const href = link?.getAttribute("href");
    if (!href) continue;

    tr.dataset.upgraded = "row";
    tr.dataset.rowlink = href;
    tr.tabIndex = 0;
    tr.onclick = null; // replace app.js's row click so a text selection is not a navigation
    let down = null;
    tr.addEventListener("pointerdown", (event) => {
      down = { x: event.clientX, y: event.clientY };
    }, { passive: true });
    tr.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("a,button,input,select,textarea,summary,label")) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim() && selection.anchorNode && tr.contains(selection.anchorNode)) return;
      if (down && (Math.abs(event.clientX - down.x) > 6 || Math.abs(event.clientY - down.y) > 6)) return;
      down = null;
      location.hash = tr.dataset.rowlink;
    });
    tr.addEventListener("keydown", (event) => {
      if (event.target !== tr || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      location.hash = tr.dataset.rowlink;
    });
  }
}

function copyLabel(value) {
  if (UUID.test(value)) return "Copy id";
  if (STAMP.test(value)) return "Copy stamp";
  if (JSON_FILE.test(value)) return "Copy filename";
  if (CORRELATION.test(value)) return "Copy correlation id";
  return null;
}

function fallbackCopy(value) {
  const active = document.activeElement;
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  if (active instanceof HTMLElement && active.isConnected) active.focus();
  return ok;
}

async function copyText(value, button) {
  let ok = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (!ok) ok = fallbackCopy(value);

  button.textContent = ok ? "Copied" : "Copy failed";
  button.setAttribute("aria-label", ok ? "Copied" : "Copy failed");
  button.dataset.copied = ok ? "1" : "0";
  clearTimeout(button._copyTimer);
  button._copyTimer = setTimeout(() => {
    button.textContent = "Copy";
    button.setAttribute("aria-label", button._copyLabel);
    delete button.dataset.copied;
  }, 1200);
}

function upgradeCodes() {
  for (const code of root.querySelectorAll("code")) {
    if (code.dataset.upgraded || code.closest("table, a, pre, .copyable")) continue;
    const value = textOf(code);
    const label = copyLabel(value);
    if (!label) continue;

    const parent = code.parentNode;
    if (!parent) continue;
    code.dataset.upgraded = "copy";
    const wrap = document.createElement("span");
    wrap.className = "copyable";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-id";
    button.textContent = "Copy";
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-live", "polite");
    button._copyLabel = label;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      copyText(value, button);
    });
    parent.insertBefore(wrap, code);
    wrap.append(code, button);
  }
}

function upgradeAll() {
  for (const table of root.querySelectorAll("table")) {
    if (!table.dataset.upgraded) upgradeTable(table);
  }
  upgradeScroll();
  upgradeRows();
  upgradeCodes();
}

function syncScroll() {
  for (const tw of root.querySelectorAll('.tw[data-upgraded="scroll"]')) updateScroll(tw);
}

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    upgradeAll();
  });
});
observer.observe(root, { childList: true, subtree: true });

upgradeAll();
requestAnimationFrame(syncScroll);
document.fonts?.ready.then(syncScroll).catch(() => {});
window.addEventListener("resize", syncScroll, { passive: true });
