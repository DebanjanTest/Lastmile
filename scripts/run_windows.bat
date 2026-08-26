@echo off
title LastMile Guard - Windows Simulation Launcher
cd /d "%~dp0\.."

echo =====================================================
echo    Starting LastMile Guard (Windows Simulation Mode)
echo =====================================================

REM Start browser simulator in 2 seconds
start "" timeout /t 2 /nobreak >nul & start http://localhost:8000

REM Run Python main entrypoint
python main.py
pause
