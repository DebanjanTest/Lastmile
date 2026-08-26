$pyDir = "C:\Users\Debanjan Mondal\AppData\Local\Programs\Python\Python312"
$scriptsDir = "C:\Users\Debanjan Mondal\AppData\Local\Programs\Python\Python312\Scripts"

if (Test-Path "$pyDir\python.exe") {
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentPath -notlike "*Python312*") {
        $newPath = "$pyDir;$scriptsDir;$currentPath"
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Host "SUCCESS: Added Python 3.12 and Scripts to User PATH."
    } else {
        Write-Host "NOTICE: Python 3.12 is already configured in User PATH."
    }
} else {
    Write-Host "WARNING: Python 3.12 not found at expected location."
}
