# Deploy configuration for gold-khata-book-backend.
#
# SETUP: copy this file to scripts/deploy.config.sh and adjust if the server changes.
#   cp scripts/deploy.config.example.sh scripts/deploy.config.sh
#
# deploy.config.sh is gitignored. It holds server addresses only — never secrets.
# Application secrets live in the .env inside each checkout ON THE SERVER and are
# never read, written or transported by this script.

# --- SSH ---------------------------------------------------------------------
# 31.97.61.191 is the shared application server (hostname "apps"). It also runs
# sonebill, nexus, sonetaran, goldrate and barnefarms, so the host alias is a
# nickname for a machine this app shares — not a machine it owns.
#
# ~/.ssh/config already defines this alias for the other apps:
#
#   Host hostinger-vps
#     HostName 31.97.61.191
#     User sanskarpandit
#     IdentityFile ~/.ssh/vps_sanskarpandit_claude
#
# Log in as the app user, NOT root. deploy.sh wraps every remote command in
# `sudo -u $APP_USER`, and sudo skips authentication when the target user is the
# invoking user — so connecting as sanskarpandit needs no sudo password, while
# connecting as root would leave root-owned files in the checkout and break git
# with "dubious ownership".
DEPLOY_SSH_HOST="hostinger-vps"

# --- Server layout -----------------------------------------------------------
# Both environments live under ONE parent directory:
#
#   /home/sanskarpandit/gold-khata-book/
#     dev/     <- its own checkout, .env and dist/
#     prod/    <- its own checkout, .env and dist/
#
# Separate checkouts are the point: building one cannot affect the other. The
# app this was forked from ran every environment from a single checkout and a
# single dist/, so a build "for dev" also replaced the code prod would run on
# its next restart.
#
# Checkouts are owned by APP_USER, so git/npm/pm2 must run as them.
APP_USER="sanskarpandit"

# Branch every environment deploys unless told otherwise.
# This repo's default branch is `main` (the app it was forked from used
# `master` — do not copy that value across).
BRANCH="main"

# Optional per-environment branch. Leave these commented out unless you have a
# standing reason — a release branch that dev should track for a while, say.
#
# To test a feature branch on dev you almost certainly want `--branch` instead:
#
#   bash scripts/deploy.sh --env dev --branch feat/my-thing
#
# That applies to one run and is written nowhere, so it cannot be forgotten. A
# setting here persists until someone remembers to remove it, and a forgotten
# override is how a feature branch ends up somewhere nobody expected.
#
# NEVER point PROD_BRANCH at anything but the release branch.
#
# DEV_BRANCH="main"
# PROD_BRANCH="main"

# Per-environment checkout, PM2 process name (from `pm2 list` as APP_USER),
# and the port that instance listens on.
#
# Ports are 7110/7111, NOT the 7100/7101 this file claimed when it was forked.
# 7100 and 7101 belong to goldrate-backend-prod and goldrate-backend-dev, which
# were already listening on this box. 7112 is left free for a preprod instance.
DEV_APP_DIR="/home/sanskarpandit/gold-khata-book/dev"
DEV_PM2_NAME="gold-khata-book-backend-dev"
DEV_PORT="7111"

PROD_APP_DIR="/home/sanskarpandit/gold-khata-book/prod"
PROD_PM2_NAME="gold-khata-book-backend-prod"
PROD_PORT="7110"

# --- Node --------------------------------------------------------------------
# The server's default `node` is 18 (end-of-life since April 2025); the app runs
# on 24, pinned explicitly in ecosystem.config.js. Without this, the remote
# `npm ci` and `npm run build` would run under 18 while the process that serves
# traffic runs under 24 — the build and the runtime on two different majors,
# with nothing anywhere saying so.
REMOTE_NODE_BIN="/home/sanskarpandit/.local/node24/bin"

# --- Health check ------------------------------------------------------------
# Path hit on 127.0.0.1:<port> after restart. Empty to skip.
HEALTH_PATH="/api/platform/config"
