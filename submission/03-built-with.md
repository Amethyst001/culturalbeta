# Built with — tags (max 25)

Paste in this order. The first five carry the most signal for a Qloo judge.

```
Qloo API
Qloo CLI harness
Node.js
JavaScript
Statistics
OLS regression
Bootstrap resampling
Permutation tests
HTML
CSS
Yahoo Finance
JSON API
CSV
Nginx
systemd
Oracle Cloud
Ubuntu
Chrome DevTools Protocol
```

Notes:

- **Qloo API** and **Qloo CLI harness** are separate on purpose: the entry routes every call
  through `@qloo/qloo-harness` (`api search`, `exec recommend`, `exec trends`, `api insights`)
  rather than guessing at HTTP shapes. That is a technical point the CTO will look for.
- No model-provider tag. There is no LLM in the estimator, and implying one would misrepresent
  the method. The only AI-adjacent claim is Qloo's own affinity data.
- `Oracle Cloud` / `Ubuntu` / `Nginx` / `systemd` are accurate only once the deploy runs —
  remove them if the desk ends up hosted elsewhere.
