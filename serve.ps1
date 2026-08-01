# Static dev server for Rice Statistics for Africa.
#
# Same approach as the GPIF Workbench server: HttpListener from the .NET base
# library, so there is no toolchain to install and binding to "localhost"
# needs no elevation.
#
# It rebuilds index.html whenever a source module is newer, and sends no-store so
# a reload always reflects the edit you just made. Serving over http:// rather
# than file:// also gives the page a secure context, which the clipboard API and
# the JSON fetches both need.

param([int]$Port = 8788)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

$MIME = @{
  ".html"="text/html; charset=utf-8"; ".htm"="text/html; charset=utf-8"
  ".js"="text/javascript; charset=utf-8"; ".css"="text/css; charset=utf-8"
  ".json"="application/json; charset=utf-8"; ".svg"="image/svg+xml"
  ".csv"="text/csv; charset=utf-8"; ".txt"="text/plain; charset=utf-8"
  ".png"="image/png"; ".jpg"="image/jpeg"; ".jpeg"="image/jpeg"
  ".ico"="image/x-icon"; ".woff2"="font/woff2"; ".map"="application/json"
}

$sources = @("src\shell.html","src\rsa-i18n.js","src\rsa-validate.js","src\rsa-core.js","src\rsa-indicators.js","src\rsa-tsa.js",
             "src\rsa-scenarios.js","src\rsa-policy.js","src\rsa-crisis.js","src\rsa-condition.js","src\rsa-advisor.js",
             "src\rsa-vanoort.js","src\rsa-datadict.js","src\rsa-figs.js","src\rsa-report.js",
             "src\rsa-app.js")

function Update-Bundle {
  $out = Join-Path $root "index.html"
  $newest = $sources |
    ForEach-Object { Join-Path $root $_ } |
    Where-Object { Test-Path $_ } |
    ForEach-Object { (Get-Item $_).LastWriteTimeUtc } |
    Sort-Object -Descending |
    Select-Object -First 1
  if (-not $newest) { return }
  if ((Test-Path $out) -and ((Get-Item $out).LastWriteTimeUtc -ge $newest)) { return }
  try {
    & (Join-Path $root "build.ps1") | Out-Null
    Write-Output ("[build] index.html rebuilt " + (Get-Date -Format "HH:mm:ss"))
  } catch {
    Write-Output ("[build] FAILED: " + $_.Exception.Message)
  }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try {
  $listener.Start()
} catch {
  Write-Output ("[serve] cannot bind port {0}: {1}" -f $Port, $_.Exception.Message)
  exit 1
}

Update-Bundle
Write-Output ("[serve] Rice Statistics for Africa on http://localhost:{0}/  (root: {1})" -f $Port, $root)

while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  $req = $ctx.Request
  $res = $ctx.Response
  $status = 200
  try {
    $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart("/")
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = "index.html" }
    $rel = $rel -replace "/", "\"

    if ($rel -ieq "index.html") { Update-Bundle }

    $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
    if (-not $full.StartsWith([System.IO.Path]::GetFullPath($root), [StringComparison]::OrdinalIgnoreCase)) {
      $status = 403
      $body = [Text.Encoding]::UTF8.GetBytes("403 forbidden")
      $res.ContentType = "text/plain; charset=utf-8"
    } elseif (Test-Path -LiteralPath $full -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
      $res.ContentType = if ($MIME.ContainsKey($ext)) { $MIME[$ext] } else { "application/octet-stream" }
      $body = [System.IO.File]::ReadAllBytes($full)
    } else {
      $status = 404
      $body = [Text.Encoding]::UTF8.GetBytes("404 not found: $rel")
      $res.ContentType = "text/plain; charset=utf-8"
    }

    $res.StatusCode = $status
    $res.Headers.Add("Cache-Control", "no-store, must-revalidate")
    $res.ContentLength64 = $body.Length
    if ($req.HttpMethod -ne "HEAD") {
      $res.OutputStream.Write($body, 0, $body.Length)
    }
  } catch {
    Write-Output ("[serve] error: " + $_.Exception.Message)
  } finally {
    try { $res.OutputStream.Close() } catch {}
  }
  Write-Output ("{0} {1} {2}" -f $status, $req.HttpMethod, $req.Url.AbsolutePath)
}

