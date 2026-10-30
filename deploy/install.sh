#!/usr/bin/env bash
# Installer for the Cultural Beta desk on an Ubuntu host that already serves other
# sites. It adds one nginx server block and one systemd service; it never rewrites
# another site's config and never replaces the web server.
#   sudo ./deploy/install.sh culturalbeta.example.com [email@example.com]
# The desk is a Node process on 127.0.0.1:8787; nginx terminates TLS and proxies.
set -euo pipefail

DOMAIN="${1:?usage: sudo ./deploy/install.sh <domain> [email]}"
EMAIL="${2:-}"
APP=/opt/culturalbeta
PORT=8787
SRC="$(cd "$(dirname "$0")/.." && pwd)"
VHOST=/etc/nginx/sites-available/culturalbeta.conf

if [ "$(id -u)" -ne 0 ]; then echo "run as root" >&2; exit 1; fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl rsync nginx certbot python3-certbot-nginx

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

# The service user exists only to run the desk; it owns nothing else.
id -u culturalbeta >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin culturalbeta

mkdir -p "$APP"
rsync -a --delete \
  --exclude .git --exclude node_modules --exclude 'review/shots-*' --exclude '*.log' \
  "$SRC/" "$APP/"
chown -R culturalbeta:culturalbeta "$APP"
# The Qloo key, when present, is read by the service and by nothing else. A keyless
# deploy still serves a complete panel from the cached responses.
if [ -f "$APP/.env" ]; then chmod 600 "$APP/.env"; else echo "note: no .env — serving the cached panel; a keyed recompute will refuse"; fi

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

    # Qloo response bodies are never served: only the desk's own routes exist here.
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
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
echo "  curl -fsS https://$DOMAIN/api/v1/panel | head -c 200"
echo "  curl -fsS https://$DOMAIN/export/panel.csv | head -2"
echo "  curl -fsS https://$DOMAIN/api/v1/alerts | head -c 200"
