#!/bin/sh
# Local preview server. Port comes from $PORT so two sessions can preview the
# same tree at once; :8811 is only the fallback.
#
# The project lives in iCloud Drive, where python3 -m http.server dies with
# "PermissionError: [Errno 1] Operation not permitted" because os.getcwd()
# is blocked for the server process. So we mirror the tree to /private/tmp
# and serve from there. The mirror is per-port for the same reason: two
# servers sharing one mirror would rsync over each other's tree.
set -e
PORT="${PORT:-8811}"
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
DST="/private/tmp/rapidkert-serve-$PORT"
mkdir -p "$DST"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude '.git' --exclude '.claude' "$SRC/" "$DST/"
else
  rm -rf "$DST" && mkdir -p "$DST" && cp -RL "$SRC/." "$DST/"
fi
cd "$DST"
exec python3 -m http.server "$PORT"
