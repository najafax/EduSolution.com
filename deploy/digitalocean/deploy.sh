#!/usr/bin/env bash
# Run this on the droplet (as the `deploy` user) for every future deploy,
# in place of Render's autoDeploy. Usage:
#   cd ~/edusolution-backend && ./deploy/digitalocean/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/../.."   # repo root
BRANCH="${1:-main}"

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
sudo systemctl restart edusolution-backend
sudo systemctl status edusolution-backend --no-pager -l | head -n 15

echo "==> Done."
