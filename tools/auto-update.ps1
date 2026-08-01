# Rice Statistics for Africa -- automatic data update.
#
# Checks whether FAOSTAT or USDA have published newer files than the ones the
# platform is currently built on, and if so re-downloads, validates, rebuilds and
# archives the previous version.
#
# Detection is by HTTP HEAD: both providers serve Last-Modified and Content-Length
# on their bulk endpoints, so a change in either means a new release. That is
# cheaper and more reliable than downloading 20 MB to find out nothing moved, and
# it means the check can run daily at negligible cost.
#
# NOTHING IS OVERWRITTEN IN PLACE. The previous data/*.json set is copied into
# data/versions/<extraction-timestamp>/ before the rebuild, so any analysis can be
# reproduced against the exact data it was run on. That is a requirement, not a
# nicety: a report that cannot be re-run against its own inputs is not reproducible.
#
# Usage:
#   .\tools\auto-update.ps1              # check, and update if anything changed
#   .\tools\auto-update.ps1 -CheckOnly   # report status, change nothing
#   .\tools\auto-update.ps1 -Force       # rebuild regardless
#   .\tools\auto-update.ps1 -Install     # register a daily Windows scheduled task
#   .\tools\auto-update.ps1 -Uninstall   # remove that task

[CmdletBinding()]
param(
  [switch]$CheckOnly,
  [switch]$Force,
  [switch]$Install,
  [switch]$Uninstall,
  [string]$AtTime = "06:30"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root    = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $root "data"
$stateFile = Join-Path $dataDir "rsa-update-state.json"
$logFile = Join-Path $dataDir "update.log"

function Log {
  param([string]$msg, [string]$colour = "Gray")
  $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Write-Host $line -ForegroundColor $colour
  try { Add-Content -Path $logFile -Value $line -Encoding utf8 } catch {}
}

# --------------------------------------------------------------- scheduling

$TASK_NAME = "RiceStatisticsForAfrica-DataUpdate"

if ($Install) {
  $action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $PSCommandPath)
  $trigger = New-ScheduledTaskTrigger -Daily -At $AtTime
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  Register-ScheduledTask -TaskName $TASK_NAME -Action $action -Trigger $trigger `
    -Settings $settings -Description "Checks FAOSTAT and USDA for new rice data and rebuilds the platform dataset." -Force | Out-Null
  Log "scheduled task '$TASK_NAME' registered, daily at $AtTime" "Green"
  Log "the check is cheap (HTTP HEAD); a full rebuild only runs when a source actually changes"
  exit 0
}

if ($Uninstall) {
  try {
    Unregister-ScheduledTask -TaskName $TASK_NAME -Confirm:$false
    Log "scheduled task '$TASK_NAME' removed" "Green"
  } catch { Log "no scheduled task to remove" "Yellow" }
  exit 0
}

# ------------------------------------------------------------ change check

$SOURCES = @(
  @{ key='production'; url='https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_Africa.zip'; db='FAOSTAT' }
  @{ key='trade';      url='https://bulks-faostat.fao.org/production/Trade_CropsLivestock_E_Africa.zip';       db='FAOSTAT' }
  @{ key='population'; url='https://bulks-faostat.fao.org/production/Population_E_Africa.zip';                 db='FAOSTAT' }
  @{ key='fbs';        url='https://bulks-faostat.fao.org/production/FoodBalanceSheets_E_Africa.zip';          db='FAOSTAT' }
  @{ key='psd';        url='https://apps.fas.usda.gov/psdonline/downloads/psd_grains_pulses_csv.zip';          db='USDA PSD' }
  @{ key='geo';        url='https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson'; db='Natural Earth' }
)

function Probe-Source {
  param($src)
  try {
    $r = Invoke-WebRequest -Uri $src.url -Method Head -UseBasicParsing -TimeoutSec 90
    $lm = $null
    if ($r.Headers.ContainsKey('Last-Modified')) { $lm = [string]$r.Headers['Last-Modified'] }
    $len = $null
    if ($r.Headers.ContainsKey('Content-Length')) { $len = [string]$r.Headers['Content-Length'] }
    return [pscustomobject]@{ key=$src.key; db=$src.db; url=$src.url
                              lastModified=$lm; length=$len; ok=$true; error=$null }
  } catch {
    # A provider being briefly unreachable is not a reason to fail the run; it is
    # a reason to leave the existing data alone and say so.
    return [pscustomobject]@{ key=$src.key; db=$src.db; url=$src.url
                              lastModified=$null; length=$null; ok=$false; error=$_.Exception.Message }
  }
}

$previous = @{}
if (Test-Path $stateFile) {
  try {
    $j = Get-Content $stateFile -Raw | ConvertFrom-Json
    foreach ($p in $j.sources.PSObject.Properties) { $previous[$p.Name] = $p.Value }
  } catch { Log "could not read previous state; treating everything as new" "Yellow" }
}

Log "checking $($SOURCES.Count) sources for new releases" "Cyan"
$current = @{}
$changed = New-Object System.Collections.Generic.List[string]
$unreachable = New-Object System.Collections.Generic.List[string]

foreach ($s in $SOURCES) {
  $p = Probe-Source $s
  $current[$s.key] = $p
  if (-not $p.ok) {
    $unreachable.Add($s.key)
    Log ("  {0,-11} UNREACHABLE  {1}" -f $s.key, $p.error) "Yellow"
    continue
  }
  $prev = $previous[$s.key]
  $isNew = $true
  if ($prev) {
    $isNew = ($prev.lastModified -ne $p.lastModified) -or ($prev.length -ne $p.length)
  }
  if ($isNew) {
    $changed.Add($s.key)
    Log ("  {0,-11} CHANGED      {1}  {2} bytes" -f $s.key, $p.lastModified, $p.length) "Green"
  } else {
    Log ("  {0,-11} unchanged    {1}" -f $s.key, $p.lastModified)
  }
}

$needsRebuild = $Force -or ($changed.Count -gt 0)

if ($CheckOnly) {
  Log ("check only -- {0}" -f ($(if ($needsRebuild) { "$($changed.Count) source(s) changed: " + ($changed -join ', ') } else { "everything current" }))) "Cyan"
  exit 0
}

if (-not $needsRebuild) {
  Log "no source has changed; nothing to do" "Green"
  # Still record the probe so the next run compares against fresh headers.
  $state = [ordered]@{
    checked = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    lastRebuild = if ($previous.Count -and (Test-Path $stateFile)) {
      (Get-Content $stateFile -Raw | ConvertFrom-Json).lastRebuild } else { $null }
    sources = $current
  }
  [System.IO.File]::WriteAllText($stateFile, ($state | ConvertTo-Json -Depth 6),
    (New-Object System.Text.UTF8Encoding($false)))
  exit 0
}

# ----------------------------------------------------------- archive first

$existing = Get-ChildItem -Path $dataDir -Filter "rsa-*.json" -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -ne 'rsa-update-state.json' }
if ($existing) {
  $stamp = "unknown"
  $metaPath = Join-Path $dataDir "rsa-meta.json"
  if (Test-Path $metaPath) {
    try { $stamp = ((Get-Content $metaPath -Raw | ConvertFrom-Json).extracted -replace '[:]', '-') } catch {}
  }
  $archive = Join-Path $dataDir ("versions\" + $stamp)
  if (-not (Test-Path $archive)) { New-Item -ItemType Directory -Path $archive -Force | Out-Null }
  foreach ($f in $existing) { Copy-Item $f.FullName (Join-Path $archive $f.Name) -Force }
  Log "archived the previous dataset to data\versions\$stamp" "Cyan"
}

# ---------------------------------------------------------------- rebuild

Log ("rebuilding: " + ($changed -join ', ')) "Cyan"
$rebuiltOk = $true
$errorText = $null
try {
  # -Refresh forces re-download and re-extraction of every FAOSTAT/USDA archive.
  & (Join-Path $PSScriptRoot "build-data.ps1") -Refresh
  if ($changed -contains 'geo' -or $Force) {
    & (Join-Path $PSScriptRoot "build-geo.ps1") -Refresh
  }
  & (Join-Path $root "build.ps1")
} catch {
  $rebuiltOk = $false
  $errorText = $_.Exception.Message
  Log "REBUILD FAILED: $errorText" "Red"
}

if (-not $rebuiltOk) {
  # Put the archived copy back, so a failed update never leaves the platform
  # serving a half-written dataset.
  if ($existing -and (Test-Path $archive)) {
    Get-ChildItem $archive -Filter "rsa-*.json" | ForEach-Object {
      Copy-Item $_.FullName (Join-Path $dataDir $_.Name) -Force
    }
    Log "restored the previous dataset" "Yellow"
  }
  exit 1
}

$state = [ordered]@{
  checked     = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  lastRebuild = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  changed     = @($changed)
  unreachable = @($unreachable)
  sources     = $current
}
[System.IO.File]::WriteAllText($stateFile, ($state | ConvertTo-Json -Depth 6),
  (New-Object System.Text.UTF8Encoding($false)))

Log ("update complete -- {0} source(s) refreshed" -f $changed.Count) "Green"
if ($unreachable.Count) {
  Log ("note: {0} source(s) were unreachable and were left at their previous version: {1}" -f `
    $unreachable.Count, ($unreachable -join ', ')) "Yellow"
}
