# Deploying the desk

The desk is one Node process plus static files. It holds the Qloo key server-side; the
browser never sees it. Nothing here runs until an operator copies the repository
(including `fixtures/qloo/` and `.env`, both gitignored) to the server.

## Target

Ubuntu 22.04/24.04 on Oracle Cloud free tier (E2.1.Micro or Ampere A1), 1 vCPU and
1 GB RAM is enough: the desk serves cached fixtures and does no work at request time.

The host already runs nginx for another site, so the installer **adds one server block
and one systemd unit** and touches nothing else. It does not install or replace the web
server, and `nginx -t` runs before any reload: a bad config aborts the install with the
existing sites still live.

## Two things only the account owner can do

1. **Open the web ports in the VCN security list** — ingress TCP 80 and 443 from
   `0.0.0.0/0`. Oracle's default list permits 22 only, and the certificate challenge
   fails without 80. On the host, `ufw status` must also allow 'Nginx Full' if ufw is on.
2. **Point DNS** — an `A` record for the subdomain at the instance's public IP. Done for
   `culturalbeta.ktnamethyst.me` on 2026-10-30, verified resolving through
   a public resolver.

## Install

```bash
# from the repository root on the server
sudo ./deploy/install.sh culturalbeta.ktnamethyst.me you@example.com
```

That creates a `culturalbeta` system user, copies the tree to `/opt/culturalbeta`, runs
it under systemd on 127.0.0.1:8790 (8787 belongs to another service on this host), writes
one nginx vhost for the subdomain, and issues a certificate with `certbot --nginx
--redirect`. Re-running is safe: `rsync --delete` refreshes the tree, the vhost is left
alone if it exists, and the service restarts.

The Qloo harness CLI declares `engines.node >=22.19.0`; run under the host's older node
it fails with `webidl.util.markAsUncloneable is not a function`. The installer therefore
unpacks a private Node 22 under `/opt/node22` and puts it first on this service's PATH
only — a distro node the other sites on the box are pinned to is never upgraded.

The hackathon credential authenticates only against `https://hackathon.api.qloo.com`.
A host that has never run `qloo setup` leaves the harness pointing at the public
endpoint, where every live read comes back `QLOO_AUTH` — the desk then reports the
freshness check as unavailable rather than printing a reading. The installer writes
`$APP/.state/.qloo/config` with `base_url` and `trusted_base_url` set to the hackathon
endpoint (`QLOO_BASE_URL` overrides it).

`.env` must have LF line endings. systemd's `EnvironmentFile` keeps a trailing `\r` on
every value, and the harness then rejects the key with `QLOO_AUTH` while the same key
works from a shell — this cost a deploy cycle on 2026-10-30.

## Verify after install

```bash
systemctl status culturalbeta --no-pager
curl -fsS https://culturalbeta.ktnamethyst.me/api/desk.json | head -c 200
curl -fsS https://culturalbeta.ktnamethyst.me/api/agent.json
curl -fsS https://culturalbeta.ktnamethyst.me/api/v1/alerts | head -c 200
# The attestation must be the host's own Qloo read, not a page that arrived with the tree:
curl -fsS https://culturalbeta.ktnamethyst.me/api/freshness.json | grep -o '"fromCachedPage":[a-z]*'
```

Expected: the panel reports `priced: 80`, the alerts feed `status: "watchlist-only"` and
`count: 0`, and its note names the placebo p and the frozen held-out slice. The
attestation prints `{"checked":true,...,"requests":1,"fromCachedPage":false,...}` with a
correlation id the host received itself; `true` there means it replayed a page cached
before the deploy, which is honest but is not proof the host can reach Qloo.

## What is exposed, and what is not

- Exposed: computed betas, request URLs, fixture **filenames**, the panel JSON/CSV, and
  the alerts feed.
- Not exposed: cached Qloo response bodies (they live on disk and are read by the
  pipeline only), and the API key. Static serving is confined to `desk/`.

## Rollback

```bash
sudo systemctl disable --now culturalbeta
sudo rm /etc/nginx/sites-enabled/culturalbeta.conf /etc/nginx/sites-available/culturalbeta.conf
sudo nginx -t && sudo systemctl reload nginx
```

Other vhosts are untouched by both the install and this rollback.
