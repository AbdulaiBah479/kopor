# Fallback static server when Node.js is not installed: powershell -File tools\serve.ps1 [port]
param([int]$Port = 5173)
$root = Split-Path -Parent $PSScriptRoot
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.mjs'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8';
  '.json'='application/json'; '.webmanifest'='application/manifest+json'; '.svg'='image/svg+xml'; '.png'='image/png' }
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "Kopor running at http://localhost:$Port"
while ($l.IsListening) {
  $ctx = $l.GetContext()
  $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
  if ($path.EndsWith('/')) { $path += 'index.html' }
  $file = [IO.Path]::GetFullPath((Join-Path $root $path.TrimStart('/')))
  if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
    $bytes = [IO.File]::ReadAllBytes($file)
    $ext = [IO.Path]::GetExtension($file)
    $ctx.Response.ContentType = $(if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' })
    $ctx.Response.Headers.Add('Cache-Control', 'no-cache')
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else { $ctx.Response.StatusCode = 404 }
  $ctx.Response.Close()
}
