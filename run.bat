@echo off
setlocal enabledelayedexpansion
title LastMile Guard - 5.0" Navigation HUD Launcher

echo =====================================================================
echo  LastMile Guard - Zomato & Swiggy 5.0" Automotive HUD Simulator
echo =====================================================================
echo.

set "PY_EXE="

:: 1. Check direct Python 3.12 install path
if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
    set "PY_EXE=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
) else if exist "C:\Users\Debanjan Mondal\AppData\Local\Programs\Python\Python312\python.exe" (
    set "PY_EXE=C:\Users\Debanjan Mondal\AppData\Local\Programs\Python\Python312\python.exe"
) else (
    :: 2. Check Windows Python Launcher (py.exe)
    where py >nul 2>&1
    if !errorlevel! equ 0 (
        set "PY_EXE=py -3.12"
    ) else (
        :: 3. Check system PATH python
        where python >nul 2>&1
        if !errorlevel! equ 0 (
            set "PY_EXE=python"
        )
    )
)

if "%PY_EXE%"=="" (
    echo [ERROR] Python was not found on your system.
    echo Please ensure Python 3.12 is installed or run scripts\add_python_to_path.ps1.
    pause
    exit /b 1
)

echo [OK] Using Python: %PY_EXE%
echo [INFO] Starting LastMile Guard Server on http://localhost:8000 ...
echo [INFO] Press Ctrl+C in this terminal window to stop the server.
echo.

:: Automatically open browser after 2 seconds in background
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8000"

:: Start LastMile Guard application
%PY_EXE% main.py

pause
