#!/usr/bin/env bash
#
# Deploys gold-khata-book-backend to the Hostinger VPS (apps.codeimplants.com).
#
# Usage:
#   ./scripts/deploy.sh                            # asks which environment, then deploys
#   ./scripts/deploy.sh --inspect                  # report server state, change nothing
#   ./scripts/deploy.sh --env preprod              # build + restart preprod
#   ./scripts/deploy.sh --env prod --yes           # prod without the confirm prompt
#   ./scripts/deploy.sh --env prod --dry-run       # print remote commands, run none
#   ./scripts/deploy.sh --env prod --restart-only  # restart, no pull/build
#
# Windows: run `scripts\deploy.ps1` instead — same prompts, no bash needed.
#
# Flags:
#   --env <dev|preprod|prod>  Target environment. Omit it and you'll be asked,
#                             as long as you're at a terminal. ALWAYS pass it
#                             explicitly for automated/AI runs — otherwise the
#                             prompt waits on stdin and hangs.
#   --branch <name>           Deploy this branch instead of the configured one,
#                             for this run only. Nothing is written to disk, so
#                             it cannot be left set by accident. Use it to
#                             rehearse a feature branch on dev.
#   --yes                     Skip the production confirmation. ALWAYS pass this for
#                             automated/AI runs — otherwise prod waits on stdin and hangs.
#   --dry-run                 Show the remote script; make no changes.
#   --restart-only            Skip git pull / npm ci / build; just restart the process.
#   --inspect                 Read-only survey of the server.
#
# Each environment runs from its own checkout, so a build for one cannot affect
# another. Deploying to dev or preprod is a genuine rehearsal for prod.
#
#   gold-khata-book-backend-prod     NODE_ENV=prod     PORT=7100
#   gold-khata-book-backend-preprod  NODE_ENV=preprod  PORT=7102
#   gold-khata-book-backend-dev      NODE_ENV=dev      PORT=7101
#
# (Before the split all three ran from one directory and one dist/, so building
# for dev also replaced the code prod would run on its next restart.)
#
# Each environment also picks its own git branch: <ENV>_BRANCH in
# deploy.config.sh, falling back to BRANCH. That's what makes dev usable for
# rehearsing a feature branch without putting it on the branch prod deploys from.
#
# Secrets: each checkout holds its own .env on the server and is never
# read or transported by this script.

set -euo pipefail

RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YEL=$'\033[1;33m'; CYA=$'\033[0;36m'; NC=$'\033[0m'
info() { printf '%s%s%s\n' "$CYA" "$*" "$NC"; }
ok()   { printf '%s%s%s\n' "$GRN" "$*" "$NC"; }
warn() { printf '%s%s%s\n' "$YEL" "$*" "$NC"; }
die()  { printf '%s%s%s\n' "$RED" "ERROR: $*" "$NC" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$ROOT/scripts/deploy.config.sh"

ENV_NAME=""; ASSUME_YES=0; DRY_RUN=0; RESTART_ONLY=0; INSPECT=0; BRANCH_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)          ENV_NAME="${2:-}"; shift 2 ;;
    --branch)       BRANCH_OVERRIDE="${2:-}"; shift 2 ;;
    --yes|-y)       ASSUME_YES=1; shift ;;
    --dry-run)      DRY_RUN=1; shift ;;
    --restart-only) RESTART_ONLY=1; shift ;;
    --inspect)      INSPECT=1; shift ;;
    # Prints the whole header comment, however long it is. A hardcoded line
    # range silently truncates --help mid-sentence the moment the header grows,
    # which is exactly what happened when --branch was documented.
    -h|--help)      awk 'NR>1 { if (/^#/) { sub(/^# ?/, ""); print } else exit }' \
                      "${BASH_SOURCE[0]}"; exit 0 ;;
    *)              die "Unknown argument: $1  (try --help)" ;;
  esac
done

[[ -f "$CONFIG" ]] || die "Missing $CONFIG
  cp scripts/deploy.config.example.sh scripts/deploy.config.sh"
