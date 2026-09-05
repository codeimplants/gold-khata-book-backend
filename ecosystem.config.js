/**
 * PM2 process definitions for the Hostinger VPS (apps.codeimplants.com).
 *
 * Each environment runs from its OWN checkout. This matters: in the app this
 * was forked from, every environment ran from a single directory and a single
 * dist/, differing only by NODE_ENV and PORT — so `npm run build` for any
 * environment replaced the code all of them executed, and prod picked it up on
 * its next restart for any reason. Deploying "to dev" was never a safe
 * rehearsal; there was no code isolation, only database separation.
 *
 * Each checkout holds its own .env, which is why the env block below only
 * needs NODE_ENV and PORT.
 *
 * Deploy with scripts/deploy.sh, which targets one environment at a time.
 * Reload after editing this file:  pm2 startOrReload ecosystem.config.js
 */

/**
 * Both environments live under one parent directory, unlike the other apps on
 * this box (sonebill-backend-dev, nexus-backend-prod, … sit flat in $HOME).
 * Grouping them keeps everything this product owns in one place on a server
 * that hosts six unrelated apps.
 */
const BASE = '/home/sanskarpandit/gold-khata-book';

/**
 * Prefixes every captured stdout/stderr line with a timestamp.
 *
 * Without this PM2 writes the raw line and nothing else, which is how a
 * production incident on 15 Aug 2026 ended up unanswerable: the log held nine
 * identical OTP failures with no way to date them, group them into incidents,
 * or tell one user's attempts from another's. Milliseconds and the offset are
 * both deliberate — retries land within the same second, and the box runs UTC
 * while the people reading the log do not.
 */
const LOG_DATE_FORMAT = 'YYYY-MM-DD HH:mm:ss.SSS Z';

/**
 * Node 24 (Krypton LTS), stated explicitly rather than inherited.
 *
 * These apps used to declare no interpreter, so they ran on whatever `node` PM2
 * resolved first — the system Node 18, which has been end-of-life since April
 * 2025. Inheriting like that is not just outdated, it is invisible: nothing in
 * this repo said which runtime production used, and a change to the system node
 * would have moved all three onto a new major version at their next restart,
 * with no diff anywhere to show it happened.
 *
 * The interpreter is located rather than hardcoded so this file works on any
 * account, and it throws rather than silently falling back — a loud failure at
 * start beats discovering months later that prod is on a runtime nobody chose.
 * Verified on 23 Aug 2026: all three start, connect to MongoDB and serve
 * requests under 24 with the existing node_modules, no rebuild required.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

const NODE_24_CANDIDATES = [
  path.join(os.homedir(), '.local/node24/bin/node'),
  path.join(os.homedir(), 'node24/bin/node'),
];
const NODE_24 = NODE_24_CANDIDATES.find((p) => fs.existsSync(p));

if (!NODE_24) {
  throw new Error(
    `Node 24 not found. Looked in:\n  ${NODE_24_CANDIDATES.join('\n  ')}`
  );
}

/**
 * Ports 7110/7111, NOT the 7100/7101 this file used to claim.
 *
 * 7100 and 7101 belong to goldrate-backend-prod and goldrate-backend-dev, which
 * have been listening on this box since before gold-khata-book existed. The
 * numbers here were inherited from the fork and were never checked against the
 * server; starting either process would have failed with EADDRINUSE, or — worse
 * on a restart race — bound the port and taken goldrate down.
 *
 * 7112 is deliberately left free for a preprod instance, so adding one later
 * does not have to renumber anything.
 *
 * The pm2 process names keep the full `gold-khata-book-backend-` prefix even
 * though the directories are just dev/ and prod/: pm2's process list is global
 * across all six apps on this box, so a process called plain "prod" would be
 * ambiguous in `pm2 list` and dangerous in `pm2 restart`.
 */
module.exports = {
  apps: [
    {
      name: 'gold-khata-book-backend-prod',
      script: 'dist/server.js',
      interpreter: NODE_24,
      cwd: `${BASE}/prod`,
      log_date_format: LOG_DATE_FORMAT,
      env: {
        NODE_ENV: 'prod',
        PORT: 7110,
      },
    },
    {
      name: 'gold-khata-book-backend-dev',
      script: 'dist/server.js',
      interpreter: NODE_24,
      cwd: `${BASE}/dev`,
      log_date_format: LOG_DATE_FORMAT,
      env: {
        NODE_ENV: 'dev',
        PORT: 7111,
      },
    },
  ],
};
