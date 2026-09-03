# Deploying the Backend

How to get code from your machine onto the server, and how to tell whether it worked.

You do not need to know SSH, PM2, or the server layout to deploy. Double-click a file and answer two
questions. The rest of this document is for when something goes wrong, or when you need to do
something less usual.

---

## The 30-second version

Double-click **`scripts\deploy.cmd`**.

```
  Which environment?

    1) dev       (port 7101)  - safe to break
    2) preprod   (port 7102)
    3) prod      (port 7100)  - REAL SHOPS
    4) inspect   - just show what each server is running, change nothing

  Enter 1-4 [1]: 1

  Which branch? Press Enter for the normal one (master).
  Branch [master]:

  Continue? [y/N]: y
```

It finishes with either:

```
  Deploy finished OK.
```

or a clearly marked failure. The window stays open either way so you can read it.

**If you are not sure what state the servers are in, pick option 4 first.** It only reads; it cannot
change anything.

---

## What the three environments are

Each one is a **separate folder on the server with its own `.env` and its own database**. They do not
share code. Building one cannot affect another.

| | Port | Who uses it | If you break it |
|---|---|---|---|
| **dev** | 7101 | You, and test APKs built with `-AppEnv dev` | Nothing happens. Fix it and deploy again. |
| **preprod** | 7102 | Final rehearsal before a release | Nobody outside the team notices |
| **prod** | 7100 | **Real jewellery shops, running their real billing** | Real shops cannot bill customers |

> This separation is newer than the project. Previously all three ran from one folder and one `dist/`,
> so building "for dev" replaced the code prod would run on its next restart. Deploying to dev was
> never a safe rehearsal. It is now.

---

## Other ways to run it

All three do exactly the same thing — `deploy.cmd` and `deploy.ps1` just call `deploy.sh`. There is
one implementation, so none of them can drift from the others.

| | Use when |
|---|---|
| `scripts\deploy.cmd` | Double-clicking. No terminal needed. |
| `scripts\deploy.ps1` | You are already in PowerShell |
| `bash scripts/deploy.sh` | You are on Mac/Linux, or want the flags |

Useful flags on the shell script:

```sh
bash scripts/deploy.sh --inspect                 # read-only: what is each server running?
bash scripts/deploy.sh --env dev                 # deploy dev, no questions
bash scripts/deploy.sh --env dev --dry-run       # print what WOULD run on the server, change nothing
bash scripts/deploy.sh --env prod --restart-only # restart the process, no pull or rebuild
bash scripts/deploy.sh --env dev --branch my-feature
```

`--dry-run` is safe to run any time, against any environment, including prod. It never changes
anything.

---

## Deploying a branch that isn't `master`

By default every environment deploys `master`. That is what you want almost always.

Sometimes you need to test a feature branch on a real server before merging — most often because you
want to run a test APK on your phone against real infrastructure. Then, at the branch prompt, type
the branch name instead of pressing Enter:

```
  Branch [master]: feat/old-gold-declaration
```

Or from the shell:

```sh
bash scripts/deploy.sh --env dev --branch feat/old-gold-declaration
```

**This applies to that one run and is never saved anywhere.** The next deploy goes back to `master`
on its own — there is nothing to remember to undo. That is deliberate: a setting you must remember to
revert is a setting that eventually ships a feature branch to production.

The script announces a non-default branch every single time:

```
Branch for 'dev' is 'feat/old-gold-declaration' (not the default 'master').
Target: dev → /home/sanskarpandit/gold-khata-book-backend-dev @ origin/feat/old-gold-declaration
```

**Do not do this on prod.** Prod should only ever run `master`. If you type a branch name for prod,
the script warns you loudly, but it will not stop you.

### If you want it to stick

For a longer-lived arrangement (say preprod tracks a release branch for a week), set it in
`scripts/deploy.config.sh`:

```sh
PREPROD_BRANCH="release/2.0"
```

