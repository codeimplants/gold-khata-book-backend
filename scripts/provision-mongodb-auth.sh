#!/usr/bin/env bash
#
# Closes the hole left open by scripts/provision-mongodb.sh: enables MongoDB
# authentication and gives each environment a user scoped to its own database.
#
# RUN THIS ON THE SERVER, as a user with sudo:
#
#   ssh hostinger-vps
#   bash ~/gold-khata-book/provision-mongodb-auth.sh
#
# --- What this is protecting against -------------------------------------------
#
# Without auth, mongod trusts every process on the box. It binds 127.0.0.1, so
# nothing off-machine can reach it, but "on the machine" is not a small set: six
# unrelated products run here, several as the same unix user. Any of them, or
# any script anyone runs, can read and drop gold_khata_book_prod. Binding to
# localhost limits who can find the database; it does not limit what they may do
# once they have.
#
# After this runs, gkb_dev can read and write gold_khata_book_dev and nothing
# else. That boundary is enforced by mongod, not by everyone remembering which
# database they meant to connect to.
#
# --- Why now ------------------------------------------------------------------
#
# Enabling auth restarts mongod and drops every open connection. Right now that
# costs nothing: gold-khata-book is the only thing using this instance and it is
# not serving yet. Once real shops are billing through it, this same change is a
# planned outage.
#
# Idempotent: safe to re-run. Existing users are left alone.

set -euo pipefail

RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YEL=$'\033[1;33m'; CYA=$'\033[0;36m'; NC=$'\033[0m'
info() { printf '%s%s%s\n' "$CYA" "$*" "$NC"; }
ok()   { printf '%s%s%s\n' "$GRN" "$*" "$NC"; }
warn() { printf '%s%s%s\n' "$YEL" "$*" "$NC"; }
die()  { printf '%s%s%s\n' "$RED" "ERROR: $*" "$NC" >&2; exit 1; }

CONF=/etc/mongod.conf
KEYFILE=/etc/mongod.key
CRED_FILE="$HOME/.gold-khata-book-db-pass"
BASE="$HOME/gold-khata-book"

[[ "$(uname -s)" == "Linux" ]] || die "Run this on the server, not your laptop."
command -v mongosh >/dev/null || die "mongosh not found - run provision-mongodb.sh first."

# --- 1. Credentials ------------------------------------------------------------
# hex, not base64: these go inside a mongodb:// URI, and base64's / and + would
# need percent-encoding. A password that must be escaped is a password that
# eventually is not.
if [[ -f "$CRED_FILE" ]]; then
  info "Reusing credentials from $CRED_FILE"
  # shellcheck source=/dev/null
  source "$CRED_FILE"
else
  info "Generating credentials -> $CRED_FILE"
  umask 077
  {
    echo "# MongoDB credentials for gold-khata-book. Generated $(date -Is)."
    echo "# Root can read every database on this box. Back this file up; it is"
    echo "# the only copy, and mongod stores password hashes, not passwords."
    echo "MONGO_ROOT_PW=$(openssl rand -hex 24)"
    echo "GKB_DEV_PW=$(openssl rand -hex 24)"
    echo "GKB_PROD_PW=$(openssl rand -hex 24)"
  } > "$CRED_FILE"
  chmod 600 "$CRED_FILE"
  # shellcheck source=/dev/null
  source "$CRED_FILE"
fi
export MONGO_ROOT_PW GKB_DEV_PW GKB_PROD_PW

AUTH_IN_CONF=0
sudo grep -qE '^[[:space:]]*authorization:[[:space:]]*enabled' "$CONF" && AUTH_IN_CONF=1

