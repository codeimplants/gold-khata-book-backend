#!/usr/bin/env bash
#
# Creates the nginx reverse-proxy vhosts that put the dev and prod backends on
# the hostnames the mobile app actually calls, and obtains TLS certificates.
#
# RUN THIS ON THE SERVER, as a user with sudo:
#
#   ssh hostinger-vps
#   bash ~/gold-khata-book/prod/scripts/provision-nginx.sh
#
# PREREQUISITE — DNS. Both hostnames must already resolve to this box
# (31.97.61.191) before you run this, or certbot's HTTP-01 challenge fails and
# you get a rate-limited failure rather than a certificate:
#
#   dev.api.goldkhatabook.codeimplants.com   A   31.97.61.191
#   api.goldkhatabook.codeimplants.com       A   31.97.61.191
#
# Neither record existed when this script was written; `getent hosts <name>`
# returning nothing is the check.
#
# The hostnames are not arbitrary — they are compiled into the app by
# src/config/environments/{development,production}.ts in the frontend repo. A
# build points at whatever is written there, so these two names and those two
# files must agree.
#
# Idempotent: safe to re-run.

set -euo pipefail

RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YEL=$'\033[1;33m'; CYA=$'\033[0;36m'; NC=$'\033[0m'
info() { printf '%s%s%s\n' "$CYA" "$*" "$NC"; }
ok()   { printf '%s%s%s\n' "$GRN" "$*" "$NC"; }
warn() { printf '%s%s%s\n' "$YEL" "$*" "$NC"; }
die()  { printf '%s%s%s\n' "$RED" "ERROR: $*" "$NC" >&2; exit 1; }

# host:port pairs. Ports match ecosystem.config.js — 7110/7111, NOT the
# 7100/7101 inherited from the fork, which belong to goldrate-backend.
VHOSTS=(
  "dev.api.goldkhatabook.codeimplants.com:7111"
  "api.goldkhatabook.codeimplants.com:7110"
)
CERTBOT_EMAIL="codeimplants@gmail.com"

[[ "$(uname -s)" == "Linux" ]] || die "Run this on the server, not your laptop."
command -v nginx >/dev/null || die "nginx is not installed."

# --- 1. DNS gate ---------------------------------------------------------------
# Checked before writing anything: certbot failures against a name that does not
# resolve count towards Let's Encrypt's failed-validation rate limit, so getting
# this wrong repeatedly locks you out for an hour.
missing=0
for entry in "${VHOSTS[@]}"; do
  host="${entry%%:*}"
  if getent hosts "$host" >/dev/null; then
    ok "DNS OK: $host -> $(getent hosts "$host" | awk '{print $1}')"
  else
    warn "DNS MISSING: $host"
    missing=1
  fi
done
[[ $missing -eq 0 ]] || die "Add the A records above (both -> 31.97.61.191), wait for propagation, then re-run."

# --- 2. Plain HTTP vhosts ------------------------------------------------------
# Written as HTTP-only on purpose. certbot --nginx rewrites them in place, adds
# the listen 443 block and the redirect, and marks its own lines "managed by
# Certbot" — the same shape every other app on this box uses.
for entry in "${VHOSTS[@]}"; do
  host="${entry%%:*}"
  port="${entry##*:}"
  conf="/etc/nginx/sites-available/$host"

  if [[ -f "$conf" ]]; then
    ok "vhost already exists: $conf"
  else
    info "Writing $conf (proxy -> 127.0.0.1:$port)..."
    sudo tee "$conf" >/dev/null <<EOF
server {
    listen 80;
    server_name $host;

    location / {
        # 25M matches the other apps on this box. Shop and ornament photos are
        # uploaded through this proxy; nginx's 1M default rejects them with a
        # 413 that never reaches the application logs.
        client_max_body_size 25M;

        proxy_pass http://127.0.0.1:$port;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF
  fi

  sudo ln -sfn "$conf" "/etc/nginx/sites-enabled/$host"
done

info "Testing nginx configuration..."
sudo nginx -t || die "nginx config test failed — nothing has been reloaded."
sudo systemctl reload nginx
ok "nginx reloaded."

# --- 3. TLS --------------------------------------------------------------------
if ! command -v certbot >/dev/null; then
  warn "certbot is not installed; skipping TLS."
  warn "  sudo apt-get install -y certbot python3-certbot-nginx"
  exit 0
fi

CERT_ARGS=()
for entry in "${VHOSTS[@]}"; do CERT_ARGS+=(-d "${entry%%:*}"); done

info "Requesting certificates via certbot..."
sudo certbot --nginx "${CERT_ARGS[@]}" \
  --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect

sudo nginx -t && sudo systemctl reload nginx
ok "TLS configured."

cat <<'NEXT'

--------------------------------------------------------------------------------
Done. Verify end to end — this hits the real hostname over TLS, which is what
the app does, rather than the local port, which can succeed while the proxy is
broken:

  curl -i https://dev.api.goldkhatabook.codeimplants.com/api/platform/config
  curl -i https://api.goldkhatabook.codeimplants.com/api/platform/config

A 502 here means nginx is fine and the pm2 process is not running or not
listening on the expected port.
--------------------------------------------------------------------------------
NEXT
