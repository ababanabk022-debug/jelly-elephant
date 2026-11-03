param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$siteUrl = 'http://127.0.0.1:5194/'
function Test-JellyReady {
    try { $r=Invoke-WebRequest -Uri $siteUrl -UseBasicParsing -TimeoutSec 2; return ($r.StatusCode -eq 200 -and $r.Content -match 'name="human-zoo-jelly-local-site"') } catch { return $false }
}
function Test-JellyPort {
    $client=New-Object System.Net.Sockets.TcpClient
    try { $attempt=$client.ConnectAsync('127.0.0.1',5194); return ($attempt.Wait(400) -and $client.Connected) } catch { return $false } finally { $client.Dispose() }
}
try {
    if (-not (Test-JellyReady)) {
        if (Test-JellyPort) { throw 'Port 5194 belongs to another service. No process was stopped.' }
        foreach($relative in @('jelly-site\index.html','jelly-site\models\jelly-elephant.glb')) {
            if (-not (Test-Path -LiteralPath (Join-Path $project $relative))) { throw "Missing local site file: $relative. Build the local website first." }
        }
        $node=Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $node) { throw 'Node.js is needed to start the local web server; no Internet connection is needed once installed.' }
        $logRoot=Join-Path $project 'artifacts\runtime'; New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
        $script=Join-Path $project 'scripts\serve-jelly-site.mjs'
        $server=Start-Process -FilePath $node.Source -ArgumentList @(('"{0}"' -f $script)) -WorkingDirectory $project -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'jelly-site.stdout.log') -RedirectStandardError (Join-Path $logRoot 'jelly-site.stderr.log') -PassThru
        $until=[DateTime]::UtcNow.AddSeconds(20)
        do { Start-Sleep -Milliseconds 250; if (Test-JellyReady) { break }; $server.Refresh(); if ($server.HasExited) { break } } while ([DateTime]::UtcNow -lt $until)
        if (-not (Test-JellyReady)) { throw "Local server did not start. See $logRoot\jelly-site.stderr.log" }
    }
    Write-Host "Local jelly elephant ready: $siteUrl"
    if (-not $NoBrowser) { Start-Process -FilePath $siteUrl }
    exit 0
} catch { Write-Host "Could not open local site: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
