# Migrating the backend (and its SQLite database) to a DigitalOcean Droplet

The backend uses `better-sqlite3` — a synchronous, same-process, file-based
database (see `backend/src/db/index.js`). There is no network DB server to
point at a different host: the SQLite file has to live on the same machine
as the Node process. So "move the database" means moving the whole backend
service off Render and onto a Droplet; **the frontend stays on Render**
exactly as it is today (per `render.yaml`, it's a static site that calls
`https://api.edusolutionsmaldives.com` directly — it has no idea which
server answers that domain, so nothing on the frontend side needs to
change).

This directory has the files this runbook installs:
- `provision.sh` — one-time droplet bootstrap (Node, nginx, certbot, ufw, app user)
- `edusolution-backend.service` — the systemd unit that replaces Render's "web service"
- `nginx-api.conf.template` — reverse proxy + TLS termination for `api.edusolutionsmaldives.com`
- `deploy.sh` — what you run for every future deploy (replaces Render's autoDeploy)

## 0. Before you start

Gather these:
- A DigitalOcean account with billing set up.
- Admin access to the DNS for `edusolutionsmaldives.com` (wherever
  `api.edusolutionsmaldives.com`'s A record currently points — likely
  Render's DNS instructions, or your registrar/Cloudflare).
- Your production `JWT_SECRET`, SMTP credentials, and (if configured)
  `BACKUP_S3_*` values — from Render's dashboard → edusolution-backend →
  Environment tab. You'll copy these into the droplet's `.env`, you don't
  need to regenerate them (changing `JWT_SECRET` would invalidate every
  logged-in session and client-portal session on cutover).
- An SSH key pair on your own machine (`ssh-keygen -t ed25519` if you don't
  have one) — DigitalOcean droplets are created with key-based SSH access,
  no root password.

## 1. Create the Droplet

Via the DigitalOcean console (**Create → Droplets**):
- **Image**: Ubuntu 24.04 (LTS) x64
- **Size**: Basic, Regular SSD — **2 GB RAM / 1 vCPU** (the $12/mo tier) is
  a safe baseline; this app is a single-business, low-concurrency Node API
  with no background workers besides its own cron jobs, so 1 GB would
  likely work too, but 2 GB gives headroom for PDF/XLSX export bursts and
  the daily backup's `VACUUM INTO` pass. You can resize later with no data
  loss if it turns out to be too small.
- **Region**: pick one close to your users (Maldives/South Asia — e.g. the
  Bangalore region if offered) or close to wherever Render was running it,
  to keep latency comparable.
- **Authentication**: SSH key (paste your public key, or select one already
  added to your DO account). Don't use a root password.
- **Hostname**: something like `edusolution-api`.

Note the droplet's public IPv4 address once it's up — call it `<DROPLET_IP>`
below.

Or via `doctl` if you have it installed locally:
```bash
doctl compute droplet create edusolution-api \
  --image ubuntu-24-04-x64 \
  --size s-1vcpu-2gb \
  --region blr1 \
  --ssh-keys <your-ssh-key-fingerprint>
```

## 2. Bootstrap the droplet

```bash
scp deploy/digitalocean/provision.sh root@<DROPLET_IP>:/root/
ssh root@<DROPLET_IP> 'bash /root/provision.sh'
```

This installs Node 22, nginx, certbot, sqlite3, creates an unprivileged
`deploy` user, creates `/var/data` (mirroring Render's disk mount path, so
`DB_PATH` can stay the same value), and sets up `ufw` to allow only SSH/80/443.

Give the `deploy` user your SSH key too (so you don't have to keep using
root): `ssh-copy-id deploy@<DROPLET_IP>`, or add it via the DO console when
the droplet is created.

## 3. Deploy the code

As the `deploy` user:
```bash
ssh deploy@<DROPLET_IP>
git clone https://github.com/<your-org>/EduSolution.com.git edusolution-backend
cd edusolution-backend/backend
npm install
cp .env.example .env
nano .env   # or vim/vi
```

Fill in `.env` with your **real production values** (copied from Render's
dashboard, not regenerated):
```
PORT=4000
JWT_SECRET=<same value as on Render>
CLIENT_ORIGIN=https://www.edusolutionsmaldives.com
DB_PATH=/var/data/data.sqlite3
SMTP_HOST=...
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=...
BACKUP_S3_BUCKET=...        # if you already have R2/S3 backups configured
BACKUP_S3_ENDPOINT=...
BACKUP_S3_REGION=auto
BACKUP_S3_ACCESS_KEY_ID=...
BACKUP_S3_SECRET_ACCESS_KEY=...
BACKUP_RETENTION_DAILY=7
BACKUP_RETENTION_WEEKLY=4
```

## 4. Move the real data

Do this as close to cutover time as possible, so the copy is fresh. Pick
whichever of these you have available:

### Option A — you already have `BACKUP_S3_*` configured on Render

1. Trigger one last fresh backup from Render (via its Shell tab, under the
   `backend` directory): `npm run backup`
2. List backups to get the key: `npm run backup:list`
3. On the droplet, download it: `npm run backup:restore -- <key>
   /tmp/restored.sqlite3` (the script deliberately never writes directly
   over `DB_PATH` — see its own note in `backend/scripts/restore.js` — so
   you move it into place yourself):
   ```bash
   sudo systemctl stop edusolution-backend 2>/dev/null || true   # not started yet on first run, harmless if it errors
   mv /tmp/restored.sqlite3 /var/data/data.sqlite3
   sudo chown deploy:deploy /var/data/data.sqlite3
   ```

### Option B — no S3 backups configured yet (direct copy via Render Shell)

Render's Shell tab gives you a terminal on the live backend container. From
there, make a WAL-safe consistent snapshot (the same technique
`backend/src/lib/backup.js` already uses, so it's safe even if the live DB
is mid-write) and print it in a form you can capture:
```bash
# In Render's Shell, under backend/:
sqlite3 $DB_PATH ".backup /tmp/snapshot.sqlite3"
gzip -c /tmp/snapshot.sqlite3 | base64 > /tmp/snapshot.b64
```
Then `cat /tmp/snapshot.b64` and copy the output, or (simpler, if your
Render plan supports it) use `render ssh <service>` from your own machine,
which gives you a real SSH session you can `scp` *through* rather than
copy-pasting base64:
```bash
render ssh edusolution-backend -- sqlite3 $DB_PATH ".backup /tmp/snapshot.sqlite3"
# then, from your own machine:
render ssh edusolution-backend -- cat /tmp/snapshot.sqlite3 > ./snapshot.sqlite3
scp ./snapshot.sqlite3 deploy@<DROPLET_IP>:/tmp/
ssh deploy@<DROPLET_IP> 'mv /tmp/snapshot.sqlite3 /var/data/data.sqlite3'
```

Either way, end with the real production file sitting at
`/var/data/data.sqlite3` on the droplet, owned by `deploy`.

## 5. Install and start the systemd service

```bash
sudo cp ~/edusolution-backend/deploy/digitalocean/edusolution-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now edusolution-backend
sudo systemctl status edusolution-backend
curl -s http://127.0.0.1:4000/api/health || curl -sI http://127.0.0.1:4000/api/auth/me
```
(There's no dedicated `/api/health` route — any response other than a
connection error on port 4000 means the process is up; a 401 on
`/api/auth/me` with no token is the expected "it's alive" signal.)

Check the logs if something's wrong: `journalctl -u edusolution-backend -f`.

## 6. nginx + TLS

```bash
sudo cp ~/edusolution-backend/deploy/digitalocean/nginx-api.conf.template /etc/nginx/sites-available/edusolution-api
sudo ln -s /etc/nginx/sites-available/edusolution-api /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

You need the DNS record pointed at the droplet **before** requesting a
certificate (see step 7), then:
```bash
sudo certbot --nginx -d api.edusolutionsmaldives.com
```
Certbot rewrites the nginx config to add the 443/TLS block and HTTP→HTTPS
redirect, and installs its own renewal timer (`systemctl list-timers |
grep certbot`) — nothing further to do for renewals.

`backend/src/index.js` already sets `app.set('trust proxy', 1)` because it
expects exactly one reverse-proxy hop in front of it — true on Render
(Render's own TLS-terminating proxy) and equally true here (nginx), so
rate limiting and anything else that reads the client IP keeps working
correctly with no code change needed.

## 7. DNS cutover

In your DNS provider, change `api.edusolutionsmaldives.com`'s record to
point at `<DROPLET_IP>` (an A record, or update Render's DNS instructions'
equivalent). DNS propagation can take minutes to a couple of hours
depending on the record's TTL.

Because the frontend only ever calls its own configured API origin
(`VITE_API_URL=https://api.edusolutionsmaldives.com` in `render.yaml`) and
never hardcodes an IP or Render-specific hostname, **no frontend rebuild or
redeploy is needed** — the moment DNS resolves to the droplet, the existing
frontend starts talking to it.

### Minimizing downtime / data-loss window

Any writes that happen on the *old* (Render) backend after you took your
snapshot in step 4 will not exist on the droplet. For a clean cutover with
no lost data:
1. Put the Render service in a brief maintenance window (easiest: scale it
   to 0, or just tell staff not to use the app for a few minutes).
2. Take the final snapshot (step 4) right then.
3. Move it to the droplet and start the service (steps 4–6).
4. Flip DNS (step 7).
5. Confirm the droplet is answering correctly (step 8), then resume normal
   use — staff hitting the old Render URL during DNS propagation will
   briefly see stale-but-consistent data, not corruption, since Render's
   copy is simply frozen at the snapshot point.
6. Once you're confident, shut down (or delete) the Render backend service
   to stop paying for it. **Keep the frontend service on Render** — it's
   unaffected by any of this.

## 8. Verify

- `curl -sI https://api.edusolutionsmaldives.com/api/auth/me` → should
  return `401` (not a connection error, not a cert warning).
- Load `https://www.edusolutionsmaldives.com` (the real frontend) and log
  in — confirm existing accounts/data are all there (this is why step 4's
  snapshot matters: it's the same database, not a fresh one).
- Check that scheduled jobs are registered:
  `journalctl -u edusolution-backend | grep -i cron` or just wait for the
  next daily backup/reminder run and check `journalctl` around that time.
- If `BACKUP_S3_*` is configured, confirm `npm run backup:list` shows a
  fresh entry after the next 03:00 server-time run.

## Ongoing deploys

From now on, instead of Render's `autoDeploy: true` on git push, run:
```bash
ssh deploy@<DROPLET_IP> 'cd edusolution-backend && ./deploy/digitalocean/deploy.sh'
```
This fetches `main`, reinstalls dependencies, and restarts the systemd
service — schema changes apply themselves automatically on that restart
(see CLAUDE.md's note on `db/index.js`'s guarded `ALTER TABLE` migrations;
there's no separate migration step to run).

## Rollback

Since Render's service and disk are untouched until you explicitly shut
them down in step 7.6, rolling back is just flipping the DNS record for
`api.edusolutionsmaldives.com` back to Render's address — do this if
anything looks wrong on the droplet before you've decommissioned Render.
Any writes made on the droplet in the meantime would need to be manually
reconciled back into Render's copy (or just redone), so don't delay this
decision once the cutover looks good.
