#!/usr/bin/env bash
# One-time bootstrap for a fresh Ubuntu 24.04 DigitalOcean Droplet that will
# host the EduSolution.com backend (Node + SQLite) in place of Render.
#
# Run this ONCE, as root, right after creating the droplet:
#   scp deploy/digitalocean/provision.sh root@<droplet-ip>:/root/
#   ssh root@<droplet-ip> 'bash /root/provision.sh'
#
# It is safe to re-run (every step checks before acting), but it is meant
# as a one-shot setup, not a repeated deploy step — see deploy.sh for that.
set -euo pipefail

APP_USER="deploy"
NODE_MAJOR="22"
DATA_DIR="/var/data"
APP_DIR="/home/${APP_USER}/edusolution-backend"

echo "==> Updating base system"
apt-get update -y
apt-get upgrade -y

echo "==> Installing base packages (nginx, certbot, sqlite3 CLI, build tools for better-sqlite3)"
apt-get install -y \
  curl git ufw nginx sqlite3 \
  build-essential python3 \
  certbot python3-certbot-nginx

echo "==> Installing Node ${NODE_MAJOR}.x (NodeSource)"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v${NODE_MAJOR}.* ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

echo "==> Creating unprivileged app user '${APP_USER}' (no login shell changes needed if it already exists)"
if ! id "${APP_USER}" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "${APP_USER}"
  usermod -aG sudo "${APP_USER}"
fi

echo "==> Creating persistent data directory (${DATA_DIR}) — mirrors Render's disk mount path"
mkdir -p "${DATA_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${DATA_DIR}"
chmod 750 "${DATA_DIR}"

echo "==> Firewall: allow SSH, HTTP, HTTPS only"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> Done. Next steps (as the ${APP_USER} user):"
echo "  1. git clone <your repo> ${APP_DIR}"
echo "  2. cd ${APP_DIR}/backend && npm install && cp .env.example .env && edit .env"
echo "     (set DB_PATH=${DATA_DIR}/data.sqlite3, a real JWT_SECRET, CLIENT_ORIGIN, SMTP_*, BACKUP_S3_*)"
echo "  3. Restore/copy your real data.sqlite3 into ${DATA_DIR}/data.sqlite3 (see ../README.md 'Moving the data' section)"
echo "  4. Install the systemd unit: see edusolution-backend.service"
echo "  5. Configure nginx + TLS: see nginx-api.conf.template"
