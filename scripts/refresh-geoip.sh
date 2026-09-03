#!/usr/bin/env bash
#
# Downloads the current month's city database into every goldkhatabook checkout.
#
# db-ip publishes a fresh City Lite file monthly and stops serving old months,
# so this is a refresh job, not a one-time install. Both that licence and
# MaxMind's expect stale copies to be replaced rather than kept indefinitely.
#
# Install:
#   cp scripts/refresh-geoip.sh ~/bin/goldkhatabook-geoip-refresh.sh
#   chmod 700 ~/bin/goldkhatabook-geoip-refresh.sh
#   crontab -e
#     30 3 3 * * /home/sanskarpandit/bin/goldkhatabook-geoip-refresh.sh >> /home/sanskarpandit/backups/goldkhatabook-geoip.log 2>&1
#
# Runs on the 3rd of the month: the new file is not always up on the 1st, and a
# failed fetch leaves the previous month's copy in place rather than none. The
# 3rd rather than the 2nd only to keep it off the same night as goldrate's own
# refresh, which fetches the identical file for a different app.
#
# Runs as the app user; needs no sudo.

set -euo pipefail

MONTH="$(date +%Y-%m)"
URL="https://download.db-ip.com/free/dbip-city-lite-${MONTH}.mmdb.gz"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[$(date -Is)] fetching $URL"
if ! curl -sS -fL --max-time 600 -o "$TMP/city.mmdb.gz" "$URL"; then
  echo "[$(date -Is)] download failed — keeping the existing database" >&2
  exit 1
fi

gunzip -f "$TMP/city.mmdb.gz"

# Verify before replacing anything. A truncated download that still gunzips
# would otherwise overwrite a working database with a broken one, and the
# service only discovers that at its next restart.
SIZE=$(stat -c%s "$TMP/city.mmdb")
if [ "$SIZE" -lt 10000000 ]; then
  echo "[$(date -Is)] downloaded file is only $SIZE bytes — refusing to install it" >&2
  exit 1
fi

INSTALLED=0
for env in prod preprod dev; do
  DEST="$HOME/gold-khata-book-backend-$env/data"
  # Created rather than skipped: unlike goldrate, these checkouts have no data
  # directory of their own, so requiring one to pre-exist would mean this job
  # silently does nothing on a freshly provisioned environment.
  mkdir -p "$DEST"

  cp "$TMP/city.mmdb" "$DEST/city.mmdb.new"
  # Atomic swap: the running service may be reading the old file, and mv within
  # a filesystem replaces the name without ever leaving it absent.
  mv -f "$DEST/city.mmdb.new" "$DEST/city.mmdb"
  echo "[$(date -Is)] $env: installed $(numfmt --to=iec "$SIZE" 2>/dev/null || echo "$SIZE bytes")"
  INSTALLED=$((INSTALLED + 1))
done

if [ "$INSTALLED" -eq 0 ]; then
  echo "[$(date -Is)] no checkouts found — nothing installed" >&2
  exit 1
fi

# The database is read once at boot, so a fresh file only takes effect on
# restart. Cheap for this service and keeps the job self-contained.
pm2 restart gold-khata-book-backend-prod gold-khata-book-backend-preprod gold-khata-book-backend-dev --update-env >/dev/null 2>&1 || true
echo "[$(date -Is)] restarted all three services"
