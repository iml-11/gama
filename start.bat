@echo off
REM Starts the calculation engine and the website, then opens the browser.
REM Close the two black windows (or press Ctrl+C in them) to stop the app.

cd /d "%~dp0"

set PY=python
where py >nul 2>nul && set PY=py

REM First run: install dependencies if they are missing.
%PY% -c "import fastapi, uvicorn, scipy" >nul 2>nul
if errorlevel 1 (
    echo Installing Python packages...
    %PY% -m pip install -r backend\requirements.txt
)
if not exist frontend\node_modules (
    echo Installing website packages...
    pushd frontend
    call npm.cmd install
    popd
)

start "Gamma - engine" /D "%~dp0backend" cmd /k %PY% -m uvicorn api.main:app --port 8000
start "Gamma - website" /D "%~dp0frontend" cmd /k npm.cmd run dev

echo Starting... the browser will open in a few seconds.
timeout /t 10 /nobreak >nul
start "" http://localhost:3000
