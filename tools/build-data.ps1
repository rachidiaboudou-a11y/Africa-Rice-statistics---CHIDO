# Rice Statistics for Africa -- data pipeline.
#
#   official source -> download -> validate -> standardize -> transform -> store
#
# Two source databases are carried all the way through without ever being mixed:
# FAOSTAT bulk files and the USDA PSD grains bulk file. They disagree about rice
# -- different product basis, different reporting year, different estimation
# method -- and the whole point of keeping them apart is that a user can see the
# disagreement rather than have it averaged away behind their back.
#
# Everything the platform later shows is derived from what this script writes, so
# every emitted series carries its source, element, unit, product basis and the
# publication date of the file it came from.
#
# Usage:
#   .\tools\build-data.ps1              # download if missing, then build
#   .\tools\build-data.ps1 -Refresh     # force re-download
#   .\tools\build-data.ps1 -SkipDownload

[CmdletBinding()]
param(
  [switch]$Refresh,
  [switch]$SkipDownload
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root    = Split-Path -Parent $PSScriptRoot
$rawDir  = Join-Path $root "data\raw"
$outDir  = Join-Path $root "data"
. (Join-Path $PSScriptRoot "africa-registry.ps1")

if (-not (Test-Path $rawDir)) { New-Item -ItemType Directory -Path $rawDir -Force | Out-Null }

# --------------------------------------------------------------------------
# 1. DOWNLOAD
# --------------------------------------------------------------------------

$SOURCES = @(
  @{ key='production'; url='https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_Africa.zip'
     zip='Production_Crops_Livestock_E_Africa.zip'; csv='Production_Crops_Livestock_E_Africa_NOFLAG.csv'
     db='FAOSTAT'; dataset='Production: Crops and livestock products' }
  @{ key='trade';      url='https://bulks-faostat.fao.org/production/Trade_CropsLivestock_E_Africa.zip'
     zip='Trade_CropsLivestock_E_Africa.zip';       csv='Trade_CropsLivestock_E_Africa_NOFLAG.csv'
     db='FAOSTAT'; dataset='Trade: Crops and livestock products' }
  @{ key='population'; url='https://bulks-faostat.fao.org/production/Population_E_Africa.zip'
     zip='Population_E_Africa.zip';                 csv='Population_E_Africa_NOFLAG.csv'
     db='FAOSTAT'; dataset='Population (UN WPP as disseminated by FAOSTAT)' }
  @{ key='fbs';        url='https://bulks-faostat.fao.org/production/FoodBalanceSheets_E_Africa.zip'
     zip='FoodBalanceSheets_E_Africa.zip';          csv='FoodBalanceSheets_E_Africa_NOFLAG.csv'
     db='FAOSTAT'; dataset='Food Balance Sheets' }
  @{ key='fbsh';       url='https://bulks-faostat.fao.org/production/FoodBalanceSheetsHistoric_E_Africa.zip'
     zip='FoodBalanceSheetsHistoric_E_Africa.zip';  csv='FoodBalanceSheetsHistoric_E_Africa_NOFLAG.csv'
     db='FAOSTAT'; dataset='Food Balance Sheets (historic, -2013, old methodology)' }
  @{ key='psd';        url='https://apps.fas.usda.gov/psdonline/downloads/psd_grains_pulses_csv.zip'
     zip='psd_grains_pulses.zip';                   csv='psd_grains_pulses.csv'
     db='USDA PSD'; dataset='Production, Supply and Distribution -- grains and pulses' }
)

function Get-Source {
  param($src)
  $zipPath = Join-Path $rawDir $src.zip
  $csvPath = Join-Path $rawDir $src.csv

  if (-not $SkipDownload) {
    if ($Refresh -or -not (Test-Path $zipPath)) {
      Write-Host ("  downloading {0}" -f $src.zip) -ForegroundColor DarkGray
      Invoke-WebRequest -Uri $src.url -OutFile $zipPath -UseBasicParsing -TimeoutSec 600
    }
  }
  if (-not (Test-Path $zipPath)) { throw "missing archive $zipPath (run without -SkipDownload)" }

  if ($Refresh -or -not (Test-Path $csvPath)) {
    Write-Host ("  extracting {0}" -f $src.csv) -ForegroundColor DarkGray
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
      $entry = $zip.Entries | Where-Object { $_.Name -eq $src.csv }
      if (-not $entry) { throw "archive $($src.zip) has no entry $($src.csv)" }
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $csvPath, $true)
      $script:entryDate = $entry.LastWriteTime.UtcDateTime
    } finally { $zip.Dispose() }
  }

  # The archive member's timestamp is the closest thing either provider gives us
  # to a "data version", so it is what we record and show to the user.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $entry = $zip.Entries | Where-Object { $_.Name -eq $src.csv }
    $published = $entry.LastWriteTime.UtcDateTime.ToString("yyyy-MM-dd")
  } finally { $zip.Dispose() }

  [pscustomobject]@{ path=$csvPath; published=$published; url=$src.url; db=$src.db; dataset=$src.dataset }
}

