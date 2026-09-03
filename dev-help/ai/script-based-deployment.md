# Operating Instructions — Script-Based Backend Deployment

Direct instructions for an AI agent deploying `gold-khata-book-backend`, and for building the same
deploy tooling in another project.

**Read §1 before running anything.** It contains the two ways an agent silently ruins a deploy:
hanging forever on a prompt, and reporting success while the server runs different code than
intended. Both have happened here.

Human-facing version of the same system: `dev-help/deploying-the-backend.md`.

---

## 1. Rules that are not negotiable

**1.1 — Always pass `--env` explicitly.** Omitting it makes the script prompt. There is a
`[[ -t 0 ]]` guard that turns that into a fast failure when stdin is not a terminal, but do not rely
on it: an agent harness that allocates a PTY looks interactive and *will* block until timeout.

```sh
bash scripts/deploy.sh --env dev          # correct
bash scripts/deploy.sh                    # never do this
```

**1.2 — Always pass `--yes` for prod.** Prod requires typing the literal word `deploy` on stdin.
Without `--yes`, a prod deploy hangs.

```sh
bash scripts/deploy.sh --env prod --yes
```

**1.3 — Never deploy prod unless the user asked for prod in this conversation.** "Deploy the
backend" without a named environment is not authorisation for production. Ask which environment, or
deploy `dev`. Prod runs real shops' billing; a bad deploy stops them taking money.

**1.4 — Run `--inspect` first, and `--dry-run` before anything unusual.** Both are read-only and safe
anywhere, including against prod.

```sh
bash scripts/deploy.sh --inspect
bash scripts/deploy.sh --env prod --dry-run
```

**1.5 — Never edit `scripts/deploy.config.sh` to change a branch.** Use `--branch`. See §4.

**1.6 — Do not hand-roll `ssh`, `git`, `pm2` or `npm` commands against the server.** The script
carries guards (`.env` presence check, app-user execution, health check) that a manual command does
not. If the script cannot do what is needed, say so rather than bypassing it.

---

## 2. Commands

```sh
bash scripts/deploy.sh --inspect                          # read-only survey
bash scripts/deploy.sh --env dev                          # deploy dev from its configured branch
bash scripts/deploy.sh --env dev --branch feat/x          # deploy a feature branch, this run only
bash scripts/deploy.sh --env preprod --dry-run            # show remote script, change nothing
bash scripts/deploy.sh --env prod --yes                   # deploy prod, no confirmation prompt
bash scripts/deploy.sh --env dev --restart-only           # restart only, no pull/build
```

On Windows `scripts/deploy.ps1` and `scripts/deploy.cmd` exist for humans. **Call `deploy.sh`
directly** — the wrappers add interactive prompts, which is the opposite of what you want.

---

## 3. Environments

| Env | Port | PM2 name | Server folder |
|---|---|---|---|
| dev | 7101 | `gold-khata-book-backend-dev` | `/home/sanskarpandit/gold-khata-book-backend-dev` |
| preprod | 7102 | `gold-khata-book-backend-preprod` | `/home/sanskarpandit/gold-khata-book-backend-preprod` |
| prod | 7100 | `gold-khata-book-backend-prod` | `/home/sanskarpandit/gold-khata-book-backend-prod` |

Separate checkouts, separate `.env`, separate databases. Building one cannot affect another, so
deploying dev is a genuine rehearsal for prod.

The same VPS also runs unrelated `nexus-backend-*` processes. **Do not touch them.**

---

## 4. Deploying a feature branch (`--branch`)

Every environment deploys `master` by default. The most common real task — "deploy my branch to dev
so I can test a build against it" — needs an override.

```sh
bash scripts/deploy.sh --env dev --branch feat/old-gold-declaration
```

**Why `--branch` and not the config file:** `--branch` applies to one run and is written nowhere. A
config-file override persists, and a persisted override is eventually forgotten, and a forgotten
override eventually deploys a feature branch to production. Prefer the flag that cannot outlive its
purpose.

`<ENV>_BRANCH` in `deploy.config.sh` exists for standing arrangements set up by a human. Do not
create or modify them on your own initiative.

**Precedence:** `--branch` → `<ENV>_BRANCH` → `BRANCH`.

**Never pass `--branch` for prod** unless explicitly instructed. The script warns but proceeds.

---

## 5. The guards, and how to respond to them

**Uncommitted changes on the branch being deployed → hard stop.**
Correct response: commit and push, then deploy. Never `git stash` to get past it unless the user
asked — that silently drops their work from the deploy they think they are getting.

**Uncommitted changes on a different branch → warning, continues.** Nothing to do.

**Local HEAD differs from `origin/<branch>` → prompt.** Suppressed by `--yes`. Before using `--yes`
to skip it, confirm the branch is actually pushed; otherwise you deploy an older commit and then
debug code the server never had.

**The server deploys `origin/<branch>`, never your local working tree.** Push before you deploy. This
is the single most common way an agent produces a confusing result: local edits → deploy → test →
behaviour unchanged → conclude the code is wrong, when it was never uploaded.

---

## 6. Verification — do not stop at "Deployed"

`Deployed 'dev'.` means the script finished. It does not prove your change is live. Two failures pass
that bar: deploying the wrong branch, and a route that never registered.

**6.1 — Confirm the commit and branch:**
```sh
bash scripts/deploy.sh --inspect
```
Read the `branch:` and `commit:` lines for that environment. They must match what you pushed.

