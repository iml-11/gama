#!/bin/bash
# macOS: double-click to update gama to the newest version from GitHub.
# Your custom materials and the PubChem cache are kept (they are not part of
# the code). Local edits to the program files themselves are discarded.

cd "$(dirname "$0")" || exit 1
pause() { echo; read -n 1 -s -r -p "Press any key to close..."; echo; }

OLD="$(cat VERSION 2>/dev/null)"
echo "Current version: ${OLD:-unknown}"

echo "Stopping gama if it is running..."
descendants() { local c; for c in $(pgrep -P "$1"); do descendants "$c"; echo "$c"; done; }
PIDS=""
for pat in "next start -p 38170" "uvicorn api.main:app --port 38171"; do
  for pid in $(pgrep -f "$pat"); do PIDS="$PIDS $pid $(descendants "$pid")"; done
done
[ -n "${PIDS// /}" ] && kill $PIDS 2>/dev/null
for p in 38170 38171 3000 8000; do lsof -ti "tcp:$p" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null; done
sleep 2

echo "Downloading the newest version..."
if ! git fetch origin; then
  echo "Could not reach GitHub. Check the internet connection and try again."
  pause; exit 1
fi
git reset --hard origin/main || { echo "Update failed."; pause; exit 1; }

# Force the app to rebuild its website on the next start.
rm -rf frontend/.next-app

NEW="$(cat VERSION 2>/dev/null)"
echo
echo "Updated: ${OLD:-?} -> ${NEW:-?}"

# Re-create the Mac app so its launcher matches the new version.
if [ -d "/Applications/gama.app" ] || [ -d "$HOME/Applications/gama.app" ]; then
  echo "Updating the gama app..."
  GAMA_QUIET=1 bash "./Create Mac App.command" </dev/null >/dev/null 2>&1
fi

echo
echo "Done. Open gama as usual; the first start after an update takes a few minutes."
pause