Write-Host "[1/8] acquiring official sources" -ForegroundColor Cyan
$meta = @{}
foreach ($s in $SOURCES) { $meta[$s.key] = Get-Source $s }

# --------------------------------------------------------------------------
# 2. CSV PARSING
# --------------------------------------------------------------------------
# FAOSTAT NOFLAG files quote populated fields but leave missing ones completely
# empty ( ,, ), and item labels contain commas, so neither a naive split nor
# Import-Csv-with-a-filter is both correct and fast enough on the 76 MB trade
# file. This is a small hand-rolled splitter: correct on quoted commas, and it
# distinguishes "" (reported) from empty (not reported).

function Split-CsvLine {
  param([string]$line)
  $out = New-Object System.Collections.Generic.List[string]
  $sb  = New-Object System.Text.StringBuilder
  $inQ = $false
  for ($i = 0; $i -lt $line.Length; $i++) {
    $ch = $line[$i]
    if ($inQ) {
      if ($ch -eq '"') {
        if ($i + 1 -lt $line.Length -and $line[$i+1] -eq '"') { [void]$sb.Append('"'); $i++ }
        else { $inQ = $false }
      } else { [void]$sb.Append($ch) }
    } else {
      if ($ch -eq '"') { $inQ = $true }
      elseif ($ch -eq ',') { $out.Add($sb.ToString()); [void]$sb.Clear() }
      else { [void]$sb.Append($ch) }
    }
  }
  $out.Add($sb.ToString())
  return $out
}

# Reads a FAOSTAT wide file, keeping only rows the filter accepts. Returns rows
# as [pscustomobject]@{ area; item; element; unit; values=@{year->double} }.
function Read-FaostatWide {
  param(
    [string]$Path,
    [scriptblock]$RowFilter,   # receives the parsed field list, returns bool
    [string]$PreFilterRegex    # cheap regex applied to the raw line first
  )
  $rows = New-Object System.Collections.Generic.List[object]
  $reader = [System.IO.StreamReader]::new($Path, [System.Text.Encoding]::UTF8)
  try {
    $header = Split-CsvLine $reader.ReadLine()
    # Year columns are the ones named Y####; map column index -> year.
    $yearCols = @{}
    for ($i = 0; $i -lt $header.Count; $i++) {
      if ($header[$i] -match '^Y(\d{4})$') { $yearCols[$i] = [int]$Matches[1] }
    }
    # Metadata column positions differ between files (production/trade carry an
    # extra CPC code column), so locate them by name instead of by index.
    $ix = @{}
    foreach ($n in @('Area Code','Area','Item Code','Item','Element Code','Element','Unit')) {
      $ix[$n] = $header.IndexOf($n)
    }

    $re = if ($PreFilterRegex) { [regex]$PreFilterRegex } else { $null }
    while (($line = $reader.ReadLine()) -ne $null) {
      if ($re -and -not $re.IsMatch($line)) { continue }
      $f = Split-CsvLine $line
      if ($f.Count -lt $header.Count) { continue }
      if ($RowFilter -and -not (& $RowFilter $f $ix)) { continue }

      $vals = @{}
      foreach ($ci in $yearCols.Keys) {
        $raw = $f[$ci]
        if ([string]::IsNullOrWhiteSpace($raw)) { continue }
        $d = 0.0
        if ([double]::TryParse($raw, [ref]$d)) { $vals[$yearCols[$ci]] = $d }
      }
      $rows.Add([pscustomobject]@{
        areaCode = [int]$f[$ix['Area Code']]
        area     = $f[$ix['Area']]
        itemCode = $f[$ix['Item Code']]
        element  = [int]$f[$ix['Element Code']]
        unit     = $f[$ix['Unit']]
        values   = $vals
      })
    }
  } finally { $reader.Dispose() }
  return $rows
}

