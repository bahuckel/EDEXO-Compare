#Requires -Version 5.1
<#
  Lists processes holding handles to paths under the repo build folder (or a path you pass).

  Requires Sysinternals Handle (free): https://learn.microsoft.com/en-us/sysinternals/downloads/handle
  - Drop handle64.exe (or handle.exe) in the repo root, tools\handle\, PATH, or set HANDLE_EXE.

  Run elevated (Run as administrator) to see handles owned by other users / some system processes.

  Usage:
    npm run debug:handles
    npm run debug:handles:dist
    powershell -File scripts/list-handles-build.ps1 -Path "dist\electron-out"
    powershell -File scripts/list-handles-build.ps1 -IncludeElectronOut
#>
param(
  [string] $Path = "",
  [string] $HandleExe = "",
  [switch] $IncludeElectronOut
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Find-HandleExe {
  param([string] $Explicit)
  if ($Explicit -and (Test-Path -LiteralPath $Explicit)) {
    return (Get-Item -LiteralPath $Explicit).FullName
  }
  if ($env:HANDLE_EXE -and (Test-Path -LiteralPath $env:HANDLE_EXE)) {
    return (Get-Item -LiteralPath $env:HANDLE_EXE).FullName
  }
  $fromPath = Get-Command handle64.exe, handle.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($fromPath) {
    return $fromPath.Path
  }
  $candidates = @(
    Join-Path $repoRoot "handle64.exe"
    Join-Path $repoRoot "handle.exe"
    Join-Path $repoRoot "tools\handle\handle64.exe"
    Join-Path $repoRoot "tools\handle\handle.exe"
    "$env:USERPROFILE\Sysinternals\handle64.exe"
  )
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath $c) {
      return (Get-Item -LiteralPath $c).FullName
    }
  }
  return $null
}

$toScan = [System.Collections.Generic.List[string]]::new()
if ($Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    Write-Error "Path does not exist: $Path"
    exit 1
  }
  $toScan.Add((Get-Item -LiteralPath $Path).FullName) | Out-Null
} else {
  $buildDir = Join-Path $repoRoot "build"
  if (-not (Test-Path -LiteralPath $buildDir)) {
    Write-Host "No build\ folder yet. Pass -Path or create the folder first." -ForegroundColor Yellow
    exit 0
  }
  $toScan.Add((Get-Item -LiteralPath $buildDir).FullName) | Out-Null
}

if ($IncludeElectronOut) {
  $out = Join-Path $repoRoot "dist\electron-out"
  if (Test-Path -LiteralPath $out) {
    $toScan.Add((Get-Item -LiteralPath $out).FullName) | Out-Null
  } else {
    Write-Host "(dist\electron-out not present, skipped)" -ForegroundColor DarkGray
  }
}

$exe = Find-HandleExe -Explicit $HandleExe
if (-not $exe) {
  Write-Host ""
  Write-Host "Sysinternals Handle was not found." -ForegroundColor Yellow
  Write-Host "  1) Download: https://learn.microsoft.com/en-us/sysinternals/downloads/handle"
  Write-Host "  2) Put handle64.exe in the repo root, tools\handle\, or PATH; or set HANDLE_EXE"
  Write-Host ""
  exit 1
}

Write-Host ""
Write-Host "Using: $exe" -ForegroundColor Cyan
Write-Host "Scanning:" -ForegroundColor Cyan
foreach ($p in $toScan) {
  Write-Host "  $p"
}
Write-Host ""
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Tip: run PowerShell as Administrator to see more handles." -ForegroundColor DarkYellow
  Write-Host ""
}

foreach ($p in $toScan) {
  Write-Host "---- $p ----" -ForegroundColor Green
  $out = & $exe -accepteula -nobanner $p 2>&1
  $out | ForEach-Object { Write-Host $_ }
  $code = $LASTEXITCODE
  $text = $out | Out-String
  $noMatches = $text -match "(?im)No matching handles"
  if ($code -ne 0 -and -not $noMatches) {
    Write-Host "(handle exit code: $code)" -ForegroundColor DarkYellow
  }
  Write-Host ""
}
