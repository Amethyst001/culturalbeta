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
   `culturalbeta.ktnamethyst.me` → 84.8.134.19 on 2026-10-30, verified resolving through
   8.8.8.8.

## Install

```bash
# from the repository root on the server
sudo ./deploy/install.sh culturalbeta.ktnamethyst.me you@example.com
```

That installs Node 22 and certbot, creates a `culturalbeta` system user, copies the tree
to `/opt/culturalbeta`, runs it under systemd on 127.0.0.1:8787, writes one nginx vhost
for the subdomain, and issues a certificate with `certbot --nginx --redirect`. Re-running
is safe: `rsync --delete` refreshes the tree, the vhost is left alone if it exists, and
the service restarts.

## Verify after install

```bash
systemctl status culturalbeta --no-pager
curl -fsS https://culturalbeta.ktnamethyst.me/api/v1/panel | head -c 200
curl -fsS https://culturalbeta.ktnamethyst.me/export/panel.csv | head -2
curl -fsS https://culturalbeta.ktnamethyst.me/api/v1/alerts | head -c 200
```

Expected: the panel reports `priced: 80`, the alerts feed `status: "watchlist-only"` and
`count: 0`, and its note names the placebo p and the frozen held-out slice.

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