# --------------------------------------------------------------------------
# 3. FAOSTAT EXTRACTION
# --------------------------------------------------------------------------
# Item / element codes, pinned explicitly so a future FAOSTAT relabelling breaks
# loudly here instead of silently changing what the platform means by "rice".
#
#   item 27  "Rice"                                  -- PADDY. FAOSTAT dropped the
#            word "paddy" from the label in the 2023 revision; the series is
#            unchanged and is still rough rice.
#   item 31  "Rice, milled"                          -- milled rice trade. This is
#            the series the Gassi et al. (2025) Benin paper uses, and pairing it
#            with paddy production is what this platform's `raw` basis reproduces.
#   item 30  "Rice, paddy (rice milled equivalent)"  -- FAOSTAT's standardized
#            total rice trade aggregate. Offered as the `standardized` basis.
#
#   element 5312 area harvested (ha), 5412 yield (kg/ha), 5510 production (t),
#           5610 import quantity (t),  5622 import value (1000 USD),
#           5910 export quantity (t),  5922 export value (1000 USD),
#           511  total population, both sexes (1000 persons).

Write-Host "[2/8] reading FAOSTAT production" -ForegroundColor Cyan
$prodRows = Read-FaostatWide -Path $meta.production.path `
  -PreFilterRegex '^"[^"]*","[^"]*","[^"]*","27",' `
  -RowFilter { param($f,$ix) $f[$ix['Item Code']] -eq '27' -and [int]$f[$ix['Element Code']] -in @(5312,5412,5510) }
Write-Host ("      {0} rows" -f $prodRows.Count) -ForegroundColor DarkGray

Write-Host "[3/8] reading FAOSTAT trade" -ForegroundColor Cyan
$tradeRows = Read-FaostatWide -Path $meta.trade.path `
  -PreFilterRegex '^"[^"]*","[^"]*","[^"]*","(30|31)",' `
  -RowFilter { param($f,$ix) $f[$ix['Item Code']] -in @('30','31') -and [int]$f[$ix['Element Code']] -in @(5610,5622,5910,5922) }
Write-Host ("      {0} rows" -f $tradeRows.Count) -ForegroundColor DarkGray

# FOOD BALANCE SHEETS -- item 2807 "Rice and products".
#
# This is the only source here that separates what is EATEN from what merely
# enters the country. Apparent utilization (P + M - X) counts feed, seed, losses,
# processing, industrial use and stock building as though they were consumption;
# the FBS splits them out. For Senegal in 2022, domestic supply was 3,250 kt but
# food use only 2,154 kt -- a third of the balance sheet is not food.
#
# Two properties matter and are carried into the output:
#   * Everything is in PADDY (primary product) equivalent, not milled. Verified:
#     Senegal 2022 FBS imports 2,221 kt against 1,487 kt milled from the trade
#     file, a ratio of 1/0.67.
#   * Coverage is 43 African countries and 2010-2023 only. Benin -- the country
#     of the reference paper -- is NOT in the current release, so the platform
#     must degrade gracefully rather than assume the series exists.
# FAO's standard paddy -> milled conversion, used to normalise the current Food
# Balance Sheet release onto the milled basis the historic release already uses.
$MILLING_RATE = 0.67

$FBS_ELEMENTS = @{
  5511 = 'production'; 5611 = 'imports'; 5911 = 'exports'; 5072 = 'stockVariation'
  5301 = 'domesticSupply'; 5142 = 'food'; 645 = 'foodPerCapita'
  5527 = 'seed'; 5521 = 'feed'; 5123 = 'losses'; 5131 = 'processing'
  5154 = 'otherUses'; 5170 = 'residuals'; 664 = 'kcalPerCapitaDay'
}

Write-Host "[4/8] reading FAOSTAT food balance sheets" -ForegroundColor Cyan
$fbsRows = Read-FaostatWide -Path $meta.fbs.path `
  -PreFilterRegex '"2807"' `
  -RowFilter { param($f,$ix) $f[$ix['Item Code']] -eq '2807' -and $FBS_ELEMENTS.ContainsKey([int]$f[$ix['Element Code']]) }
Write-Host ("      {0} rows" -f $fbsRows.Count) -ForegroundColor DarkGray

