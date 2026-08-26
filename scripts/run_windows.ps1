# LastMile Guard PowerShell Launcher
Set-Location -Path (Split-Path -Parent $PSScriptRoot)

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "   Starting LastMile Guard (Windows Simulation Mode) " -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

Start-Job -ScriptBlock {
    Start-Sleep -Seconds 2
    Start-Process "http://localhost:8000"
} | Out-Null

python main.py