That file is **gitignored** — it is yours alone and cannot be committed or affect anyone else.

---

## What actually happens when you deploy

1. **Checks you can reach the server.** Fails immediately if not.
2. **Checks your local git state** — see "The two guards" below.
3. On the server, as the app user (never root — root breaks git with "dubious ownership"):
   - Refuses to continue if `.env` is missing, rather than restarting into a broken config
   - `git fetch` + checkout the target branch
   - `npm ci`
   - `npm run build`
   - `pm2 restart`
4. **Health check:** requests `/api/platform/config` on the environment's port.

Step 4 is the one that matters. A process can restart "successfully" and still not serve — wrong env
var, failed DB connection, port already taken. **Nothing is reported as deployed until the port
actually answers.** If the health check fails, the script tells you the exact command to read the
logs.

Steps 3 and 4 stop on the first failure. A build error means the old process is still running and
serving — you have not taken the site down, you just haven't updated it.

---

## The two guards, and what they are protecting you from

Both exist to prevent one specific, easy mistake: **you tested something locally, deployed without
pushing, and the server built different code than you tried.** You then debug a version that exists
nowhere but your laptop.

**Guard 1 — uncommitted changes.**

```
ERROR: Uncommitted local changes on 'master'. The server deploys origin/master,
so your uncommitted work would NOT ship — deployed code would silently differ
from what you tested. Commit or stash first.
```

This is a **hard stop**, and only when you are on the branch being deployed. If you are on some other
branch, those changes were never going to ship, so it just tells you and continues.

**Guard 2 — unpushed commits.**

```
Local HEAD differs from origin/master — the server deploys origin/master.
Push first if you meant to ship your local commits.
Continue anyway? [y/N]
```

A prompt, not a stop — sometimes you legitimately deploy someone else's pushed work.

> The server deploys **what is on GitHub**, never what is on your disk. Both guards exist purely to
> keep that fact from surprising you.

---

## When it goes wrong

**`Cannot SSH to 'goldkhatabook-vps'`**
Your SSH key isn't set up. Add to `~/.ssh/config`:
```
Host goldkhatabook-vps
  HostName 31.97.61.191
  User root
  IdentityFile ~/.ssh/id_goldkhatabook_vps
```
Then ask someone to authorise your key on the server.

**`Missing scripts/deploy.config.sh`**
```sh
cp scripts/deploy.config.example.sh scripts/deploy.config.sh
```
Server addresses only, no secrets. Gitignored.

**`Git Bash not found`** (from `.cmd` / `.ps1`)
Install Git for Windows: https://git-scm.com/download/win

**`Health check FAILED (HTTP 000)` or `502`**
The process restarted but is not serving. The script prints the command to read the logs — run it:
```sh
ssh goldkhatabook-vps "sudo -u sanskarpandit -H pm2 logs gold-khata-book-backend-dev --lines 50"
```
Usually a missing env var or a database it cannot reach.

**`ERROR: .env missing`**
That environment's checkout has lost its `.env`. The script refuses to restart rather than bring the
service up misconfigured. It must be restored on the server; it is not in git and never will be.

**The deploy said OK but the app still behaves the old way**
Run `--inspect` and read the `commit:` line for that environment. If it isn't the commit you expect,
you probably deployed a different branch than you meant to.

---

## Rolling back

There is no rollback command. Deploy is just "check out this commit and rebuild", so **rolling back
is deploying the previous commit** — revert on the branch, push, deploy again.

For a fast mitigation when a bad deploy is actively breaking prod, revert the commit on `master`,
push, and deploy. This is fast because `npm ci` and `tsc` are the only slow steps.

---

## Related

- `scripts/deploy.sh` — the implementation; the header comment is the flag reference
- `ecosystem.config.js` — PM2 process definitions (ports, `NODE_ENV`, folders)
- `dev-help/ai/script-based-deployment.md` — the same system, written for AI agents
