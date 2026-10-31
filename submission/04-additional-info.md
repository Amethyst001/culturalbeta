# Additional info — for judges and organisers

## When did you begin your project?

```
2026-10-29
```

That is the first commit (`git log --reverse`). The build is 10 commits to 30 Oct.

## Public URL to your project

```
https://culturalbeta.ktnamethyst.me
```

Pending deploy — DNS already resolves `culturalbeta.ktnamethyst.me` to the demo host.
If the domain changes, update only this line; nothing in the story depends on it.

## Public code repo

```
{{REPO_URL}}
```

Before making it public, confirm:

- [ ] `git ls-files | grep -iE '\.env$|fixtures/qloo|output/'` returns nothing
- [ ] no raw Qloo response and no API key anywhere in history
      (`git log -p --all -S "QLOO_API_KEY="` should show only `.env.example` names)
- [ ] `README.md` renders with the architecture and the reproduction commands
- [ ] `config/book.json` is committed — it is the pre-registration the story cites

## If this was an existing project, how did you significantly upgrade it?

```
No. Cultural Beta was built from scratch for this hackathon — the first commit is
2026-10-29, the day the project began. Nothing was carried over from an earlier
codebase.

If it helps a judge: the design did change materially during the build, and the
repository history shows it. The first commits are a price-only desk with the Qloo
factor withheld; the live factor, the pre-registered falsification arm, and the
frozen-tail disclosure were each added as separate, reviewable commits rather than
folded into one dump. The final architecture — seven surfaces over one deterministic
estimator, with Qloo load-bearing and a hard refusal path — is the fourth design, not
the first.
```

## Anything else the judges should know

- The desk is a static front end over a Node service; there is no login and no database.
  Every number on the page is served from a committed computation, so the URL is the whole
  product.
- The API is versioned and public: `/api/v1/panel`, `/api/v1/holding/ELF`,
  `/api/v1/alerts`, `/export/panel.csv`. `curl` is a legitimate way to judge this entry.
- The entry's central claim is a negative one, and the story states why it is still worth
  judging: the pipeline prices an exposure and proves that this data vintage cannot test it.
