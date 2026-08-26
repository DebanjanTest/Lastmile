@echo off
setlocal enabledelayedexpansion
title LastMile Guard - Windows Simulation Launcher

cd /d "%~dp0\.."

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
echo [INFO] Launching LastMile Guard on http://localhost:8000 ...

start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8000"

%PY_EXE% main.py
