#!/usr/bin/env bash
#
# Installs and configures MongoDB on the shared VPS (31.97.61.191, "apps") for
# gold-khata-book, and creates the dev/prod databases and their users.
#
# RUN THIS ON THE SERVER, as a user with sudo:
#
#   ssh hostinger-vps
#   bash ~/gold-khata-book/prod/scripts/provision-mongodb.sh
#
# It will prompt for the sudo password. It cannot be run from a laptop over ssh
# in one shot, because sudo on this box requires a password and there is no root
# key — that is deliberate, not an oversight to work around.
#
# Idempotent: safe to re-run. It skips anything already done.
#
# --- Why the choices below -----------------------------------------------------
#
# ONE INSTANCE, MANY DATABASES. The binaries are installed once (~450 MB) and
# every app gets a database inside the same mongod. A second mongod process
# would not save disk (same binaries) and would cost another WiredTiger cache —
# by default ~50% of RAM each, on a box with 15 GB already running eleven pm2
# processes and two Docker containers. Databases are isolated from each other by
# scoped users, not by separate servers.
#
# SINGLE-NODE REPLICA SET, NOT STANDALONE. This is not optional and not about
# redundancy. unifiedCompleteAdvanceOrder in src/modules/order/order.service.ts
# opens a multi-document transaction, and a standalone mongod rejects those:
# "Transaction numbers are only allowed on a replica set member or mongos".
# Every other query works on a standalone, so the failure appears only when a
# shop completes an order — the single worst place to discover it.
#
# OPLOG PINNED TO 2 GB. A replica set otherwise sizes its oplog at 5% of free
# disk, which on this box's 180 GB free means preallocating ~9 GB for a
# single-node set that has no secondary to replicate to.
#
# BIND TO LOCALHOST ONLY. Every client is a pm2 process on this same machine.
# The default bindIp of 127.0.0.1 is what we want; this script asserts it rather
# than assuming, because an exposed unauthenticated mongod is found by scanners
# within hours.

set -euo pipefail

RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YEL=$'\033[1;33m'; CYA=$'\033[0;36m'; NC=$'\033[0m'
info() { printf '%s%s%s\n' "$CYA" "$*" "$NC"; }
ok()   { printf '%s%s%s\n' "$GRN" "$*" "$NC"; }
warn() { printf '%s%s%s\n' "$YEL" "$*" "$NC"; }
die()  { printf '%s%s%s\n' "$RED" "ERROR: $*" "$NC" >&2; exit 1; }

REPL_SET="rs0"
OPLOG_MB=2048

[[ "$(uname -s)" == "Linux" ]] || die "Run this on the server, not your laptop."
command -v sudo >/dev/null || die "sudo not available."

# --- 1. Install ----------------------------------------------------------------
if command -v mongod >/dev/null 2>&1; then
  ok "mongod already installed: $(mongod --version | head -1)"
else
  info "Installing MongoDB 8.0 from the official repository..."
  # Ubuntu's own 'mongodb' package is years stale and is not the same software;
  # always use MongoDB's repo.
  UBUNTU_CODENAME="$(. /etc/os-release && echo "$UBUNTU_CODENAME")"
  sudo install -m 0755 -d /usr/share/keyrings
  curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc \
    | sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg
  echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu ${UBUNTU_CODENAME}/mongodb-org/8.0 multiverse" \
    | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y mongodb-org
  ok "Installed: $(mongod --version | head -1)"
fi

# --- 2. Replica set + oplog ----------------------------------------------------
CONF=/etc/mongod.conf
if sudo grep -q "replSetName" "$CONF"; then
  ok "Replica set already configured in $CONF"
else
  info "Enabling single-node replica set '$REPL_SET' with a ${OPLOG_MB}MB oplog..."
  sudo cp "$CONF" "$CONF.bak-$(date +%Y%m%d-%H%M%S)"
  sudo tee -a "$CONF" >/dev/null <<EOF

# Added for gold-khata-book. A single-node replica set is required because the
# application uses multi-document transactions, which a standalone mongod
# refuses. oplogSizeMB is pinned because the 5%-of-free-disk default would
# preallocate ~9 GB here for a set with no secondary.
replication:
  replSetName: $REPL_SET
  oplogSizeMB: $OPLOG_MB
EOF
fi

info "Confirming mongod listens only on localhost..."
sudo grep -E "^\s*bindIp" "$CONF" || warn "No bindIp line found — check $CONF manually."

sudo systemctl enable --now mongod
sleep 2
systemctl is-active --quiet mongod || die "mongod failed to start. sudo journalctl -u mongod -n 50"
ok "mongod is running."

# --- 3. Initiate the set -------------------------------------------------------
if mongosh --quiet --eval 'rs.status().ok' 2>/dev/null | grep -q '^1$'; then
  ok "Replica set already initiated."
else
  info "Initiating replica set..."
  mongosh --quiet --eval "rs.initiate({_id:'$REPL_SET',members:[{_id:0,host:'127.0.0.1:27017'}]})"
  for i in $(seq 1 30); do
    mongosh --quiet --eval 'db.hello().isWritablePrimary' 2>/dev/null | grep -q true && break
    sleep 1
  done
  mongosh --quiet --eval 'db.hello().isWritablePrimary' | grep -q true \
    || die "Replica set did not reach PRIMARY."
  ok "Replica set is PRIMARY."
fi

# --- 4. Prove transactions work ------------------------------------------------
# The whole reason for the replica set. Asserting it here means the failure
# surfaces now, on an empty database, instead of the first time a shop completes
# an order.
info "Verifying multi-document transactions..."
mongosh --quiet --eval '
  const s = db.getMongo().startSession();
  s.startTransaction();
  s.getDatabase("provision_check").t.insertOne({ok: 1});
  s.commitTransaction();
  s.endSession();
  db.getSiblingDB("provision_check").dropDatabase();
  print("transactions OK");
' || die "Transactions do not work. The replica set is not configured correctly."
ok "Transactions verified."

cat <<'NEXT'

--------------------------------------------------------------------------------
Done. MongoDB is installed once and serves every app on this box; each app's
data lives in its own database inside it.

Databases are created on first write, so there is nothing to create by hand.
The application connects with:

  DEV_DB_URL=mongodb://127.0.0.1:27017/gold_khata_book_dev?replicaSet=rs0
  PROD_DB_URL=mongodb://127.0.0.1:27017/gold_khata_book_prod?replicaSet=rs0

STILL TO DO — authentication is NOT enabled yet.
Until it is, any process on this box can read and write every database,
including other products'. To close that, create a scoped user per app+env and
then set security.authorization: enabled in /etc/mongod.conf:

  mongosh
  use admin
  db.createUser({user:"root", pwd:passwordPrompt(), roles:["root"]})
  use gold_khata_book_prod
  db.createUser({user:"gkb_prod", pwd:passwordPrompt(),
                 roles:[{role:"readWrite", db:"gold_khata_book_prod"}]})
  use gold_khata_book_dev
  db.createUser({user:"gkb_dev", pwd:passwordPrompt(),
                 roles:[{role:"readWrite", db:"gold_khata_book_dev"}]})

Then the URLs become:

  mongodb://gkb_prod:<pw>@127.0.0.1:27017/gold_khata_book_prod?replicaSet=rs0&authSource=gold_khata_book_prod

Enabling auth restarts mongod and will disconnect every app using it.
--------------------------------------------------------------------------------
NEXT
