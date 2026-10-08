#!/bin/bash
# macOS: double-click to start the calculation engine and the website.
# The first run installs everything it needs (a few minutes).
# Close this window (or press Ctrl+C) to stop the app.

cd "$(dirname "$0")" || exit 1

pause_exit() {
  echo
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
}

# Python 3.10 or newer
PY=""
for c in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
    PY="$c"
    break
  fi
done
if [ -z "$PY" ]; then
  echo "Python 3.10 or newer was not found. Install it with:  brew install python"
  pause_exit
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js was not found. Install it with:  brew install node"
  pause_exit
fi

# First run: install dependencies
if [ ! -x backend/.venv/bin/python ]; then
  echo "Setting up Python environment..."
  "$PY" -m venv backend/.venv || pause_exit
fi
if ! backend/.venv/bin/python -c "import fastapi, uvicorn, scipy" >/dev/null 2>&1; then
  echo "Installing Python packages..."
  backend/.venv/bin/python -m pip install -r backend/requirements.txt || pause_exit
fi
if [ ! -d frontend/node_modules ]; then
  echo "Installing website packages..."
  (cd frontend && npm install) || pause_exit
fi

# Stop both servers when this window is closed or Ctrl+C is pressed
trap 'trap - EXIT INT TERM; kill 0' EXIT INT TERM

(cd backend && .venv/bin/python -m uvicorn api.main:app --port 8000) &
(cd frontend && npm run dev) &

echo
echo "Starting... the browser will open in a few seconds."
sleep 8
open http://localhost:3000
echo "The app is running at http://localhost:3000"
echo "Close this window or press Ctrl+C to stop it."
wait