# shellcheck source=/dev/null
source "$CONFIG"
[[ -n "${DEPLOY_SSH_HOST:-}" ]] || die "DEPLOY_SSH_HOST not set in $CONFIG"
[[ -n "${APP_USER:-}" ]] || die "APP_USER not set in $CONFIG"

ssh -o BatchMode=yes -o ConnectTimeout=10 "$DEPLOY_SSH_HOST" true 2>/dev/null \
  || die "Cannot SSH to '$DEPLOY_SSH_HOST'. Check ~/.ssh/config and that your key is authorised."

# Run a command on the server as the account that owns the checkout. Running as
# root breaks git ("dubious ownership") and leaves root-owned files behind.
as_app_user() { printf 'sudo -u %s -H bash -lc %q' "$APP_USER" "$1"; }

# --- inspect ------------------------------------------------------------------
if [[ $INSPECT -eq 1 ]]; then
  info "Inspecting $DEPLOY_SSH_HOST (read-only)..."
  ssh "$DEPLOY_SSH_HOST" "$(as_app_user "
    echo '=== pm2 ==='; pm2 list
    for d in '$DEV_APP_DIR' '$PREPROD_APP_DIR' '$PROD_APP_DIR'; do
      echo; echo \"=== \$d ===\"
      if [ ! -d \"\$d\" ]; then echo 'MISSING'; continue; fi
      cd \"\$d\"
      echo 'branch:  '\$(git rev-parse --abbrev-ref HEAD)
      echo 'commit:  '\$(git log -1 --oneline)
      echo '.env:    '\$([ -f .env ] && echo present || echo MISSING)
      echo 'dist:    '\$([ -f dist/server.js ] && date -r dist/server.js '+%Y-%m-%d %H:%M' || echo MISSING)
    done
    echo; echo '=== node ==='; node -v
  ")"
  ok "Inspection complete — nothing changed."
  exit 0
fi

# --- environment selection ----------------------------------------------------
# Ask when --env was omitted, so a developer can just run the script. Guarded on
# a real terminal: a non-interactive caller (CI, an AI agent, a cron) must fail
# fast with a usable message rather than block forever on a read that can never
# be answered.
if [[ -z "$ENV_NAME" ]]; then
  if [[ ! -t 0 ]]; then
    die "--env is required (dev|preprod|prod) when not running interactively."
  fi
  echo
  info "Which environment do you want to deploy?"
  echo "  1) dev      ($DEV_PM2_NAME, port $DEV_PORT)"
  echo "  2) preprod  ($PREPROD_PM2_NAME, port $PREPROD_PORT)"
  echo "  3) prod     ($PROD_PM2_NAME, port $PROD_PORT)"
  echo
  read -r -p "Enter 1, 2 or 3 [1]: " choice
  case "${choice:-1}" in
    1|dev)     ENV_NAME="dev" ;;
    2|preprod) ENV_NAME="preprod" ;;
    3|prod)    ENV_NAME="prod" ;;
    *)         die "Invalid choice '$choice'" ;;
  esac
  info "Selected: $ENV_NAME"
fi

# Captured before the per-env override below overwrites BRANCH, so the warning
# further down can tell "this env is on something unusual" from "everything is".
DEFAULT_BRANCH="${BRANCH:-master}"

case "$ENV_NAME" in
  dev)     APP_DIR="$DEV_APP_DIR";     PM2_NAME="$DEV_PM2_NAME";     PORT="$DEV_PORT"
           BRANCH="${DEV_BRANCH:-$BRANCH}" ;;
  preprod) APP_DIR="$PREPROD_APP_DIR"; PM2_NAME="$PREPROD_PM2_NAME"; PORT="$PREPROD_PORT"
           BRANCH="${PREPROD_BRANCH:-$BRANCH}" ;;
  prod)    APP_DIR="$PROD_APP_DIR";    PM2_NAME="$PROD_PM2_NAME";    PORT="$PROD_PORT"
           BRANCH="${PROD_BRANCH:-$BRANCH}" ;;
  *)       die "Invalid --env '$ENV_NAME'" ;;
esac
[[ -n "$APP_DIR" ]] || die "APP_DIR for '$ENV_NAME' not set in $CONFIG"