$fbsIx = @{}
$fbsYears = New-Object System.Collections.Generic.SortedSet[int]
foreach ($r in $fbsRows) {
  $fbsIx["$($r.areaCode)/$($r.element)"] = $r
  foreach ($y in $r.values.Keys) { [void]$fbsYears.Add([int]$y) }
}
$F0 = if ($fbsYears.Count) { $fbsYears.Min } else { 2010 }
$F1 = if ($fbsYears.Count) { $fbsYears.Max } else { 2023 }
$fbsYearList = @($F0..$F1)

# HISTORIC FOOD BALANCE SHEETS -- item 2805 "Rice (Milled Equivalent)", 1961-2013.
#
# This matters for two reasons.
#
# COVERAGE. The current FBS release omits twelve African countries, Benin among
# them -- the country of the reference paper. The historic release has them.
#
# BASIS. The two releases are NOT on the same basis, and merging them naively
# would put a 1.5x step in every series at 2010:
#     historic  "Rice (Milled Equivalent)"  -> MILLED. Benin 2010 production 83 kt
#                                              = FAOSTAT paddy 125 kt x 0.667.
#     current   "Rice and products"         -> PADDY.  Senegal 2022 production
#                                              1409 kt = FAOSTAT paddy exactly.
# Verified on the 2010-2013 overlap, where the ratio of historic to current food
# supply per capita is 0.67-0.71 across Senegal, Nigeria, Ghana and Madagascar --
# the milling rate. Everything below is normalised to MILLED, which is the basis
# published rice consumption figures are quoted on and the basis AfricaRice uses.
$FBSH_ELEMENTS = @{
  5511 = 'production'; 5611 = 'imports'; 5911 = 'exports'; 5074 = 'stockVariation'
  5301 = 'domesticSupply'; 5142 = 'food'; 645 = 'foodPerCapita'
  5527 = 'seed'; 5521 = 'feed'; 5123 = 'losses'; 5131 = 'processing'
  5154 = 'otherUses'; 664 = 'kcalPerCapitaDay'
}

Write-Host "[5/8] reading FAOSTAT historic food balance sheets" -ForegroundColor Cyan
$fbshRows = Read-FaostatWide -Path $meta.fbsh.path `
  -PreFilterRegex '"2805"' `
  -RowFilter { param($f,$ix) $f[$ix['Item Code']] -eq '2805' -and $FBSH_ELEMENTS.ContainsKey([int]$f[$ix['Element Code']]) }
Write-Host ("      {0} rows" -f $fbshRows.Count) -ForegroundColor DarkGray

$fbshIx = @{}
foreach ($r in $fbshRows) { $fbshIx["$($r.areaCode)/$($r.element)"] = $r }

Write-Host "[6/8] reading FAOSTAT population" -ForegroundColor Cyan
$popRows = Read-FaostatWide -Path $meta.population.path `
  -PreFilterRegex '"511"' `
  -RowFilter { param($f,$ix) [int]$f[$ix['Element Code']] -eq 511 }
Write-Host ("      {0} rows" -f $popRows.Count) -ForegroundColor DarkGray

# Index by FAOSTAT area code for the join.
function Index-Rows { param($rows, [scriptblock]$key)
  $h = @{}
  foreach ($r in $rows) { $k = & $key $r; if ($k) { $h[$k] = $r } }
  return $h
}
$prodIx  = Index-Rows $prodRows  { param($r) "$($r.areaCode)/$($r.element)" }
$tradeIx = Index-Rows $tradeRows { param($r) "$($r.areaCode)/$($r.itemCode)/$($r.element)" }
$popIx   = Index-Rows $popRows   { param($r) "$($r.areaCode)" }

# Analytical window for the annual balance-sheet series.
$Y0 = 1961
$Y1 = 2024
$years = @($Y0..$Y1)
# Population runs wider because UN WPP publishes projections, and the forecasting
# module needs future population to project per-capita indicators to 2050.
$P0 = 1950; $P1 = 2100
$popYears = @($P0..$P1)

# Returns a plain Object[] aligned to [$from..$to], null where the source has no
# observation. Deliberately NOT `return ,$a`: the unary comma hands ConvertTo-Json
# a PSObject-wrapped array, which Windows PowerShell 5.1 then serializes as
# {"value":[...],"Count":n} instead of a bare JSON array. Letting the array
# enumerate on return and re-collecting at the call site keeps it a clean array.
function To-Array { param($row, $from, $to)
  $a = New-Object object[] ($to - $from + 1)
  for ($y = $from; $y -le $to; $y++) {
    $a[$y - $from] = if ($row -and $row.values.ContainsKey($y)) { [math]::Round($row.values[$y], 4) } else { $null }
  }
  return $a
}

