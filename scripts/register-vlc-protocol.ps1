# Registers the vlc:// URI scheme in Windows for the current user (no admin/UAC required)
$ErrorActionPreference = "Stop"

$localAppPath = "$env:LOCALAPPDATA\vlc-protocol.ps1"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Copy-Item "$scriptDir\vlc-protocol.ps1" -Destination $localAppPath -Force

$regPath = "HKCU:\Software\Classes\vlc"
if (-not (Test-Path $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
}
Set-ItemProperty -Path $regPath -Name "(Default)" -Value "URL:VLC Protocol"
Set-ItemProperty -Path $regPath -Name "URL Protocol" -Value ""

$cmdPath = "$regPath\shell\open\command"
if (-not (Test-Path $cmdPath)) {
    New-Item -Path $cmdPath -Force | Out-Null
}
$cmdVal = 'powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File "' + $localAppPath + '" "%1"'
Set-ItemProperty -Path $cmdPath -Name "(Default)" -Value $cmdVal

Write-Host "VLC Protocol registered successfully in HKCU:\Software\Classes\vlc"
Write-Host "Handler script: $localAppPath"
