#!/usr/bin/env bash
# Installer for the Cultural Beta desk on an Ubuntu host that already serves other
# sites. It adds one nginx server block and one systemd service; it never rewrites
# another site's config and never replaces the web server.
#   sudo ./deploy/install.sh culturalbeta.example.com [email@example.com]
# The desk is a Node process on 127.0.0.1:${PORT:-8790}; nginx terminates TLS and
# proxies. The port is deliberately not 8787 — that is another service's on this box.
set -euo pipefail

DOMAIN="${1:?usage: sudo ./deploy/install.sh <domain> [email]}"
EMAIL="${2:-}"
APP=/opt/culturalbeta
PORT="${PORT:-8790}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
VHOST=/etc/nginx/sites-available/culturalbeta.conf

if [ "$(id -u)" -ne 0 ]; then echo "run as root" >&2; exit 1; fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl rsync nginx certbot python3-certbot-nginx

# The Qloo harness declares engines.node >=22.19.0. On a host whose distro node is
# older, it is NOT upgraded — other sites on this box run against it — but a private
# copy is unpacked under /opt/node22 and only this service's PATH sees it.
NODE_OK() { /opt/node22/bin/node -e 'process.exit(process.versions.node.split(".").map(Number)[0] >= 22 ? 0 : 1)' 2>/dev/null; }
if ! NODE_OK; then
  TARBALL="$(curl -fsSL https://nodejs.org/dist/latest-v22.x/ | grep -o 'node-v22[0-9.]*-linux-x64.tar.xz' | head -1)"
  [ -n "$TARBALL" ] || { echo "could not find the v22 tarball name" >&2; exit 1; }
  curl -fsSL -o /tmp/node22.tar.xz "https://nodejs.org/dist/latest-v22.x/$TARBALL"
  mkdir -p /opt/node22
  tar -xJf /tmp/node22.tar.xz -C /opt/node22 --strip-components=1
  rm -f /tmp/node22.tar.xz
fi
NODE=/opt/node22/bin/node
# The bin shim resolves `env node`, so PATH must put the private node first here too.
export PATH=/opt/node22/bin:$PATH

# Every Qloo call goes through the official harness CLI, so the service user needs it
# on PATH. Pinned, because the request shapes were verified against this version.
"$NODE" /opt/node22/bin/npm install -g --silent --prefix /opt/node22 @qloo/qloo-harness@0.1.26 >/dev/null
qloo --version

# The service user exists only to run the desk; it owns nothing else.
id -u culturalbeta >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin culturalbeta

mkdir -p "$APP"
# .env never rides along in a sync: keys are written on the host, by hand, and this
# repo's installer must not be the thing that copies a secret out of a laptop.
rsync -a --delete \
  --exclude .git --exclude node_modules --exclude .env --exclude .probe \
  --exclude 'review/shots-*' --exclude '*.log' \
  "$SRC/" "$APP/"
chown -R culturalbeta:culturalbeta "$APP"
# The unit sets HOME here (ProtectHome masks the real home), and the harness CLI writes
# its own state under HOME, so the directory has to exist and be writable.
mkdir -p "$APP/.state"
chown culturalbeta:culturalbeta "$APP/.state"
# The hackathon credential only authenticates against the hackathon endpoint. A fresh
# host defaults the harness to https://api.qloo.com, and every live read then comes back
# QLOO_AUTH — which the desk reports honestly as an unavailable check, not as a reading.
QLOO_BASE_URL="${QLOO_BASE_URL:-https://hackathon.api.qloo.com}"
mkdir -p "$APP/.state/.qloo"
printf 'base_url=%s\ntrusted_base_url=%s\n' "$QLOO_BASE_URL" "$QLOO_BASE_URL" > "$APP/.state/.qloo/config"
chmod 600 "$APP/.state/.qloo/config"
chown culturalbeta:culturalbeta "$APP/.state/.qloo" "$APP/.state/.qloo/config"
# Without .env the desk still serves the whole committed panel; the live tools and
# the freshness check report themselves unavailable rather than inventing a reading.
if [ -f "$APP/.env" ]; then chmod 600 "$APP/.env"; else echo "note: no .env on $APP — panel only, live reads refused"; fi

install -m 644 "$SRC/deploy/culturalbeta.service" /etc/systemd/system/culturalbeta.service
systemctl daemon-reload
systemctl enable --now culturalbeta
sleep 1
curl -fsS "http://127.0.0.1:$PORT/api/desk.json" >/dev/null && echo "desk answering on 127.0.0.1:$PORT"

# One new vhost. `nginx -t` runs before any reload, and a failed test aborts the
# install with the existing server still live.
if [ ! -f "$VHOST" ]; then
  cat > "$VHOST" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    # The panel JSON is ~400 KB; uncompressed it took 5 s over the public link and the
    # page rendered blank long enough to look broken. Measured 74 KB and 1.7 s with gzip.
    gzip on;
    gzip_proxied any;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types application/json application/javascript text/css text/plain;

    # Qloo response bodies are never served: only the desk's own routes exist here.
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        # An answer that runs the tool loop and the freshness attestation can pass
        # 60 s; the default 60 s proxy timeout turned a slow answer into a 504.
        proxy_read_timeout 180s;
        proxy_send_timeout 180s;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        add_header X-Content-Type-Options nosniff always;
        add_header Referrer-Policy strict-origin-when-cross-origin always;
    }
}
NGINX
  ln -sf "$VHOST" /etc/nginx/sites-enabled/culturalbeta.conf
  echo "wrote $VHOST"
else
  echo "$VHOST already exists — leaving it in place"
fi

nginx -t
systemctl reload nginx

# TLS last, so a certificate failure leaves a working HTTP vhost rather than none.
if [ -n "$EMAIL" ]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
else
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
fi

echo
echo "desk: https://$DOMAIN"
echo "checks:"
echo "  curl -fsS https://$DOMAIN/api/desk.json | head -c 200"
echo "  curl -fsS https://$DOMAIN/api/agent.json"
echo "  curl -fsS https://$DOMAIN/api/budget.json"