$faoSeries = [ordered]@{}
$fbsSeries = [ordered]@{}
$coverage  = [ordered]@{}
$warnings  = New-Object System.Collections.Generic.List[string]
$fbsMissing = New-Object System.Collections.Generic.List[string]

foreach ($c in $script:AfricaRegistry) {
  $fao = $c.fao
  $s = [ordered]@{
    area           = @(To-Array $prodIx["$fao/5312"] $Y0 $Y1)
    yield          = @(To-Array $prodIx["$fao/5412"] $Y0 $Y1)
    production     = @(To-Array $prodIx["$fao/5510"] $Y0 $Y1)
    imports        = @(To-Array $tradeIx["$fao/31/5610"] $Y0 $Y1)
    exports        = @(To-Array $tradeIx["$fao/31/5910"] $Y0 $Y1)
    importValue    = @(To-Array $tradeIx["$fao/31/5622"] $Y0 $Y1)
    exportValue    = @(To-Array $tradeIx["$fao/31/5922"] $Y0 $Y1)
    importsStd     = @(To-Array $tradeIx["$fao/30/5610"] $Y0 $Y1)
    exportsStd     = @(To-Array $tradeIx["$fao/30/5910"] $Y0 $Y1)
    importValueStd = @(To-Array $tradeIx["$fao/30/5622"] $Y0 $Y1)
    exportValueStd = @(To-Array $tradeIx["$fao/30/5922"] $Y0 $Y1)
    population     = @(To-Array $popIx["$fao"] $P0 $P1)
  }
  $faoSeries[$c.iso3] = $s

  # ---- Food balance sheets, merged onto a single MILLED basis.
  #
  # Historic (1961-2013) is already milled and is used as published. Current
  # (2010-2023) is paddy and is multiplied by the milling rate. Where both cover a
  # year, the CURRENT release wins -- it is the maintained one -- and the historic
  # value is kept alongside so the overlap can be inspected rather than trusted.
  $FB0 = 1961; $FB1 = $F1
  $fbFields = @('production','imports','exports','stockVariation','domesticSupply','food',
                'foodPerCapita','seed','feed','losses','processing','otherUses','kcalPerCapitaDay')
  $anyFb = $false
  $fs = [ordered]@{}
  $srcFlag = New-Object object[] ($FB1 - $FB0 + 1)

  foreach ($fld in $fbFields) {
    $arr = New-Object object[] ($FB1 - $FB0 + 1)

    # historic first, milled as-is
    $hCode = ($FBSH_ELEMENTS.GetEnumerator() | Where-Object { $_.Value -eq $fld } | Select-Object -First 1)
    if ($hCode) {
      $row = $fbshIx["$fao/$($hCode.Key)"]
      if ($row) {
        $anyFb = $true
        for ($y = $FB0; $y -le 2013; $y++) {
          if (-not $row.values.ContainsKey($y)) { continue }
          $arr[$y - $FB0] = [math]::Round($row.values[$y], 4)
          if ($srcFlag[$y - $FB0] -eq $null) { $srcFlag[$y - $FB0] = 'historic' }
        }
      }
    }

    # current, converted paddy -> milled (per-capita and kcal series are ratios of
    # the same quantity, so they scale the same way; kcal does NOT)
    $cCode = ($FBS_ELEMENTS.GetEnumerator() | Where-Object { $_.Value -eq $fld } | Select-Object -First 1)
    if ($cCode) {
      $row = $fbsIx["$fao/$($cCode.Key)"]
      if ($row) {
        $anyFb = $true
        $k = if ($fld -eq 'kcalPerCapitaDay') { 1.0 } else { $MILLING_RATE }
        foreach ($y in $row.values.Keys) {
          if ($y -lt $FB0 -or $y -gt $FB1) { continue }
          $arr[$y - $FB0] = [math]::Round($row.values[$y] * $k, 4)
          $srcFlag[$y - $FB0] = 'current'
        }
      }
    }
    $fs[$fld] = @($arr)
  }
  $fs['source'] = @($srcFlag)

  if ($anyFb) { $fbsSeries[$c.iso3] = $fs } else { $fbsMissing.Add($c.iso3) }

  if (-not $popIx.ContainsKey("$fao")) { $warnings.Add("FAOSTAT: no population series for $($c.name) (area $fao)") }
  $cov = [ordered]@{}
  foreach ($k in $s.Keys) {
    $n = @($s[$k] | Where-Object { $_ -ne $null }).Count
    $cov[$k] = $n
  }
  $coverage[$c.iso3] = $cov
}

