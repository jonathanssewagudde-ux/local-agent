# Stops Mission Control: frees ports 4316 and 4317. Keep this file pure ASCII.
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $Root '.satoru\launcher-pids.json'

# 1. the windows the launcher opened (kills cmd -> npm -> node as a tree)
if (Test-Path $PidFile) {
  try {
    $old = Get-Content -Raw $PidFile | ConvertFrom-Json
    foreach ($p in $old.PSObject.Properties) { & taskkill.exe /PID $p.Value /T /F 2>$null | Out-Null }
  } catch { }
  Remove-Item -Force $PidFile -ErrorAction SilentlyContinue
}
# 2. anything still listening on the ports
foreach ($port in @(4316, 4317)) {
  $lines = @(& netstat.exe -ano -p TCP | Select-String -Pattern "LISTENING")
  $lines += @(& netstat.exe -ano -p TCPv6 | Select-String -Pattern "LISTENING")
  foreach ($l in $lines) {
    $parts = ($l.ToString().Trim() -split '\s+')
    if ($parts.Length -ge 5 -and $parts[1] -match "[:\]]$port$") {
      $procId = [int]$parts[-1]
      if ($procId -gt 0) { & taskkill.exe /PID $procId /T /F 2>$null | Out-Null }
    }
  }
}
Start-Sleep -Milliseconds 700
$busy = @()
foreach ($port in @(4316, 4317)) {
  if (& netstat.exe -ano | Select-String -Pattern "[:\]]$port\s+.*LISTENING") { $busy += $port }
}
if ($busy.Count -eq 0) { Write-Host 'Stopped. Ports 4316 and 4317 are free.' -ForegroundColor Green }
else { Write-Host "Still in use: $($busy -join ', ')" -ForegroundColor Red; exit 1 }
