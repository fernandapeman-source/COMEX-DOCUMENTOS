# PEMAN Comex App — PowerShell HTTP Server (no Node.js required)
$root = Join-Path $PSScriptRoot "public"
$port = 3000
$url  = "http://localhost:$port/"

$mimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.ico'  = 'image/x-icon'
    '.xlsx' = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($url)

try {
    $listener.Start()
    Write-Host " Servidor corriendo en $url" -ForegroundColor Green
    Write-Host " Presiona CTRL+C para detener." -ForegroundColor Yellow
    Start-Process $url   # open browser

    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $res = $ctx.Response

        $localPath = $req.Url.LocalPath.TrimStart('/')
        if ($localPath -eq '') { $localPath = 'index.html' }
        $filePath = Join-Path $root $localPath

        if (Test-Path $filePath -PathType Leaf) {
            $ext  = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mime = if ($mimeTypes[$ext]) { $mimeTypes[$ext] } else { 'application/octet-stream' }
            $res.ContentType = $mime
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $res.StatusCode = 404
            $body = [Text.Encoding]::UTF8.GetBytes('404 Not Found')
            $res.OutputStream.Write($body, 0, $body.Length)
        }
        $res.Close()
    }
} finally {
    $listener.Stop()
}
