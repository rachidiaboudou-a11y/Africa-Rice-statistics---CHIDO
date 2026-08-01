# Builds data/rsa-geo.json -- real country boundaries for the Africa map.
#
# Source: Natural Earth 1:110m admin-0 countries, via the natural-earth-vector
# repository. Natural Earth is public domain ("no permission needed"), which is
# why it is used here rather than a provider whose tiles carry an API key, a
# billing account and terms that would follow this file wherever it is copied.
#
# Only African countries in the platform registry are kept, and coordinates are
# rounded to 2 decimal places (~1.1 km at the equator). At the zoom a national
# choropleth is read that is indistinguishable from full precision, and it takes
# the payload from megabytes to something that loads instantly.
#
# Disputed boundaries: Natural Earth's admin-0 rendering is used as published,
# without adjustment. The platform takes no position on any border; where a
# territory is contested the shape shown is Natural Earth's, not a claim.

[CmdletBinding()]
param([switch]$Refresh)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root   = Split-Path -Parent $PSScriptRoot
$rawDir = Join-Path $root "data\raw"
$outDir = Join-Path $root "data"
. (Join-Path $PSScriptRoot "africa-registry.ps1")

$URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson"
$src = Join-Path $rawDir "ne_110m_admin_0_countries.geojson"

if ($Refresh -or -not (Test-Path $src)) {
  Write-Host "  downloading Natural Earth 110m admin-0" -ForegroundColor DarkGray
  Invoke-WebRequest -Uri $URL -OutFile $src -UseBasicParsing -TimeoutSec 300
}

Write-Host "[geo] parsing" -ForegroundColor Cyan
$gj = Get-Content $src -Raw | ConvertFrom-Json

# Natural Earth marks a few countries -99 in ISO_A3; match on name as a fallback.
$byIso = @{}
foreach ($c in $script:AfricaRegistry) { $byIso[$c.iso3] = $c }
$nameFix = @{
  'Dem. Rep. Congo'          = 'COD'
  'Congo'                    = 'COG'
  'Central African Rep.'     = 'CAF'
  "Côte d'Ivoire"            = 'CIV'
  'Eq. Guinea'               = 'GNQ'
  'S. Sudan'                 = 'SSD'
  'W. Sahara'                = $null      # not a registry member; skipped
  'Somaliland'               = $null      # rendered separately by Natural Earth
  'eSwatini'                 = 'SWZ'
  'Guinea-Bissau'            = 'GNB'
  'Tanzania'                 = 'TZA'
  'Gambia'                   = 'GMB'
}

function Round-Ring {
  param($ring)
  # $ring is an array of [x, y] pairs. Round, then drop consecutive duplicates
  # created by the rounding, which is where most of the size saving comes from.
  $out = New-Object System.Collections.Generic.List[object]
  $lastX = [double]::NaN; $lastY = [double]::NaN
  foreach ($pt in $ring) {
    $x = [math]::Round([double]$pt[0], 2)
    $y = [math]::Round([double]$pt[1], 2)
    if ($x -eq $lastX -and $y -eq $lastY) { continue }
    $out.Add(@($x, $y))
    $lastX = $x; $lastY = $y
  }
  # A ring needs at least 4 points to enclose an area once closed.
  if ($out.Count -lt 4) { return $null }
  return ,$out.ToArray()
}

$shapes = [ordered]@{}
$matched = 0; $skipped = @()

