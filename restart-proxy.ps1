$ErrorActionPreference = 'SilentlyContinue'

Write-Host "Checking port 28642..."
$connection = Get-NetTCPConnection -LocalPort 28642
if ($connection) {
    Write-Host "Stopping process $($connection.OwningProcess) on port 28642..."
    Stop-Process -Id $connection.OwningProcess -Force
    Start-Sleep -Seconds 1
}

Write-Host "Starting apivale-role-proxy-workspace.js..."
$logPath = "e:\kaiyuan\PilotDeck\proxy-workspace.log"
$errPath = "e:\kaiyuan\PilotDeck\proxy-workspace.err"

# Start the node process in background
Start-Process -FilePath "node" -ArgumentList "e:\kaiyuan\PilotDeck\apivale-role-proxy-workspace.js" -NoNewWindow -RedirectStandardOutput $logPath -RedirectStandardError $errPath

Start-Sleep -Seconds 2
Write-Host "Verification: checking if port 28642 is listening..."
$newConnection = Get-NetTCPConnection -LocalPort 28642
if ($newConnection) {
    Write-Host "SUCCESS: Proxy is running on port 28642 (PID: $($newConnection.OwningProcess))"
} else {
    Write-Host "FAILURE: Proxy failed to start. Errors:"
    if (Test-Path $errPath) {
        Get-Content $errPath
    }
}
