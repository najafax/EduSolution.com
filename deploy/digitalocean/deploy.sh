#!/usr/bin/env bash
# Run this on the droplet (as the `deploy` user) for every future deploy,
# in place of Render's autoDeploy. Usage:
#   cd ~/edusolution-backend && ./deploy/digitalocean/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/../.."   # repo root
BRANCH="${1:-main}"

# `sudo` as the documented `deploy` user is how this runbook (section 2-3
# above) was originally written, but some droplets never end up with `sudo`
# installed at all (confirmed on this project's own production droplet —
# plain `root@...# sudo ...` fails with "sudo: command not found", since
# root never needs it and provision.sh's own sudo install step can be
# skipped/fail silently on some base images) — in that case the "deploy"
# user's own sudo rights, even if provision.sh set them up, are moot, since
# sudo itself isn't there to grant them through. Running this whole script
# as root (as this project's own droplet actually operates) needs no sudo at
# all; running as the `deploy` user still works as long as sudo is present.
sudo_if_needed() {
  if [ "$(id -u)" = "0" ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "Need root to run: $*  (not root, and no sudo on this machine)" >&2
    exit 1
  fi
}

echo "==> Fetching latest ${BRANCH}"
git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git merge --ff-only "origin/${BRANCH}"

echo "==> Installing backend dependencies"
cd backend
npm install --omit=dev

# There is no migration tool (see CLAUDE.md on db/index.js) — schema changes
# ship as guarded ALTER TABLE/CREATE TABLE statements that run automatically
# the moment the backend process starts, so a plain restart is always enough.
echo "==> Restarting the backend service"
sudo_if_needed systemctl restart edusolution-backend
sudo_if_needed systemctl status edusolution-backend --no-pager -l | head -n 15

echo "==> Done."
