# Deploy configuration for gold-khata-book-backend.
#
# SETUP: copy this file to scripts/deploy.config.sh and adjust if the server changes.
#   cp scripts/deploy.config.example.sh scripts/deploy.config.sh
#
# deploy.config.sh is gitignored. It holds server addresses only — never secrets.
# Application secrets live in .env.dev / .env.preprod / .env.prod ON THE SERVER
# and are never read, written or transported by this script.

# --- SSH ---------------------------------------------------------------------
# Add this to ~/.ssh/config, then put the alias here:
#
#   Host goldkhatabook-vps
#     HostName 31.97.61.191
#     User root
#     IdentityFile ~/.ssh/id_goldkhatabook_vps
#
DEPLOY_SSH_HOST="goldkhatabook-vps"

# --- Server layout -----------------------------------------------------------
# Each environment has its OWN checkout, so building one cannot affect another.
# (Until the split they shared a single checkout and dist/, which meant a build
# for dev also replaced the code prod would run on its next restart.)
#
# Checkouts are owned by APP_USER, not root, so git/npm/pm2 must run as them.
APP_USER="sanskarpandit"

# Branch every environment deploys unless told otherwise.
BRANCH="master"

# Optional per-environment branch. Leave these commented out unless you have a
# standing reason — a release branch that preprod should track for a while, say.
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
# DEV_BRANCH="master"
# PREPROD_BRANCH="master"
# PROD_BRANCH="master"

# Per-environment checkout, PM2 process name (from `pm2 list` as APP_USER),
# and the port that instance listens on.
DEV_APP_DIR="/home/sanskarpandit/gold-khata-book-backend-dev"
DEV_PM2_NAME="gold-khata-book-backend-dev"
DEV_PORT="7101"

PREPROD_APP_DIR="/home/sanskarpandit/gold-khata-book-backend-preprod"
PREPROD_PM2_NAME="gold-khata-book-backend-preprod"
PREPROD_PORT="7102"

PROD_APP_DIR="/home/sanskarpandit/gold-khata-book-backend-prod"
PROD_PM2_NAME="gold-khata-book-backend-prod"
PROD_PORT="7100"

# --- Health check ------------------------------------------------------------
# Path hit on 127.0.0.1:<port> after restart. Empty to skip.
HEALTH_PATH="/api/platform/config"
