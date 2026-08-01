# Bundles src/shell.html plus the JS modules into a single index.html.
#
# The platform ships as one self-contained HTML file so it can be opened from a
# USB stick, emailed, or dropped on any static host with no build step and no
# runtime. The data files stay external because they are large and are refreshed
# on a different cadence than the code.
#
# shell.html carries the marker
#     <!-- @modules -->
# which is replaced by the concatenated modules inside a single <script> tag.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$src  = Join-Path $root "src"
$shell = Join-Path $src "shell.html"

if (-not (Test-Path $shell)) {
  Write-Output "[build] src/shell.html not found -- nothing to bundle yet"
  exit 0
}

# Order matters: core defines RSA, which the others reference at call time.
$modules = @(
  "rsa-i18n.js",
  "rsa-validate.js",
  "rsa-core.js",
  "rsa-indicators.js",
  "rsa-tsa.js",
  "rsa-scenarios.js",
  "rsa-policy.js",
  "rsa-crisis.js",
  "rsa-condition.js",
  "rsa-vanoort.js",
  "rsa-datadict.js",
  "rsa-figs.js",
  "rsa-report.js",
  "rsa-app.js"
)

$sb = New-Object System.Text.StringBuilder
$included = @()
foreach ($m in $modules) {
  $p = Join-Path $src $m
  if (-not (Test-Path $p)) { continue }
  $included += $m
  [void]$sb.AppendLine("/* ===== $m ".PadRight(78, '=') + " */")
  [void]$sb.AppendLine([System.IO.File]::ReadAllText($p))
  [void]$sb.AppendLine()
}

$html = [System.IO.File]::ReadAllText($shell)
if ($html -notmatch [regex]::Escape("<!-- @modules -->")) {
  throw "src/shell.html has no <!-- @modules --> marker"
}

$stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss 'UTC'")
$banner = "/* Rice Statistics for Africa -- bundled $stamp */"
$script = "<script>" + [Environment]::NewLine + $banner + [Environment]::NewLine + $sb.ToString() + "</script>"

$html = $html.Replace("<!-- @modules -->", $script)
$out = Join-Path $root "index.html"
[System.IO.File]::WriteAllText($out, $html, (New-Object System.Text.UTF8Encoding($false)))

$kb = [math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Output ("[build] index.html  {0} KB  ({1} modules: {2})" -f $kb, $included.Count, ($included -join ", "))
