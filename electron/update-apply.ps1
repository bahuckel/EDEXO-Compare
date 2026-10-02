# Puts a downloaded, checked update in place once the app has exited, then starts it
# (electron/updater.cjs; owner 2026-10-02: "an updater, that requires an app restart to take effect").
#
# Started detached by the app as it quits. Waits for the app (and the portable launcher stub) to be
# gone, because Windows will not replace a running program. Then:
#   portable: Target is the user's EDExoCompare.exe. It becomes EDExoCompare.exe.old, the new exe takes
#             its place. The .old copy is removed by the next start.
#   zip:      Target is the program folder. The zip is unpacked beside it as <folder>.new, the folder
#             becomes <folder>.old, <folder>.new becomes the folder. Same parent, so both are renames.
#             A folder some other process works in (a terminal opened there, a scan) cannot be renamed;
#             then the files are replaced in place instead, after a backup copy to <folder>.old.
# Any failure puts the old copy back; the old or the new program is started either way, never none.
param(
  [string]$WaitPids = "",
  [ValidateSet("portable", "zip")][string]$Mode,
  [string]$Target,
  [string]$Staged,
  [string]$Exe = "EDExoCompare.exe",
  [int]$Start = 1,
  [string]$Log = ""
)
$ErrorActionPreference = "Stop"

function Say([string]$m) {
  if ($Log) { try { Add-Content -LiteralPath $Log -Value ("{0:u} {1}" -f (Get-Date).ToUniversalTime(), $m) } catch {} }
}

# Retried: an antivirus scan or a closing child process can hold a file for a moment after exit.
function Retry([scriptblock]$Do, [string]$What) {
  for ($i = 1; $i -le 40; $i++) {
    try { & $Do; return } catch {
      if ($i -eq 40) { throw "$What failed: $($_.Exception.Message)" }
      Start-Sleep -Milliseconds 500
    }
  }
}

# Not inside the program folder: a process working in a folder keeps Windows from renaming it, and
# this one would be that process (owner's .zip test, 2026-10-02: the swap blocked itself).
Set-Location -LiteralPath ([System.IO.Path]::GetTempPath())

# robocopy succeeds below 8. Files only, quiet, a few retries for a file still closing.
function Mirror([string]$From, [string]$To, [string]$What) {
  & robocopy.exe $From $To /E /R:5 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "$What failed (robocopy $LASTEXITCODE)" }
}

Say "update: mode $Mode, target $Target"
foreach ($p in ($WaitPids -split "," | Where-Object { $_ -match '^\d+$' })) {
  try { Wait-Process -Id ([int]$p) -Timeout 120 -ErrorAction SilentlyContinue } catch {}
}

$run = $null
try {
  if ($Mode -eq "portable") {
    $old = "$Target.old"
    if (Test-Path -LiteralPath $old) { Retry { Remove-Item -LiteralPath $old -Force } "removing the previous .old" }
    Retry { Move-Item -LiteralPath $Target -Destination $old -Force } "moving the running copy aside"
    try {
      Retry { Copy-Item -LiteralPath $Staged -Destination $Target -Force } "copying the new exe"
    } catch {
      if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Force -ErrorAction SilentlyContinue }
      Move-Item -LiteralPath $old -Destination $Target -Force
      throw
    }
    $run = $Target
  } else {
    $parent = [System.IO.Path]::GetDirectoryName($Target)
    $new = "$Target.new"
    $old = "$Target.old"
    foreach ($d in @($new, $old)) {
      if (Test-Path -LiteralPath $d) { Retry { Remove-Item -LiteralPath $d -Recurse -Force } "removing $d" }
    }
    $unz = Join-Path $parent ("edexo-update-" + [guid]::NewGuid().ToString("N"))
    # .NET's unzip: 5 s for the 404 MB release where Expand-Archive takes 14.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($Staged, $unz)
    # The zip holds one folder, "ED Exo Compare <version>"; its contents are the program.
    $inner = @(Get-ChildItem -LiteralPath $unz -Directory)
    $src = if ($inner.Count -eq 1 -and -not (Test-Path -LiteralPath (Join-Path $unz $Exe))) { $inner[0].FullName } else { $unz }
    if (-not (Test-Path -LiteralPath (Join-Path $src $Exe))) { throw "the zip has no $Exe" }
    Move-Item -LiteralPath $src -Destination $new
    if (Test-Path -LiteralPath $unz) { Remove-Item -LiteralPath $unz -Recurse -Force -ErrorAction SilentlyContinue }
    $renamed = $false
    for ($i = 1; $i -le 20 -and -not $renamed; $i++) {
      try { Move-Item -LiteralPath $Target -Destination $old -ErrorAction Stop; $renamed = $true } catch { Start-Sleep -Milliseconds 500 }
    }
    if ($renamed) {
      try {
        Retry { Move-Item -LiteralPath $new -Destination $Target } "moving the new folder in"
      } catch {
        Move-Item -LiteralPath $old -Destination $Target
        throw
      }
    } else {
      Say "update: the program folder is in use by another program; replacing its files instead"
      Mirror $Target $old "backing up the program folder"
      try {
        Mirror $new $Target "copying the new files"
      } catch {
        try { Mirror $old $Target "restoring the old files" } catch { Say ("update: " + $_.Exception.Message) }
        throw
      }
      Remove-Item -LiteralPath $new -Recurse -Force -ErrorAction SilentlyContinue
    }
    $run = Join-Path $Target $Exe
  }
  Say "update: installed"
} catch {
  Say ("update: FAILED, the old copy stays: " + $_.Exception.Message)
  # Nothing half-unpacked left beside the program folder.
  foreach ($d in @($unz, $new)) {
    if ($d -and (Test-Path -LiteralPath $d)) { Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue }
  }
  $run = if ($Mode -eq "portable") { $Target } else { Join-Path $Target $Exe }
}

if ($Start -eq 1 -and $run -and (Test-Path -LiteralPath $run)) {
  Say "update: starting $run"
  Start-Process -FilePath $run -WorkingDirectory ([System.IO.Path]::GetDirectoryName($run))
}