# --branch beats both the per-env config override and the global default. It is
# per-run and never written anywhere, which is the point: a one-shot override
# cannot be left behind to surprise the next person who deploys.
if [[ -n "$BRANCH_OVERRIDE" ]]; then
  BRANCH="$BRANCH_OVERRIDE"
fi

[[ -n "${BRANCH:-}" ]] || die "No branch configured for '$ENV_NAME' (set BRANCH in $CONFIG)"

# A one-off branch on production is almost always a mistake — you'd be shipping
# something that isn't on the release branch to real shops.
if [[ -n "$BRANCH_OVERRIDE" && "$ENV_NAME" == "prod" ]]; then
  warn "You are deploying a NON-DEFAULT branch to PRODUCTION: '$BRANCH'."
  warn "Real shops will run this code. Ctrl-C now unless that is genuinely intended."
fi

# Deploying something other than the default branch is the exception, so say so
# out loud every time — a forgotten override is how a feature branch reaches an
# environment nobody expected it in.
if [[ "$BRANCH" != "$DEFAULT_BRANCH" ]]; then
  warn "Branch for '$ENV_NAME' is '$BRANCH' (not the default '$DEFAULT_BRANCH')."
fi
info "Target: $ENV_NAME → $APP_DIR @ origin/$BRANCH"

# --- local guards -------------------------------------------------------------
#
# These exist to catch one specific mistake: you tested something locally, then
# deployed without pushing it, so the server built different code than you tried.
# That illusion is only possible when your working copy is ON the branch being
# deployed. Deploying some other branch (dev pointed at a colleague's feature
# branch, say) is a deliberate act, and warning about it every time just trains
# people to hit "y" without reading — which is how the warning that matters gets
# ignored too.
if [[ $RESTART_ONLY -eq 0 ]]; then
  LOCAL_BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
  ON_TARGET_BRANCH=0
  [[ "$LOCAL_BRANCH" == "$BRANCH" ]] && ON_TARGET_BRANCH=1

  DIRTY="$(git -C "$ROOT" status --porcelain)"

  if [[ -n "$DIRTY" ]]; then
    if [[ $ON_TARGET_BRANCH -eq 1 ]]; then
      die "Uncommitted local changes on '$BRANCH'. The server deploys origin/$BRANCH,
so your uncommitted work would NOT ship — deployed code would silently differ
from what you tested. Commit or stash first."
    else
      # Not the branch being deployed, so this work was never going to ship and
      # there is no discrepancy to be surprised by. Say it and move on.
      warn "You have uncommitted changes on '$LOCAL_BRANCH', but '$BRANCH' is being deployed."
      warn "They are unrelated to this deploy and will not ship."
    fi
  fi

  git -C "$ROOT" fetch --quiet origin "$BRANCH"

  if [[ $ON_TARGET_BRANCH -eq 1 ]]; then
    if [[ "$(git -C "$ROOT" rev-parse HEAD)" != "$(git -C "$ROOT" rev-parse "origin/$BRANCH")" ]]; then
      warn "Local HEAD differs from origin/$BRANCH — the server deploys origin/$BRANCH."
      warn "Push first if you meant to ship your local commits."
      # --dry-run must never block on input: it exists to be safe to run anywhere,
      # including non-interactively, where a read would hang until timeout.
      [[ $ASSUME_YES -eq 1 || $DRY_RUN -eq 1 ]] \
        || { read -r -p "Continue anyway? [y/N] " a; [[ "$a" =~ ^[Yy]$ ]] || exit 1; }
    fi
  else
    info "Deploying origin/$BRANCH; your working copy is on '${LOCAL_BRANCH:-detached HEAD}'."
    info "Server commit will be: $(git -C "$ROOT" log -1 --oneline "origin/$BRANCH" 2>/dev/null || echo unknown)"
  fi
fi

# --- confirmation -------------------------------------------------------------
# Only prod needs typed confirmation now: each environment has its own checkout,
# so deploying dev or preprod cannot affect what prod is running.
if [[ "$ENV_NAME" == "prod" && $ASSUME_YES -eq 0 && $DRY_RUN -eq 0 ]]; then
  warn "About to deploy to PRODUCTION ($DEPLOY_SSH_HOST:$APP_DIR, pm2 '$PM2_NAME')."
  warn "Commit: $(git -C "$ROOT" log -1 --oneline "origin/$BRANCH" 2>/dev/null || echo unknown)"
  read -r -p "Type 'deploy' to continue: " a
  [[ "$a" == "deploy" ]] || { info "Aborted."; exit 1; }
