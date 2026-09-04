#Requires -Version 5.1
<#
  Creates a self-signed Authenticode certificate (Bahuckel dev) and exports it to build/self-signed-codesign.pfx.

  Not publicly trusted - Windows will still show "Unknown publisher" for most users until they trust your cert.
  Use only for internal testing or until you buy a real code signing certificate.

  The .pfx password is never stored in this repository. Supply it one of two ways:

    $env:EDEXO_SELFSIGN_PASSWORD = "your-secret"
    npm run codesign:self-signed

  or pass it explicitly:

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/create-self-signed-codesign-cert.ps1 -Password "your-secret"

  Keep the same value set in $env:EDEXO_SELFSIGN_PASSWORD before npm run dist:win, or signing is
  skipped.
#>
param(
  [string] $Password = "",
  [string] $OutputPath = ""
)

if (-not $Password) {
  $Password = $env:EDEXO_SELFSIGN_PASSWORD
}
if (-not $Password) {
  throw "No certificate password. Set `$env:EDEXO_SELFSIGN_PASSWORD or pass -Password. This script has no default on purpose - a password committed to a repository is a password to rotate."
}

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $OutputPath) {
  $OutputPath = Join-Path $repoRoot "build\self-signed-codesign.pfx"
}

$dir = Split-Path $OutputPath -Parent
if (-not (Test-Path $dir)) {
  New-Item -ItemType Directory -Path $dir | Out-Null
}

Write-Host ""
Write-Host "Self-signed code signing (development only - not a public CA)." -ForegroundColor Yellow
Write-Host "Subject: CN=Bahuckel Self-Signed Development, O=Bahuckel"
Write-Host ""

$cert = New-SelfSignedCertificate `
  -Subject "CN=Bahuckel Self-Signed Development, O=Bahuckel, OU=Development" `
  -Type CodeSigningCert `
  -KeySpec Signature `
  -KeyUsage DigitalSignature `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -HashAlgorithm SHA256 `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -NotAfter (Get-Date).AddYears(5)

try {
  $secure = ConvertTo-SecureString -String $Password -Force -AsPlainText
  Export-PfxCertificate -Cert $cert -FilePath $OutputPath -Password $secure | Out-Null
}
finally {
  Remove-Item -Path $cert.PSPath -DeleteKey -ErrorAction SilentlyContinue
}

Write-Host "Wrote: $OutputPath" -ForegroundColor Green
Write-Host ""
Write-Host "Before packaging, set the same password you just used:" -ForegroundColor Cyan
Write-Host "  `$env:EDEXO_SELFSIGN_PASSWORD = '<the password you passed>'"
Write-Host ""
Write-Host "If build/self-signed-codesign.pfx exists and that env var is set, dist:win will sign automatically."
Write-Host ""