**6.2 — Confirm the behaviour changed.** For a new route, an unauthenticated request distinguishes
"route exists" from "route missing" without needing a token:

```sh
ssh goldkhatabook-vps "curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:7101/api/your-new-route"
```

| Code | Meaning |
|---|---|
| 401 | Route exists, auth middleware working — **deploy succeeded** |
| 404 | Route not registered — wrong branch, or not mounted in `modules/routes.ts` |
| 000 | Not serving at all — check `pm2 logs` |

**6.3 — For a new endpoint, check an environment you did *not* deploy** as a control. If dev returns
401 and prod returns 404, that positively proves the new code is on dev and absent from prod. Without
the control you cannot tell a successful deploy from a route that was always there.

**6.4 — On failure, read the logs:**
```sh
ssh goldkhatabook-vps "sudo -u sanskarpandit -H pm2 logs gold-khata-book-backend-dev --lines 50"
```

---

## 7. Assessing whether a backend change is safe to deploy to prod

When asked "will this break existing users", answer from the diff, not from memory. Check each:

| Check | Why it matters |
|---|---|
| Did any **existing route's** request/response shape change? | Old app versions in the wild still call it. Users cannot be forced to update. |
| Was a field **added to an existing Mongoose model**? | Mongoose applies schema defaults **on hydrate**. A new field with a default silently mutates old documents on their next save. `order.model.ts` documents a real instance of this. |
| Did any value in `inputLimits.ts` get **smaller**? | Payloads that were valid yesterday start failing validation. |
| Did an existing **index** change on a populated collection? | Index builds can lock. New collections are empty, so they are free. |
| Do the **sales/GST report** outputs change? | Those numbers may already be filed with tax authorities. |
| Were new **env vars** introduced? | They must exist in each server's `.env` first, or the process restarts into a crash loop. |
| Did `package.json` dependencies change? | `npm ci` runs on the server; a native module may need a rebuild. |

Purely additive changes — new module, new collection, new route, new optional fields — are safe.
State that conclusion **with the diff as evidence**, not as reassurance.

**Deploy order with a mobile release:** backend first, always. New app + old backend = 404s in users'
hands. Old app + new backend is fine when the change is additive.

---

## 8. Building this tooling in another project

The design, and the reasoning behind each piece.

**8.1 — One implementation, thin wrappers.** `deploy.sh` holds all logic. `deploy.ps1` and
`deploy.cmd` only locate bash and forward arguments. Reimplementing the logic per platform
guarantees divergence, and the divergence surfaces during an incident.

**8.2 — A checkout per environment.** Sharing one folder and one `dist/` across environments means
building for dev replaces the code prod runs on its next restart — for any reason, including an OOM
kill hours later. Separate folders are the only way "deploy to dev first" means anything.

**8.3 — Interactive prompts must be TTY-guarded.**
```sh
if [[ -z "$ENV_NAME" ]]; then
  if [[ ! -t 0 ]]; then
    die "--env is required (dev|preprod|prod) when not running interactively."
  fi
  ...
fi
```
Without the guard, every non-interactive caller hangs until timeout with no output explaining why.

**8.4 — Health check, not process status.** `pm2 restart` reporting success proves nothing; a process
can be up and not serving. Request a real endpoint on the real port and fail the deploy if it does
not answer:
```sh
CODE="$(ssh "$HOST" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT$HEALTH_PATH")"
[[ "$CODE" =~ ^[23] ]] || die "Health check FAILED (HTTP $CODE)"
```

**8.5 — `checkout -B`, not just `reset --hard`.**
```sh
git reset --hard HEAD
git checkout -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"
```
`git reset --hard origin/<branch>` alone moves the commit but leaves HEAD on whatever local branch
was checked out. **This shipped here and was caught within a minute of first use**: after deploying a
feature branch, `--inspect` reported `branch: master` while running entirely different code. The
inspection tool is what you trust during an incident; it must not be capable of lying.

**8.6 — Run as the app user, not root.** Root-owned files in the checkout break subsequent deploys,
and git refuses with "dubious ownership":
```sh
sudo -u "$APP_USER" -H bash -lc '<command>'
```

**8.7 — Refuse to restart when `.env` is missing.** Better to leave the old process serving than to
bring up a misconfigured one that starts and fails obscurely.

**8.8 — Secrets never leave the server.** The script transports no `.env` and reads no secret. Server
addresses live in a gitignored config; credentials live only in each server's `.env`.

**8.9 — Guards should distinguish the case they were written for.** The uncommitted-changes guard
catches "you tested locally and deployed without pushing" — only possible when your working tree is
on the branch being deployed. Prompting in every other case trains people to hit `y` unread, which
disarms the warning that matters. Hard-block the real case; inform and continue otherwise.

**8.10 — `pause` at the end of a double-clickable script.** A double-clicked console window closes
the instant the process exits, so without it a failure flashes past unread and the deploy looks like
it did nothing at all.

---

## 9. Files

| File | Role |
|---|---|
| `scripts/deploy.sh` | The implementation. Header comment is the flag reference. |
| `scripts/deploy.ps1` | Windows wrapper (PowerShell) |
| `scripts/deploy.cmd` | Windows wrapper, double-clickable |
| `scripts/deploy.config.sh` | Server addresses + branch defaults. **Gitignored.** |
| `scripts/deploy.config.example.sh` | Template, committed |
| `ecosystem.config.js` | PM2 process definitions |
