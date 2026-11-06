[CmdletBinding()]
param(
  [ValidateRange(1, 100)]
  [int]$Pages = 2
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "Node.js and npm are required. Install Node.js 20.9 or newer, then reopen PowerShell."
}

if (-not (Test-Path "node_modules")) {
  Write-Host "Dependencies are not installed. Run: npm ci"
  exit 1
}

# Keep the write-capable database URL in this PowerShell process only.
# It is not saved to .env.local, the project, or the browser.
if (-not $env:DATABASE_URL) {
  $secure = Read-Host "Paste the Supabase PostgreSQL SESSION-POOLER connection string" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

$databaseUrl = $env:DATABASE_URL
if (-not $databaseUrl.StartsWith("postgres", [StringComparison]::OrdinalIgnoreCase)) {
  throw "DATABASE_URL does not look like a PostgreSQL connection string."
}

if (-not $env:INGEST_CONTACT) {
  $env:INGEST_CONTACT = Read-Host "Contact email or website for the Jikan API user-agent (recommended; Enter to skip)"
}

Write-Host ""
Write-Host "Step 1/2: checking $Pages Jikan anime page(s). This dry run writes nothing."
npm run ingest -- jikan anime --pages $Pages --dry-run
if ($LASTEXITCODE -ne 0) {
  throw "Dry run failed (exit code $LASTEXITCODE). No database records were imported."
}

Write-Host ""
Write-Host "Step 2/2: this will write anime records into your Supabase database."
$confirm = Read-Host "Type IMPORT to continue"
if ($confirm -cne "IMPORT") {
  Write-Host "Cancelled. No records were written."
  exit 0
}

npm run ingest -- jikan anime --pages $Pages
if ($LASTEXITCODE -ne 0) {
  throw "Import ended with exit code $LASTEXITCODE. Check the ingestion_runs and ingestion_errors tables in Supabase."
}

Write-Host ""
Write-Host "Import finished. Refresh https://stellular-sunflower-e383b4.netlify.app/anime"
