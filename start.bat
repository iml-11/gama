@echo off
REM Starts the calculation engine and the website, then opens the browser.
REM Close the two black windows (or press Ctrl+C in them) to stop the app.

cd /d "%~dp0"

where py >nul 2>nul && (set PY=py) || (set PY=python)

REM First run: install dependencies if they are missing.
%PY% -c "import fastapi, uvicorn, scipy" >nul 2>nul || %PY% -m pip install -r backend\requirements.txt
if not exist frontend\node_modules (
    pushd frontend
    call npm.cmd install
    popd
)

start "Gamma - engine" cmd /k "cd /d "%~dp0backend" && %PY% -m uvicorn api.main:app --port 8000"
start "Gamma - website" cmd /k "cd /d "%~dp0frontend" && npm.cmd run dev"

echo Starting... the browser will open in a few seconds.
timeout /t 8 /nobreak >nul
start "" http://localhost:3000