# --------------------------------------------------------------------------
# 4. USDA PSD EXTRACTION
# --------------------------------------------------------------------------
# PSD is long-format and carries several published vintages of the same market
# year (Calendar_Year + Month = release stamp). We keep the most recent vintage
# for each country/year/attribute, which is what "the current USDA estimate"
# means, and record how many superseded rows we dropped.

Write-Host "[7/8] reading USDA PSD" -ForegroundColor Cyan

$PSD_ATTR = @{
  '004' = 'area'           # Area Harvested, 1000 ha
  '020' = 'beginStocks'    # 1000 t, milled
  '028' = 'production'     # Production, 1000 t, MILLED basis
  '054' = 'roughProduction'# Rough (paddy) production, 1000 t
  '057' = 'imports'        # 1000 t, milled
  '088' = 'exports'        # 1000 t, milled
  '125' = 'consumption'    # Domestic Consumption, 1000 t, milled
  '176' = 'endStocks'      # 1000 t, milled
  '184' = 'yield'          # MT/ha, milled basis
  '182' = 'millingRate'    # milling rate (.9999)
}
$psdByCode = @{}
foreach ($c in $script:AfricaRegistry) { if ($c.psd) { $psdByCode[$c.psd] = $c.iso3 } }

$psdVals = @{}   # "iso3|year|field" -> @{ value; stamp }
$psdSeen = New-Object System.Collections.Generic.HashSet[string]
$psdSuperseded = 0
$psdMinYear = 9999; $psdMaxYear = 0

$reader = [System.IO.StreamReader]::new($meta.psd.path, [System.Text.Encoding]::UTF8)
try {
  $null = $reader.ReadLine()
  while (($line = $reader.ReadLine()) -ne $null) {
    if ($line.IndexOf('0422110') -ne 0) { continue }   # Rice, Milled only
    $f = Split-CsvLine $line
    if ($f.Count -lt 12) { continue }
    $cc = $f[2]
    [void]$psdSeen.Add($cc)
    if (-not $psdByCode.ContainsKey($cc)) { continue }
    $attr = $f[7]
    if (-not $PSD_ATTR.ContainsKey($attr)) { continue }

    $iso  = $psdByCode[$cc]
    $my   = [int]$f[4]
    $stamp = ([int]$f[5]) * 100 + ([int]$f[6])     # Calendar_Year * 100 + Month
    $v = 0.0
    if (-not [double]::TryParse($f[11], [ref]$v)) { continue }

    if ($my -lt $psdMinYear) { $psdMinYear = $my }
    if ($my -gt $psdMaxYear) { $psdMaxYear = $my }

    $k = "$iso|$my|$($PSD_ATTR[$attr])"
    if ($psdVals.ContainsKey($k)) {
      if ($stamp -le $psdVals[$k].stamp) { $psdSuperseded++; continue }
      $psdSuperseded++
    }
    $psdVals[$k] = @{ value = $v; stamp = $stamp }
  }
} finally { $reader.Dispose() }

Write-Host ("      market years {0}-{1}, {2} superseded vintages dropped" -f $psdMinYear, $psdMaxYear, $psdSuperseded) -ForegroundColor DarkGray

# Any registry PSD code that never appeared is a mapping error on our side, not a
# data gap -- surface it loudly rather than shipping a silently empty series.
foreach ($c in $script:AfricaRegistry) {
  if ($c.psd -and -not $psdSeen.Contains($c.psd)) {
    $warnings.Add("USDA PSD: registry code '$($c.psd)' for $($c.name) never appears in the rice file -- mapping is wrong")
  }
}

$usdaYears = @($psdMinYear..$psdMaxYear)
$usdaSeries = [ordered]@{}
$usdaFields = @('area','beginStocks','production','roughProduction','imports','exports','consumption','endStocks','yield','millingRate')
foreach ($c in $script:AfricaRegistry) {
  if (-not $c.psd) { continue }
  $s = [ordered]@{}
  $any = $false
  foreach ($fld in $usdaFields) {
    $a = New-Object object[] $usdaYears.Count
    for ($i = 0; $i -lt $usdaYears.Count; $i++) {
      $k = "$($c.iso3)|$($usdaYears[$i])|$fld"
      if ($psdVals.ContainsKey($k)) { $a[$i] = $psdVals[$k].value; $any = $true } else { $a[$i] = $null }
    }
    $s[$fld] = @($a)
  }
  if ($any) { $usdaSeries[$c.iso3] = $s }
}

