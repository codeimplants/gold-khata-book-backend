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

    1) dev       (port 7111)  - safe to break
    2) prod      (port 7110)  - REAL SHOPS
    3) inspect   - just show what each server is running, change nothing

  Enter 1-3 [1]: 1

  Which branch? Press Enter for the normal one (main).
  Branch [main]:

  Continue? [y/N]: y
```

It finishes with either:

```
  Deploy finished OK.
```

or a clearly marked failure. The window stays open either way so you can read it.

**If you are not sure what state the servers are in, pick option 3 first.** It only reads; it cannot
change anything.

---

## What the two environments are

Both live under **one folder on the server**, `/home/sanskarpandit/gold-khata-book/`, and each is a
separate checkout with its own `.env` and its own database. They do not share code. Building one
cannot affect the other.

| | Folder | Port | Who uses it | If you break it |
|---|---|---|---|---|
| **dev** | `gold-khata-book/dev` | 7111 | You, and test APKs built with `-AppEnv dev` | Nothing happens. Fix it and deploy again. |
| **prod** | `gold-khata-book/prod` | 7110 | **Real jewellery shops, running their real billing** | Real shops cannot bill customers |

> There is no preprod. Port 7112 is left unused so one can be added without renumbering anything.
>
> The ports are 7110/7111, not the 7100/7101 this document claimed when it was forked — those belong
> to `goldrate-backend`, which was already running on this box.
>
> Separate checkouts matter: the app this was forked from ran every environment from one folder and
> one `dist/`, so building "for dev" replaced the code prod would run on its next restart. Deploying
> to dev was never a safe rehearsal there. It is here.

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

## Deploying a branch that isn't `main`

By default every environment deploys `main`. That is what you want almost always.

Sometimes you need to test a feature branch on a real server before merging — most often because you
want to run a test APK on your phone against real infrastructure. Then, at the branch prompt, type
the branch name instead of pressing Enter:

```
  Branch [main]: feat/old-gold-declaration
```

Or from the shell:

```sh
bash scripts/deploy.sh --env dev --branch feat/old-gold-declaration
```

**This applies to that one run and is never saved anywhere.** The next deploy goes back to `main`
on its own — there is nothing to remember to undo. That is deliberate: a setting you must remember to
revert is a setting that eventually ships a feature branch to production.

The script announces a non-default branch every single time:

```
Branch for 'dev' is 'feat/old-gold-declaration' (not the default 'main').
Target: dev → /home/sanskarpandit/gold-khata-book/dev @ origin/feat/old-gold-declaration
```

**Do not do this on prod.** Prod should only ever run `main`. If you type a branch name for prod,
the script warns you loudly, but it will not stop you.

### If you want it to stick

For a longer-lived arrangement (say dev tracks a release branch for a week), set it in
`scripts/deploy.config.sh`:

```sh
DEV_BRANCH="release/2.0"
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
ERROR: Uncommitted local changes on 'main'. The server deploys origin/main,
so your uncommitted work would NOT ship — deployed code would silently differ
from what you tested. Commit or stash first.
```

This is a **hard stop**, and only when you are on the branch being deployed. If you are on some other
branch, those changes were never going to ship, so it just tells you and continues.

**Guard 2 — unpushed commits.**

```
Local HEAD differs from origin/main — the server deploys origin/main.
Push first if you meant to ship your local commits.
Continue anyway? [y/N]
```

A prompt, not a stop — sometimes you legitimately deploy someone else's pushed work.

> The server deploys **what is on GitHub**, never what is on your disk. Both guards exist purely to
> keep that fact from surprising you.

---

## When it goes wrong

**`Cannot SSH to 'hostinger-vps'`**
Your SSH key isn't set up. Add to `~/.ssh/config`:
```
Host hostinger-vps
  HostName 31.97.61.191
  User sanskarpandit
  IdentityFile ~/.ssh/vps_sanskarpandit_claude
```
Then ask someone to authorise your key on the server.

Log in as `sanskarpandit`, **not** root. The script wraps every remote command in
`sudo -u sanskarpandit`, which needs no password when you are already that user. As root it would
leave root-owned files in the checkout and break git with "dubious ownership".

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
ssh hostinger-vps "sudo -u sanskarpandit -H pm2 logs gold-khata-book-backend-dev --lines 50"
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

For a fast mitigation when a bad deploy is actively breaking prod, revert the commit on `main`,
push, and deploy. This is fast because `npm ci` and `tsc` are the only slow steps.

---

## Related

- `scripts/deploy.sh` — the implementation; the header comment is the flag reference
- `ecosystem.config.js` — PM2 process definitions (ports, `NODE_ENV`, folders)
- `dev-help/ai/script-based-deployment.md` — the same system, written for AI agents
