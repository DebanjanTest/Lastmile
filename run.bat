@echo off
setlocal enabledelayedexpansion
title LastMile Guard - 5.0" Navigation HUD Launcher

echo =====================================================================
echo  LastMile Guard - Multi-App 5.0" Delivery HUD Launcher
echo =====================================================================
echo.

:: 1. Clean up any stale background Python processes on port 8000
echo [CLEANUP] Ensuring port 8000 is clear...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING 2^>nul') do (
    echo [CLEANUP] Stopping old background server process (PID %%a)...
    taskkill /F /PID %%a >nul 2>&1
)

:: 2. Detect Python 3.12 executable
set "PY_EXE="

if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
    set "PY_EXE=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
) else if exist "C:\Users\Debanjan Mondal\AppData\Local\Programs\Python\Python312\python.exe" (
    set "PY_EXE=C:\Users\Debanjan Mondal\AppData\Local\Programs\Python\Python312\python.exe"
) else (
    where py >nul 2>&1
    if !errorlevel! equ 0 (
        set "PY_EXE=py -3.12"
    ) else (
        where python >nul 2>&1
        if !errorlevel! equ 0 (
            set "PY_EXE=python"
        )
    )
)

if "%PY_EXE%"=="" (
    echo [ERROR] Python 3.12 was not found.
    pause
    exit /b 1
)

echo [OK] Using Python: %PY_EXE%
echo [INFO] Starting fresh LastMile Guard Server on http://localhost:8000 ...
echo.

:: Launch browser in background after 1.5 seconds
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8000"

:: Start application
%PY_EXE% main.py

pause