foreach ($feat in $gj.features) {
  $p = $feat.properties
  $iso = $null
  if ($p.ISO_A3 -and $p.ISO_A3 -ne '-99' -and $byIso.ContainsKey($p.ISO_A3)) { $iso = $p.ISO_A3 }
  elseif ($p.ADM0_A3 -and $byIso.ContainsKey($p.ADM0_A3)) { $iso = $p.ADM0_A3 }
  elseif ($nameFix.ContainsKey($p.NAME) -and $nameFix[$p.NAME]) { $iso = $nameFix[$p.NAME] }
  if (-not $iso) { continue }
  if (-not $byIso.ContainsKey($iso)) { continue }

  $geom = $feat.geometry
  $polys = New-Object System.Collections.Generic.List[object]

  if ($geom.type -eq 'Polygon') {
    foreach ($ring in $geom.coordinates) {
      $r = Round-Ring $ring
      if ($r) { $polys.Add($r) }
      break   # outer ring only: holes are invisible at this scale and double the payload
    }
  } elseif ($geom.type -eq 'MultiPolygon') {
    foreach ($poly in $geom.coordinates) {
      $r = Round-Ring $poly[0]
      if ($r) { $polys.Add($r) }
    }
  }
  if ($polys.Count -eq 0) { continue }

  # Bounding box and a centroid, so the map can fit and label without recomputing.
  $minX = 1e9; $minY = 1e9; $maxX = -1e9; $maxY = -1e9
  $sumX = 0.0; $sumY = 0.0; $n = 0
  foreach ($ring in $polys) {
    foreach ($pt in $ring) {
      if ($pt[0] -lt $minX) { $minX = $pt[0] }
      if ($pt[0] -gt $maxX) { $maxX = $pt[0] }
      if ($pt[1] -lt $minY) { $minY = $pt[1] }
      if ($pt[1] -gt $maxY) { $maxY = $pt[1] }
      $sumX += $pt[0]; $sumY += $pt[1]; $n++
    }
  }

  $shapes[$iso] = [ordered]@{
    rings  = $polys.ToArray()
    bbox   = @($minX, $minY, $maxX, $maxY)
    centre = @([math]::Round($sumX / $n, 2), [math]::Round($sumY / $n, 2))
  }
  $matched++
}

# Small island states are below the 1:110m rendering threshold and simply are not
# in the source. Dropping them would quietly remove six countries from the map, so
# they are carried as point markers at their approximate centroids and flagged as
# such -- a visible dot with a real value beats an invisible country.
$ISLANDS = @{
  'CPV' = @(-23.6, 15.1)   # Cabo Verde
  'STP' = @(6.6, 0.2)      # Sao Tome and Principe
  'COM' = @(43.3, -11.6)   # Comoros
  'MUS' = @(57.6, -20.3)   # Mauritius
  'REU' = @(55.5, -21.1)   # Reunion
  'SYC' = @(55.5, -4.6)    # Seychelles
}
$pointCount = 0
foreach ($c in $script:AfricaRegistry) {
  if ($shapes.Contains($c.iso3)) { continue }
  if ($ISLANDS.ContainsKey($c.iso3)) {
    $p = $ISLANDS[$c.iso3]
    $shapes[$c.iso3] = [ordered]@{
      rings  = @()
      point  = @($p[0], $p[1])
      bbox   = @($p[0], $p[1], $p[0], $p[1])
      centre = @($p[0], $p[1])
    }
    $pointCount++
  } else {
    $skipped += $c.name
  }
}

$out = [ordered]@{
  source    = 'Natural Earth 1:110m admin-0 countries (public domain)'
  url       = $URL
  precision = '2 decimal places (~1.1 km at the equator)'
  note      = 'Outer rings only; holes and minor islands dropped. Boundaries are as published by ' +
              'Natural Earth. The platform takes no position on contested borders.'
  built     = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  countries = $matched
  pointOnly = $pointCount
  missing   = @($skipped)
  shapes    = $shapes
}

$path = Join-Path $outDir "rsa-geo.json"
[System.IO.File]::WriteAllText($path, ($out | ConvertTo-Json -Depth 12 -Compress),
  (New-Object System.Text.UTF8Encoding($false)))

$kb = [math]::Round((Get-Item $path).Length / 1KB, 1)
Write-Host ("[geo] rsa-geo.json  {0} KB  {1} countries" -f $kb, $matched) -ForegroundColor Green
if ($skipped.Count) {
  Write-Host ("[geo] no boundary for: " + ($skipped -join ", ")) -ForegroundColor Yellow
}
