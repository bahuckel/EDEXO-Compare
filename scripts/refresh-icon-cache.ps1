<#
.SYNOPSIS
  Make Windows redraw the app's icon in the Start menu, search results and the taskbar.

.DESCRIPTION
  The packaged exe carries the right icon -- `build/icon.ico` is rebuilt on every `npm run dist:win`
  and holds all four sizes (16, 32, 48, 256). Explorer does not read it again. It keeps a per-size
  cache in %LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache_*.db, keyed by path, and because every
  build writes the exe back to the *same* path a stale entry can outlive any number of rebuilds. On
  this machine those caches were weeks older than the exe, which is exactly the symptom: the folder
  shows the new icon and the Start menu shows the old one.

  Two levels, because the cheap one usually works and the thorough one costs you your open Explorer
  windows:

    - default -- `ie4uinit.exe -show`, the documented way to ask Windows to rebuild its icon cache.
      Nothing is deleted and nothing is restarted.
    - -Force -- stop Explorer, delete the icon and thumbnail caches, start Explorer again. Your open
      File Explorer windows close. Nothing else is touched, and Windows rebuilds the caches on demand.

  Neither one touches the app, its data, or the packaged exe.

.PARAMETER Force
  Delete the cache databases and restart Explorer instead of asking Windows nicely.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\refresh-icon-cache.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\refresh-icon-cache.ps1 -Force

.NOTES
  If a pinned Start menu tile still shows the old icon after -Force, unpin it and pin it again: the
  pin stores its own copy of the icon at the moment it was created, which no cache flush can reach.
#>
[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$explorerCache = Join-Path $env:LOCALAPPDATA "Microsoft\Windows\Explorer"

function Show-CacheAge {
  param([string]$When)
  $files = Get-ChildItem -Path $explorerCache -Filter "iconcache*.db" -ErrorAction SilentlyContinue
  if (-not $files) { Write-Host "$When : no icon cache files present"; return }
  Write-Host "$When :"
  foreach ($f in $files | Sort-Object Name) {
    "    {0,-20} {1,10:N0} bytes   {2}" -f $f.Name, $f.Length, $f.LastWriteTime | Write-Host
  }
}

Show-CacheAge -When "before"

if (-not $Force) {
  Write-Host ""
  Write-Host "Asking Windows to rebuild its icon cache (ie4uinit -show)..."
  & "$env:SystemRoot\System32\ie4uinit.exe" -show
  Write-Host "Done. Check the Start menu; if it is unchanged, run this again with -Force."
  return
}

Write-Host ""
Write-Host "Stopping Explorer. Your open File Explorer windows will close." -ForegroundColor Yellow
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800

$removed = 0
foreach ($pattern in @("iconcache*.db", "thumbcache*.db")) {
  Get-ChildItem -Path $explorerCache -Filter $pattern -Force -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      Remove-Item -Path $_.FullName -Force -ErrorAction Stop
      $removed++
    } catch {
      # A file Explorer still holds open is not worth failing over; the rest still clear.
      Write-Host ("    could not delete {0}: {1}" -f $_.Name, $_.Exception.Message)
    }
  }
}

# The legacy per-user cache, which some Windows builds still consult.
$legacy = Join-Path $env:LOCALAPPDATA "IconCache.db"
if (Test-Path $legacy) {
  try {
    Remove-Item -Path $legacy -Force -ErrorAction Stop
    $removed++
  } catch {
    Write-Host "    could not delete IconCache.db: $($_.Exception.Message)"
  }
}

Write-Host "Deleted $removed cache file(s). Starting Explorer again..."
Start-Process explorer.exe
Start-Sleep -Milliseconds 1500

Show-CacheAge -When "after"
Write-Host ""
Write-Host "If a pinned tile is still wrong, unpin it and pin it again -- a pin keeps its own icon copy."
