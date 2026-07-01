# ==========================================================================
# CodexLink Windows Boot Auto-Start Configurator (Pure ASCII Edition)
# ==========================================================================

$ClearScr = Clear-Host

$asciiArt = '
   ______          __           __    _      __    
  / ____/___  ____/ /__  _  __ / /   (_)____/ /__  
 / /   / __ \/ __  / _ \| |/_// /   / / __  / //_/  
/ /___/ /_/ / /_/ /  __/>  < / /___/ / /_/ /  ,<    
\____/\____/\__,_/\___/_/|_|/_____/_/\__,_/_/|_|  
           Windows Scheduled Task Auto-Configurator
'
Write-Host $asciiArt -ForegroundColor Magenta

Write-Host "`n==========================================================================" -ForegroundColor Cyan
Write-Host "  Registering [Silent Background Auto-Start] Scheduled Task..." -ForegroundColor White -Bold
Write-Host "==========================================================================`n" -ForegroundColor Cyan

$serverScript = Join-Path $PSScriptRoot "run-server.ps1"

if (-not (Test-Path $serverScript)) {
    Write-Host " [✘] ERROR: run-server.ps1 was not found in the workspace directory!" -ForegroundColor Red -Bold
    Read-Host "Press Enter to exit..."
    exit
}

$TaskName = "CodexLinkBridge"
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -File `"$serverScript`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 365)

try {
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "CodexLink Local Bridge Background Service" -Force | Out-Null
    
    Write-Host " [✔] Successfully registered the CodexLink startup task!" -ForegroundColor Green -Bold
    Write-Host " [✔] Silent Background Enabled: The server will run in standard 'Hidden Window' mode on system startup." -ForegroundColor Green
    
    Write-Host "`n==========================================================================" -ForegroundColor Cyan
    $choice = Read-Host " Would you like to start the background service silently right now? (Y/N)"
    if ($choice -eq "Y" -or $choice -eq "y" -or $null -eq $choice -or $choice -eq "") {
        Start-ScheduledTask -TaskName $TaskName
        Write-Host " [✔] Service successfully started and is now running silently in the background!" -ForegroundColor Green -Bold
        Write-Host " You can now reload/view your CodexLink Browser Sidepanel. It should connect instantly!" -ForegroundColor Yellow
    }
} catch {
    Write-Host " [✘] Failed to register task! Error:" $_.Exception.Message -ForegroundColor Red -Bold
    Write-Host " TIP: Try running this PowerShell script as Administrator." -ForegroundColor Yellow
}

Write-Host "`n==========================================================================" -ForegroundColor Cyan
Read-Host "Configuration completed! Press Enter to close this window..."