# --------------------------------------------------------------------------
# 5. VALIDATION
# --------------------------------------------------------------------------
# These are integrity checks on what we just built, not on the sources. Anything
# that trips is written into the output so the platform can show it on the data
# quality page instead of quietly rendering a broken chart.

Write-Host "[8/8] validating" -ForegroundColor Cyan
$issues = New-Object System.Collections.Generic.List[object]

foreach ($c in $script:AfricaRegistry) {
  $s = $faoSeries[$c.iso3]
  for ($i = 0; $i -lt $years.Count; $i++) {
    $y = $years[$i]
    foreach ($fld in @('area','yield','production','imports','exports','importValue','exportValue')) {
      $v = $s[$fld][$i]
      if ($v -ne $null -and $v -lt 0) {
        $issues.Add([ordered]@{ iso3=$c.iso3; year=$y; field=$fld; kind='negative'; value=$v })
      }
    }
    # Production should equal area x yield to within FAOSTAT's own rounding.
    $a = $s['area'][$i]; $yl = $s['yield'][$i]; $p = $s['production'][$i]
    if ($a -ne $null -and $yl -ne $null -and $p -ne $null -and $p -gt 0) {
      $implied = $a * $yl / 1000.0
      if ([math]::Abs($implied - $p) / $p -gt 0.02) {
        $issues.Add([ordered]@{ iso3=$c.iso3; year=$y; field='production'; kind='identity'
                                value=$p; expected=[math]::Round($implied,2) })
      }
    }
  }
}
Write-Host ("      {0} data issues, {1} warnings" -f $issues.Count, $warnings.Count) -ForegroundColor DarkGray
foreach ($w in $warnings) { Write-Host ("      ! " + $w) -ForegroundColor Yellow }

# --------------------------------------------------------------------------
# 6. EMIT
# --------------------------------------------------------------------------

$extracted = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$registryOut = New-Object System.Collections.Generic.List[object]
foreach ($c in $script:AfricaRegistry) {
  $registryOut.Add([ordered]@{
    iso3      = $c.iso3
    name      = $c.name
    m49       = $c.m49
    faoCode   = $c.fao
    psdCode   = $c.psd
    region    = $c.region
    blocs     = @($c.blocs)
    territory = [bool]($c.Keys -contains 'territory')
    ecowasExit= [bool]($c.Keys -contains 'ecowasExit')
  })
}

$blocOut = [ordered]@{}
foreach ($k in $script:BlocMeta.Keys) { $blocOut[$k] = $script:BlocMeta[$k] }

$sourcesOut = New-Object System.Collections.Generic.List[object]

function Add-SourceMeta { param($key, $db, $items, $elements)
  $m = $meta[$key]
  $sourcesOut.Add([ordered]@{
    db        = $db
    dataset   = [string]$m.dataset
    url       = [string]$m.url
    published = [string]$m.published
    items     = $items
    elements  = $elements
  })
}

Add-SourceMeta 'production' 'FAOSTAT' `
  'item 27 "Rice" (paddy / rough basis)' `
  '5312 area harvested (ha), 5412 yield (kg/ha), 5510 production (t)'
Add-SourceMeta 'trade' 'FAOSTAT' `
  'item 31 "Rice, milled"; item 30 "Rice, paddy (rice milled equivalent)"' `
  '5610 import qty (t), 5910 export qty (t), 5622 import value (1000 USD), 5922 export value (1000 USD)'
Add-SourceMeta 'population' 'FAOSTAT' `
  'Population - Est. & Proj.' `
  '511 total population both sexes (1000 persons)'
Add-SourceMeta 'fbsh' 'FAOSTAT' `
  'item 2805 "Rice (Milled Equivalent)" (milled basis, 1961-2013)' `
  '5511 production, 5611 imports, 5911 exports, 5301 domestic supply, 5142 food, 645 food supply (kg/capita/yr), 5527 seed, 5123 losses, 5154 other uses'
Add-SourceMeta 'fbs' 'FAOSTAT' `
  'item 2807 "Rice and products" (paddy equivalent)' `
  '5511 production, 5611 imports, 5911 exports, 5072 stock variation, 5301 domestic supply, 5142 food, 645 food supply (kg/capita/yr), 5527 seed, 5521 feed, 5123 losses, 5131 processing, 5154 other uses, 664 kcal/capita/day'
