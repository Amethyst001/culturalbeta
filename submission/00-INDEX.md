# Cultural Beta — Devpost submission pack

Everything Devpost asks for, in the order Devpost asks for it. Each file below maps to one
screen in the submission flow. Replace `{{PLACEHOLDERS}}` once hosting and the recording are
done; nothing else needs editing.

| File | Devpost screen | What it holds |
|---|---|---|
| `01-overview-fields.md` | Project overview (step 1) | Name, elevator pitch, thumbnail spec |
| `02-project-story.md` | Project details → About the project | The Markdown + LaTeX story judges read |
| `03-built-with.md` | Project details → Built with | Tags, ≤ 25 |
| `04-additional-info.md` | Additional info | Start date, public URL, public repo, upgrade answer |
| `05-demo-and-media.md` | Project details → media | 90-second shot list, gallery captions, thumbnail |

---

## What only you can supply

These are the four things I cannot produce from inside the build. Everything else in the
pack is final copy.

1. **Public HTTPS URL** — `https://culturalbeta.ktnamethyst.me` once the deploy runs.
   DNS already points at 84.8.134.19; the installer is written and waiting.
2. **Public code repository** — one push. The tree is clean of `.env`, `fixtures/qloo/` and
   `output/` (verified against `git ls-files`), and there are 10 commits from 29 Oct.
3. **Demo video** — YouTube or Vimeo URL. Script is in `05-demo-and-media.md`, 90 seconds,
   one take, captions on screen so it works muted.
4. **Thumbnail and gallery images** — 3:2, 5 MB max. Captures exist under
   `review/shots-2026-10-30T16-57-11/`; the exact picks and crops are listed in
   `05-demo-and-media.md`.

## Rules to keep the entry compliant

- Nothing here contains Qloo response data. The public repo carries computed betas, request
  URLs and cached-response **paths**, never the responses themselves.
- The key is server-side only; `.env.example` documents the names, `.env` is ignored.
- No portfolio, trading or backtest claim anywhere — that is deliberate, and the story says
  why rather than dodging it.
- The story states in-sample-only wherever the number is in-sample. Do not "improve" that
  sentence out during a final read; it is the entry's strongest signal.

## Timing

Deadline is Sat 31 Oct 2026, 04:45 WAT. The pack can be pasted in about 20 minutes once the
URL and video exist. Do the deploy and the recording first; the text is ready.
