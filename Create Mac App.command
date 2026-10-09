#!/bin/bash
# Double-click once to create "gama.app" in your Applications folder.
# The app starts the calculation engine and the website in the background (no
# Terminal window) and opens them in their own window. Closing the window stops
# everything. Run this again after moving this folder.

REPO="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="gama"
VERSION="$(cat "$REPO/VERSION" 2>/dev/null || echo 1.0.0)"

if [ -w /Applications ]; then DEST_DIR=/Applications; else DEST_DIR="$HOME/Applications"; mkdir -p "$DEST_DIR"; fi
APP="$DEST_DIR/$APP_NAME.app"

echo "Creating $APP (version $VERSION) ..."
rm -rf "$APP"
# Remove the app from before it was renamed to gama.
rm -rf "/Applications/Gamma Attenuation.app" "$HOME/Applications/Gamma Attenuation.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# --- Icon (icon.png -> AppIcon.icns) --------------------------------------
ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$REPO/macos/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$REPO/macos/icon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns" || echo "(icon could not be created; the app still works)"

# --- Info.plist ---------------------------------------------------------------
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>io.github.iml-11.gama</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

# --- Launcher -------------------------------------------------------------------
cat > "$APP/Contents/MacOS/launcher" <<LAUNCHER
#!/bin/bash
REPO="$REPO"
LAUNCHER
cat >> "$APP/Contents/MacOS/launcher" <<'LAUNCHER'
# Apps started from Finder do not get the Terminal PATH (Homebrew etc.).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

FRONT_PORT=38170
BACK_PORT=38171
URL="http://127.0.0.1:$FRONT_PORT"
SUPPORT="$HOME/Library/Application Support/gama"
LOG="$HOME/Library/Logs/gama.log"
mkdir -p "$SUPPORT"
exec >>"$LOG" 2>&1
echo "==== $(date) ===="

say_error() {
  osascript -e "display alert \"gama\" message \"$1\" as critical" >/dev/null 2>&1
  exit 1
}
notify() {
  osascript -e "display notification \"$1\" with title \"gama\"" >/dev/null 2>&1
}

[ -d "$REPO/backend" ] || say_error "The program folder was not found:\n$REPO\n\nIf you moved it, double-click 'Create Mac App.command' in the new location."

# Already running? Just show the window.
# (--noproxy: always talk to this Mac directly; -f: only real answers count)
lcurl() { curl -sf --noproxy '*' --max-time 3 "$@"; }
if lcurl -o /dev/null "$URL/api/health"; then RUNNING=1; fi

if [ -z "$RUNNING" ]; then
  PY=""
  for c in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then PY="$c"; break; fi
  done
  [ -n "$PY" ] || say_error "Python 3.10 or newer is required. In Terminal run: brew install python"
  command -v npm >/dev/null 2>&1 || say_error "Node.js is required. In Terminal run: brew install node"

  cd "$REPO" || exit 1
  # First run / after an update: install and build (takes a few minutes once).
  STAMP="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo nogit)"
  if [ ! -x backend/.venv/bin/python ] || [ ! -d frontend/node_modules ] || [ "$(cat frontend/.next-app/BUILD_STAMP 2>/dev/null)" != "$STAMP" ]; then
    notify "Preparing the app (first start or update). This can take a few minutes..."
    [ -x backend/.venv/bin/python ] || "$PY" -m venv backend/.venv || say_error "Could not create the Python environment. See the log: $LOG"
    backend/.venv/bin/python -m pip install -q -r backend/requirements.txt || say_error "Installing Python packages failed. See the log: $LOG"
    (cd frontend && npm install --no-audit --no-fund) || say_error "Installing website packages failed. See the log: $LOG"
    (cd frontend && NEXT_DIST_DIR=.next-app BACKEND_URL="http://127.0.0.1:$BACK_PORT" npx next build) || say_error "Building the app failed. See the log: $LOG"
    echo "$STAMP" > frontend/.next-app/BUILD_STAMP
  fi

  (cd backend && exec .venv/bin/python -m uvicorn api.main:app --port "$BACK_PORT") &
  BACK_PID=$!
  (cd frontend && NEXT_DIST_DIR=.next-app BACKEND_URL="http://127.0.0.1:$BACK_PORT" exec npx next start -p "$FRONT_PORT") &
  FRONT_PID=$!
  cleanup() {
    pkill -P "$FRONT_PID" 2>/dev/null; kill "$FRONT_PID" "$BACK_PID" 2>/dev/null
    # Anything still listening on the app's own ports belongs to this app.
    for p in "$FRONT_PORT" "$BACK_PORT"; do lsof -ti "tcp:$p" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null; done
  }
  trap cleanup EXIT INT TERM

  for i in $(seq 1 90); do
    lcurl -o /dev/null "$URL/api/health" && lcurl -o /dev/null "$URL" && break
    sleep 1
  done
fi

# Open in an app window (no tabs or address bar). A separate browser profile
# makes it its own process, so closing the window ends this launcher too.
for B in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
         "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
         "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"; do
  if [ -x "$B" ]; then
    "$B" --app="$URL" --user-data-dir="$SUPPORT/window" --no-first-run --no-default-browser-check --window-size=1440,920 &
    WIN_PID=$!
    [ -n "$RUNNING" ] && exit 0   # another launcher already owns the engine
    # On macOS closing the window does not quit the browser, so watch the
    # page's heartbeat: when no window has reported for a while, stop
    # everything. Cmd+Q on the window stops it immediately.
    grace_until=$(( $(date +%s) + 90 ))
    last=$(date +%s)
    while kill -0 "$WIN_PID" 2>/dev/null; do
      sleep 5
      now=$(date +%s)
      # After sleep/wake give the page time to report in again.
      [ $(( now - last )) -gt 30 ] && grace_until=$(( now + 90 ))
      last=$now
      age=$(lcurl "$URL/api/heartbeat/age" | sed -n 's/.*"age":\([0-9.]*\).*/\1/p' | cut -d. -f1)
      if [ "$now" -gt "$grace_until" ] && [ -n "$age" ] && [ "$age" -gt 150 ]; then
        kill "$WIN_PID" 2>/dev/null
        break
      fi
    done
    exit 0
  fi
done

# No Chrome/Edge/Brave: open the default browser and keep the engine running
# until the user clicks Quit in this small dialog.
open "$URL"
osascript -e 'display dialog "gama is running in your web browser.\n\nClick Quit when you are done." with title "gama" buttons {"Quit"} default button "Quit"' >/dev/null 2>&1
exit 0
LAUNCHER
chmod +x "$APP/Contents/MacOS/launcher"
touch "$APP"

echo
echo "Done: $APP"
echo "Open it from Launchpad / Applications, or drag it to the Dock."
open -R "$APP"
echo
read -n 1 -s -r -p "Press any key to close..."
