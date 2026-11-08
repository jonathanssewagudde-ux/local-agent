# Mission Control launcher (Windows). Double-click start.cmd.
# Keep this file pure ASCII: Windows PowerShell 5.1 misreads UTF-8 files without a BOM.
# - Checks BOTH ports (4316 web, 4317 daemon) and starts only the half that is down, so running it twice is harmless.
# - Installs node_modules if missing; runs each server in its own window; opens http://localhost:4316.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$StateDir = Join-Path $Root '.satoru'
$PidFile = Join-Path $StateDir 'launcher-pids.json'

function Test-Port([int]$Port) {
  foreach ($fam in @('InterNetwork', 'InterNetworkV6')) {
    $addr = if ($fam -eq 'InterNetwork') { '127.0.0.1' } else { '::1' }
    $c = New-Object System.Net.Sockets.TcpClient([System.Net.Sockets.AddressFamily]::$fam)
    try {
      $iar = $c.BeginConnect($addr, $Port, $null, $null)
      if ($iar.AsyncWaitHandle.WaitOne(400)) { $c.EndConnect($iar); return $true }
    } catch { } finally { $c.Close() }
  }
  return $false
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js was not found. Install the LTS version from https://nodejs.org and run this again.' -ForegroundColor Red
  exit 1
}

# card -> app name (single source of truth: mission.card.md)
& node scripts/card.mjs
if ($LASTEXITCODE -ne 0) { Write-Host 'mission.card.md has a problem (see above).' -ForegroundColor Red; exit 1 }
$card = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'web\src\card.generated.json') | ConvertFrom-Json
$App = ($card.appName -replace '[^\x20-\x7E]', '').Trim()
if (-not $App) { $App = 'Mission Control' }

foreach ($dir in @('.', 'server', 'web')) {
  if (-not (Test-Path (Join-Path $Root "$dir\node_modules"))) {
    Write-Host "Installing dependencies in $dir ..." -ForegroundColor Cyan
    Push-Location (Join-Path $Root $dir)
    & npm install --no-fund --no-audit
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { Write-Host "npm install failed in $dir (see the error above)." -ForegroundColor Red; exit 1 }
  }
}

$pids = @{}
if (Test-Path $PidFile) { try { $old = Get-Content -Raw $PidFile | ConvertFrom-Json; foreach ($p in $old.PSObject.Properties) { $pids[$p.Name] = $p.Value } } catch { } }

if (Test-Port 4317) { Write-Host "$App daemon is already running on 4317." -ForegroundColor DarkGray }
else {
  Write-Host "Starting the $App daemon (port 4317) ..." -ForegroundColor Cyan
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList "/k title $App - daemon (4317) && npm start" -WorkingDirectory (Join-Path $Root 'server') -PassThru
  $pids['daemon'] = $p.Id
}
if (Test-Port 4316) { Write-Host "$App web is already running on 4316." -ForegroundColor DarkGray }
else {
  Write-Host "Starting the $App web app (port 4316) ..." -ForegroundColor Cyan
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList "/k title $App - web (4316) && npm run dev" -WorkingDirectory (Join-Path $Root 'web') -PassThru
  $pids['web'] = $p.Id
}
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
($pids | ConvertTo-Json) | Set-Content -Encoding ASCII $PidFile

$deadline = (Get-Date).AddSeconds(90)
while (-not ((Test-Port 4316) -and (Test-Port 4317))) {
  if ((Get-Date) -gt $deadline) { Write-Host 'Timed out waiting for the servers. Check their windows for errors.' -ForegroundColor Red; exit 1 }
  Start-Sleep -Milliseconds 500
}

# desktop shortcut with the app icon (created once)
try {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $desktop "$App.lnk"
  if (-not (Test-Path $lnk)) {
    $sh = New-Object -ComObject WScript.Shell
    $s = $sh.CreateShortcut($lnk)
    $s.TargetPath = Join-Path $Root 'start.cmd'
    $s.WorkingDirectory = $Root
    $ico = Join-Path $Root 'web\public\assets\icon.ico'
    if (Test-Path $ico) { $s.IconLocation = "$ico,0" }
    $s.Description = "Open $App"
    $s.Save()
    Write-Host "Created a desktop shortcut: $App" -ForegroundColor Green
  }
} catch { Write-Host "(Could not create the desktop shortcut: $($_.Exception.Message))" -ForegroundColor DarkGray }

Write-Host "$App is up: http://localhost:4316" -ForegroundColor Green
Start-Process 'http://localhost:4316'
