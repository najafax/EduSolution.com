# Telegram ops bot

Check on and update the backend droplet from your phone — status, today's
numbers, logs, restart, deploy — without SSHing in. Runs as its own systemd
service next to `edusolution-backend`, and proactively alerts you (not just
"check when you remember to") when the backend/nginx go down, disk fills up,
or the TLS cert is close to expiring.

It reads the database and calls the app's own business logic directly
(`computeSummary`, `computeDailyEarnings`, etc. — the same functions
`routes/financials.js`/`lib/dailyEarningsReport.js` already use), the same
"shell access on the box is already a higher trust level than anything the
in-app permission system controls" precedent `scripts/create-user.js`
already relies on — so there's no separate staff account or login step for
this bot to use.

## 1. Create the bot

In Telegram, message **@BotFather** → `/newbot` → follow the prompts. You'll
get back a token that looks like `123456789:AAFyourTokenHere`. That's your
`TELEGRAM_BOT_TOKEN`.

## 2. Get your Telegram user id

Message **@userinfobot** (or any similar "what's my id" bot) — it replies
with your numeric id, e.g. `123456789`. That's your
`TELEGRAM_ALLOWED_USER_IDS`. **Every command is restricted to this
allowlist** — anyone else messaging the bot is silently ignored, so don't
skip this step or share the bot token/link publicly. Add more than one id
by separating with commas (e.g. `123456789,987654321`) if more than one
person should be able to use it.

## 3. Configure

Add both values to the **same** `backend/.env` the main API already reads
(not a separate file) — on the droplet:

```bash
nano ~/edusolution-backend/backend/.env
```

```
TELEGRAM_BOT_TOKEN=123456789:AAFyourTokenHere
TELEGRAM_ALLOWED_USER_IDS=123456789
```

See `backend/.env.example` for the full list of optional overrides
(custom domain, service name, alert thresholds) — the defaults match this
project's own documented droplet setup (`deploy/digitalocean/`), so you
only need those if yours genuinely differs.

## 4. Install and enable

```bash
cd ~/edusolution-backend/backend/telegram-bot
npm install

cp ../../deploy/digitalocean/telegram-bot.service /etc/systemd/system/telegram-bot.service
# Edit WorkingDirectory in that file first if your checkout isn't at
# /home/deploy/edusolution-backend — e.g. if you operate as root with the
# repo cloned to /root/edusolution-backend instead.

systemctl daemon-reload
systemctl enable --now telegram-bot
systemctl status telegram-bot --no-pager -l
```

(No `sudo` needed if you're already root on this droplet, same as the main
backend service — see that unit's own note.)

## 5. Try it

Open a chat with your bot in Telegram and send `/help`. If nothing replies,
check `journalctl -u telegram-bot -n 50 --no-pager` — the most common
first-run issue is `TELEGRAM_BOT_TOKEN`/`TELEGRAM_ALLOWED_USER_IDS` not
actually landing in `backend/.env`, which the bot refuses to start without
(it exits with a clear message naming which one, rather than starting up
unreachable/unrestricted).

## Commands

- `/status` — backend + nginx state/uptime, database connectivity, memory
  usage, disk usage, TLS cert days left, public API reachability — the
  one-shot "is everything okay" check.
- `/db` — a deeper, on-demand database check: connectivity (same cheap
  `SELECT 1` `/status` uses), a full `PRAGMA integrity_check` (the real,
  thorough check — walks the whole file, so this stays out of the regular
  polling loop and is only ever run when you ask for it), the database
  file's own size and its WAL sidecar's size (a WAL file that's grown large
  and isn't shrinking can mean checkpointing isn't happening), and how long
  since the last daily backup.
- `/today` — bank balance, today's payments/expenses/net, overdue invoices,
  pending quote requests.
- `/backup` — when the last daily/weekly S3 backup ran.
- `/logs [n]` — last `n` lines of the backend's systemd journal (default 50,
  capped at 300).
- `/restart` — restarts `edusolution-backend` (asks you to confirm first,
  via an inline button).
- `/deploy` — `git fetch`/`checkout main`/`merge --ff-only` + `npm install`
  + restart, the same steps `deploy/digitalocean/deploy.sh` runs manually
  (asks you to confirm first). Stops and reports the exact failure at the
  first step that doesn't succeed — e.g. a merge that isn't a clean
  fast-forward — rather than pressing on or force-resetting anything.

## Alerts (no command needed)

Every `TELEGRAM_ALERT_INTERVAL_MINUTES` (default 5), the bot checks the
same things `/status` does and messages everyone on the allowlist the
moment any of these **changes state** — not on every single check, so an
ongoing problem doesn't re-alert you every 5 minutes:

- `edusolution-backend` or `nginx` stops being active (and a recovery
  message once it's back).
- The public API (`https://api.edusolutionsmaldives.com/...`) stops
  responding (and recovers).
- The database stops answering a plain `SELECT 1` (and recovers) — this is
  checked against the exact same SQLite connection the backend process
  itself uses, so it's a real proxy for "can the app actually serve a
  request right now," not just "is the process running."
- Memory usage crosses `TELEGRAM_MEMORY_ALERT_PERCENT` (default 90%) — the
  single most useful signal for a "goes unreachable for a few minutes,
  then recovers on its own" pattern, since that usually means memory
  pressure (swap thrashing, or the kernel briefly starving the process)
  rather than a clean crash.
- `edusolution-backend` restarts when the bot didn't ask it to (i.e. not
  via `/restart`/`/deploy`) — systemd's own restart counter ticking up on
  its own means the process crashed and `Restart=on-failure` silently
  brought it back before any poll ever caught it "down." Flagged as a
  possible crash loop, with a pointer to `/logs`.
- Disk usage on `/` crosses `TELEGRAM_DISK_ALERT_PERCENT` (default 85%).
- The TLS cert has fewer than `TELEGRAM_CERT_ALERT_DAYS` (default 14) days
  left.
- No daily backup has landed in `TELEGRAM_BACKUP_STALE_HOURS` (default 26)
  hours — only checked at all when `BACKUP_S3_BUCKET` is actually
  configured; silently skipped otherwise, same as `/backup` itself.

## Updating the bot itself

`/deploy` pulls and restarts the **main API** (`edusolution-backend`). If a
change also touches `backend/telegram-bot/bot.js` itself, restart this
service too once the deploy's done:

```bash
systemctl restart telegram-bot
```