# --- 2. Users, while the door is still open ------------------------------------
# Created BEFORE auth is switched on. Reversing that order is the classic way to
# lock yourself out: with authorization enabled and no users, mongod accepts no
# connection that can create one, and the only way back is the localhost
# exception or restarting without auth.
create_users() {
  info "Creating users (existing ones are left as they are)..."
  "$@" --eval '
    const wanted = [
      { db: "admin",                user: "root",     pw: process.env.MONGO_ROOT_PW, roles: [{role:"root", db:"admin"}] },
      { db: "gold_khata_book_dev",  user: "gkb_dev",  pw: process.env.GKB_DEV_PW,    roles: [{role:"readWrite", db:"gold_khata_book_dev"}] },
      { db: "gold_khata_book_prod", user: "gkb_prod", pw: process.env.GKB_PROD_PW,   roles: [{role:"readWrite", db:"gold_khata_book_prod"}] },
    ];
    for (const w of wanted) {
      const d = db.getSiblingDB(w.db);
      if (d.getUser(w.user)) { print("  exists:  " + w.user + " on " + w.db); continue; }
      d.createUser({ user: w.user, pwd: w.pw, roles: w.roles });
      print("  created: " + w.user + " on " + w.db);
    }
  '
}

if [[ $AUTH_IN_CONF -eq 0 ]]; then
  create_users mongosh --quiet || die "User creation failed."
fi

# --- 3. Keyfile, THEN authorization --------------------------------------------
# The keyfile is not optional and not about encryption. Enabling authorization on
# a REPLICA SET makes mongod demand internal cluster authentication, and refuses
# to start without a key:
#
#   BadValue: security.keyFile is required when authorization is enabled
#             with replica sets
#
# A standalone has no such requirement, so every "how to enable mongo auth" note
# written for a standalone is wrong here — and this deployment is a replica set
# only because the application uses transactions. That combination is what makes
# this easy to miss: the keyfile is required by a setting nobody chose for its
# own sake.
#
# One node means there is no second member to share the key with, but mongod
# still requires the file to exist.
if sudo test -f "$KEYFILE"; then
  ok "keyfile already present: $KEYFILE"
else
  info "Creating $KEYFILE..."
  # 756 base64 chars is what the MongoDB manual specifies. Ownership and mode
  # are enforced by mongod, which refuses to start on a key group- or
  # world-readable.
  sudo bash -c "openssl rand -base64 756 > '$KEYFILE'"
  sudo chown mongodb:mongodb "$KEYFILE"
  sudo chmod 400 "$KEYFILE"
  ok "keyfile created."
fi

NEEDS_RESTART=0

if sudo grep -qE "^[[:space:]]*keyFile:" "$CONF"; then
  ok "keyFile already referenced in $CONF"
else
  info "Adding keyFile to $CONF..."
  sudo cp "$CONF" "$CONF.bak-$(date +%Y%m%d-%H%M%S)"
  if sudo grep -qE '^[[:space:]]*security:' "$CONF"; then
    sudo sed -i "/^[[:space:]]*security:/a\\  keyFile: $KEYFILE" "$CONF"
  else
    printf '\nsecurity:\n  keyFile: %s\n' "$KEYFILE" | sudo tee -a "$CONF" >/dev/null
  fi
  NEEDS_RESTART=1
fi

if [[ $AUTH_IN_CONF -eq 1 ]]; then
  ok "authorization already enabled in $CONF"
else
  info "Enabling authorization in $CONF..."
  sudo sed -i '/^[[:space:]]*security:/a\  authorization: enabled' "$CONF"
  NEEDS_RESTART=1
fi

if [[ $NEEDS_RESTART -eq 1 ]] || ! systemctl is-active --quiet mongod; then
  info "Restarting mongod..."
  sudo systemctl restart mongod
  sleep 3
  systemctl is-active --quiet mongod \
    || die "mongod did not come back. Read the reason:  journalctl -u mongod -n 20 --no-pager"
  ok "mongod is running with authorization enabled."
else
  ok "mongod already running with the intended configuration."
fi