fi

if [[ $RESTART_ONLY -eq 1 ]]; then
  BUILD_STEPS="echo '--- restart only: skipping pull/install/build ---'"
else
  # `git reset --hard origin/<branch>` alone moves the commit but leaves HEAD on
  # whatever local branch was already checked out — so after deploying a feature
  # branch the server still reports "master" while running something else, and
  # --inspect quietly lies about what is deployed. `checkout -B` points the local
  # branch name at the remote one too, so the reported branch is the real one.
  BUILD_STEPS="echo '--- fetching $BRANCH ---'
git fetch --quiet origin '$BRANCH'
git reset --hard HEAD
git checkout -B '$BRANCH' 'origin/$BRANCH'
git reset --hard 'origin/$BRANCH'
echo 'now on:  '\$(git rev-parse --abbrev-ref HEAD)
echo 'now at: '\$(git log -1 --oneline)
# npm ci deletes node_modules BEFORE it fetches anything, so a failed download
# leaves the checkout with no dependencies at all. The running pm2 process keeps
# serving from memory and looks healthy, but the next restart -- a deploy, a
# reboot, an OOM kill -- finds nothing to load. That window opened twice on
# 18 Aug 2026 when a prebuilt binary download to GitHub timed out.
#
# So: move the working tree aside, and put it back if the install does not
# complete. Retried because these failures are transient CDN timeouts, not
# anything this box can fix -- it has no compiler, so a source fallback is not
# available to any native module.
if [ -d node_modules ]; then rm -rf node_modules.prev; mv node_modules node_modules.prev; fi
npm_ci_ok=0
for attempt in 1 2 3; do
  echo \"--- npm ci (attempt \$attempt/3) ---\"
  if npm ci; then npm_ci_ok=1; break; fi
  echo 'npm ci failed; retrying in 5s'
  sleep 5
done
if [ \$npm_ci_ok -ne 1 ]; then
  echo 'ERROR: npm ci failed 3 times — restoring the previous node_modules and aborting'
  rm -rf node_modules
  if [ -d node_modules.prev ]; then mv node_modules.prev node_modules; fi
  exit 1
fi
rm -rf node_modules.prev

npm run build"
fi

REMOTE="set -euo pipefail
cd '$APP_DIR'
echo 'was at: '\$(git log -1 --oneline)
test -f .env || { echo 'ERROR: .env missing in $APP_DIR — refusing to restart'; exit 1; }
$BUILD_STEPS
pm2 restart '$PM2_NAME' --update-env
pm2 describe '$PM2_NAME' | grep -E 'status|restarts' || true"

if [[ $DRY_RUN -eq 1 ]]; then
  warn "DRY RUN — would run on $DEPLOY_SSH_HOST as $APP_USER:"
  printf '%s\n' "$REMOTE"
  exit 0
fi

info "Deploying '$ENV_NAME' → $DEPLOY_SSH_HOST:$APP_DIR (pm2: $PM2_NAME) ..."
ssh "$DEPLOY_SSH_HOST" "$(as_app_user "$REMOTE")"

if [[ -n "${HEALTH_PATH:-}" ]]; then
  info "Health check on 127.0.0.1:$PORT$HEALTH_PATH ..."
  sleep 3
  CODE="$(ssh "$DEPLOY_SSH_HOST" "curl -s -o /dev/null -w '%{http_code}' --max-time 10 'http://127.0.0.1:$PORT$HEALTH_PATH'" || echo 000)"
  if [[ "$CODE" =~ ^[23] ]]; then
    ok "Health check passed (HTTP $CODE)."
  else
    die "Health check FAILED (HTTP $CODE) — process restarted but is not serving.
  ssh $DEPLOY_SSH_HOST \"sudo -u $APP_USER -H pm2 logs $PM2_NAME --lines 50\""
  fi
fi

ok "Deployed '$ENV_NAME'."