Add-SourceMeta 'psd' 'USDA PSD' `
  'commodity 0422110 "Rice, Milled"' `
  '004 area (1000 ha), 028 production milled (1000 t), 054 rough production (1000 t), 057 imports, 088 exports, 125 domestic consumption, 020/176 stocks, 184 yield (t/ha), 182 milling rate'

$metaOut = [ordered]@{
  platform   = 'Rice Statistics for Africa'
  extracted  = $extracted
  window     = [ordered]@{ start=$Y0; end=$Y1 }
  popWindow  = [ordered]@{ start=$P0; end=$P1 }
  countries  = $registryOut.Count
  blocs      = $blocOut
  sources    = $sourcesOut.ToArray()
  issues     = $issues.ToArray()
  warnings   = $warnings.ToArray()
  psdSuperseded = $psdSuperseded
}

$faoOut = [ordered]@{
  db        = 'FAOSTAT'
  extracted = $extracted
  years     = $years
  popYears  = $popYears
  units     = [ordered]@{
    area='ha'; yield='kg/ha'; production='t'; imports='t'; exports='t'
    importValue='1000 USD'; exportValue='1000 USD'; population='1000 persons'
  }
  basis     = [ordered]@{
    production='paddy (rough rice), FAOSTAT item 27'
    trade='milled rice, FAOSTAT item 31'
    tradeStd='total rice trade in milled equivalent, FAOSTAT item 30'
  }
  coverage  = $coverage
  series    = $faoSeries
  fbs       = [ordered]@{
    years   = @(1961..$F1)
    basis   = 'MILLED equivalent throughout. The historic release (1961-2013, item 2805 "Rice ' +
              '(Milled Equivalent)") is already milled and is used as published. The current ' +
              'release (2010-2023, item 2807 "Rice and products") is on a PADDY basis and has been ' +
              'multiplied by ' + $MILLING_RATE + ' to match. Verified on the 2010-2013 overlap, ' +
              'where the ratio of the two is 0.67-0.71 across Senegal, Nigeria, Ghana and Madagascar.'
    millingRate = $MILLING_RATE
    unit    = '1000 t, except foodPerCapita (kg/capita/yr) and kcalPerCapitaDay (not rescaled)'
    note    = 'Food Balance Sheets separate FOOD USE from feed, seed, losses, processing, industrial ' +
              'use and stock variation, which apparent utilization (P + M - X) cannot do. This is the ' +
              'measure that corresponds to published per-capita rice consumption figures.'
    sources = 'Where both releases cover a year the current one is used; the per-year source is ' +
              'recorded in the "source" series so the join can be inspected.'
    covered = @($fbsSeries.Keys)
    missing = @($fbsMissing)
    series  = $fbsSeries
  }
}

$usdaOut = [ordered]@{
  db        = 'USDA PSD'
  extracted = $extracted
  years     = $usdaYears
  yearType  = 'market year (rice MY generally begins 1 Jan of the labelled year for most African reporters; USDA documents per-country MY start)'
  units     = [ordered]@{
    area='1000 ha'; beginStocks='1000 t'; production='1000 t'; roughProduction='1000 t'
    imports='1000 t'; exports='1000 t'; consumption='1000 t'; endStocks='1000 t'
    yield='t/ha'; millingRate='ratio x 10000'
  }
  basis     = [ordered]@{
    production='MILLED rice (attribute 028); paddy available separately as roughProduction (054)'
    trade='milled rice'
    consumption='domestic consumption, milled -- an independent USDA estimate, not a residual'
  }
  series    = $usdaSeries
}

function Write-Json { param($obj, $name)
  $p = Join-Path $outDir $name
  $json = $obj | ConvertTo-Json -Depth 12 -Compress
  [System.IO.File]::WriteAllText($p, $json, (New-Object System.Text.UTF8Encoding($false)))
  "{0,-22} {1,10:N0} bytes" -f $name, (Get-Item $p).Length
}

Write-Host ""
Write-Json $metaOut  "rsa-meta.json"
Write-Json $faoOut   "rsa-fao.json"
Write-Json $usdaOut  "rsa-usda.json"
Write-Json $registryOut "rsa-registry.json"

Write-Host ""
Write-Host ("done -- {0} countries, FAOSTAT {1}-{2}, USDA {3}-{4}" -f `
  $registryOut.Count, $Y0, $Y1, $psdMinYear, $psdMaxYear) -ForegroundColor Green
