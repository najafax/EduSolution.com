#!/usr/bin/env bash
# Adds the shop's own link-preview rewrite (title/description/share image) to the
# LIVE nginx file, which certbot has modified, so it can't be re-copied from the
# template. Safe to run more than once. Restores the old file if nginx rejects it.
set -euo pipefail
LIVE=/etc/nginx/sites-available/edusolution-shop
HERE="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="$HERE/nginx-shop.conf.template"
[ -f "$LIVE" ] || { echo "Live file not found: $LIVE"; exit 1; }
cp "$LIVE" "$LIVE.bak"
python3 - "$LIVE" "$TEMPLATE" <<'PY'
import sys, re
live_p, tpl_p = sys.argv[1], sys.argv[2]
tpl = open(tpl_p).read().split("\n")
start = next(i for i, l in enumerate(tpl) if "Link previews" in l)
end = next(i for i, l in enumerate(tpl) if l.strip().startswith("gzip on;"))
block = [l for l in tpl[start:end]]
while block and not block[-1].strip(): block.pop()
lines = open(live_p).read().split("\n")
# drop any earlier copy of the block (comment + sub_filter lines), wherever it sits
out, skip = [], False
for l in lines:
    s = l.strip()
    if s.startswith("# Link previews") or s.startswith("# they would show the main site") or s.startswith("sub_filter"):
        continue
    out.append(l)
# insert once, under the first 'index index.html;'
done = False
res = []
for l in out:
    res.append(l)
    if not done and l.strip() == "index index.html;":
        res.append("")
        res.extend(block)
        done = True
if not done:
    sys.exit("Could not find 'index index.html;' in the live file")
open(live_p, "w").write("\n".join(res))
PY
if nginx -t; then
  systemctl reload nginx
  echo "Done. Check: curl -s https://shop.edusolutionsmv.com/ | grep -o '<title>[^<]*'"
else
  cp "$LIVE.bak" "$LIVE"
  echo "nginx rejected the change; the old file was restored."
  exit 1
fi