# Reconciled as root now that auth is on. Idempotent — this is also the path
# that recovers a run which died between creating users and enabling auth.
create_users mongosh --quiet -u root -p "$MONGO_ROOT_PW" --authenticationDatabase admin \
  || die "Could not reconcile users as root. If the root password in $CRED_FILE
does not match the one mongod stores, the fix is to disable authorization in
$CONF, restart, drop the admin.root user, and re-run this script."

# --- 4. Rewrite the .env files -------------------------------------------------
# Each checkout gets ONLY its own database URL. The prod password does not belong
# in the dev checkout: a dev process that can reach the prod database is a
# migration script away from writing to it, and NODE_ENV is one typo wide.
for env in dev prod; do
  f="$BASE/$env/.env"
  if [[ ! -f "$f" ]]; then warn "$f missing - skipping"; continue; fi
  cp "$f" "$f.bak-$(date +%Y%m%d-%H%M%S)"

  if [[ "$env" == "dev" ]]; then
    USER_NAME=gkb_dev;  PW="$GKB_DEV_PW";  DB=gold_khata_book_dev;  KEY=DEV_DB_URL
  else
    USER_NAME=gkb_prod; PW="$GKB_PROD_PW"; DB=gold_khata_book_prod; KEY=PROD_DB_URL
  fi

  URI="mongodb://$USER_NAME:$PW@127.0.0.1:27017/$DB?replicaSet=rs0&authSource=$DB"

  # Drop BOTH url lines and any previous note, then write back only this one.
  grep -vE '^(DEV|PROD)_DB_URL=' "$f" > "$f.tmp"
  {
    echo ""
    echo "# Scoped to this environment only. The other environment's URL is"
    echo "# deliberately absent: this checkout has no business reaching that"
    echo "# database. authSource matches the database the user was created in,"
    echo "# not admin."
    echo "$KEY=$URI"
  } >> "$f.tmp"
  mv "$f.tmp" "$f"
  chmod 600 "$f"
  ok "$env: .env updated ($USER_NAME -> $DB)"
done

# --- 5. Prove the boundary holds -----------------------------------------------
# Asserted rather than assumed. "Auth is enabled" and "auth actually stops
# anything" are different claims, and only the second one matters.
info "Verifying..."

if mongosh --quiet --eval 'db.getSiblingDB("gold_khata_book_prod").orders.findOne()' >/dev/null 2>&1; then
  die "Unauthenticated read of gold_khata_book_prod SUCCEEDED. Auth is not being enforced."
fi
ok "  unauthenticated access is refused"

mongosh --quiet -u gkb_dev -p "$GKB_DEV_PW" --authenticationDatabase gold_khata_book_dev \
  --eval 'db.getSiblingDB("gold_khata_book_dev").provision_check.insertOne({ok:1}); db.getSiblingDB("gold_khata_book_dev").provision_check.drop()' >/dev/null \
  || die "gkb_dev cannot write its own database."
ok "  gkb_dev can write gold_khata_book_dev"

if mongosh --quiet -u gkb_dev -p "$GKB_DEV_PW" --authenticationDatabase gold_khata_book_dev \
     --eval 'db.getSiblingDB("gold_khata_book_prod").orders.findOne()' >/dev/null 2>&1; then
  die "gkb_dev could read gold_khata_book_prod. The roles are too broad."
fi
ok "  gkb_dev is refused on gold_khata_book_prod"

echo ""
echo "--------------------------------------------------------------------------------"
echo "Authentication is on and the per-database boundary is verified."
echo ""
echo "Credentials:  $CRED_FILE  (chmod 600, root password included)"
echo "              This is the only copy. mongod stores hashes, not passwords."
echo ""
echo "Both .env files were rewritten and backed up alongside themselves. Each now"
echo "carries only its own database URL."
echo ""
echo "If a service is already running, restart it to pick up the new URL:"
echo "  pm2 restart gold-khata-book-backend-dev gold-khata-book-backend-prod --update-env"
echo "--------------------------------------------------------------------------------"
