# ==========================================================================
# CodexLink Bridge Server Startup Script (Pure ASCII Edition)
# ==========================================================================

$Host.UI.RawUI.WindowTitle = "🔗 CodexLink Local Bridge Server"
$ClearScr = Clear-Host

function Write-Header ($text) {
    Write-Host "`n==========================================================================" -ForegroundColor Cyan
    Write-Host "  $text" -ForegroundColor White -Bold
    Write-Host "==========================================================================`n" -ForegroundColor Cyan
}

function Write-Info ($text) {
    Write-Host " [*] $text" -ForegroundColor Gray
}

function Write-Success ($text) {
    Write-Host " [✔] $text" -ForegroundColor Green -Bold
}

function Write-ErrorMsg ($text) {
    Write-Host " [✘] $text" -ForegroundColor Red -Bold
}

# 1. ASCII Art Banner
$asciiArt = '
   ______          __           __    _      __    
  / ____/___  ____/ /__  _  __ / /   (_)____/ /__  
 / /   / __ \/ __  / _ \| |/_// /   / / __  / //_/  
/ /___/ /_/ / /_/ /  __/>  < / /___/ / /_/ /  ,<    
\____/\____/\__,_/\___/_/|_|/_____/_/\__,_/_/|_|  
                  Local Bridge Server v1.0.0
'
Write-Host $asciiArt -ForegroundColor Magenta

Write-Header "Environment Verification & Dependency Check"

# 2. Verify Node.js Environment
$nodeExe = "node"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $candidateNodes = @(
        "C:\Program Files\nodejs\node.exe",
        "C:\Program Files (x86)\nodejs\node.exe",
        "$env:LOCALAPPDATA\ms-playwright-go\1.57.0\node.exe"
    )
    foreach ($cand in $candidateNodes) {
        if (Test-Path $cand) {
            $nodeExe = $cand
            break
        }
    }
    if ($nodeExe -eq "node") {
        $foundNode = Get-ChildItem -Path "$env:LOCALAPPDATA" -Filter "node.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($foundNode) {
            $nodeExe = $foundNode.FullName
        }
    }
}

$nodeVersion = & $nodeExe -v 2>$null
if ($null -eq $nodeVersion) {
    Write-ErrorMsg "Node.js is not installed!"
    Write-Host "Please download and install Node.js from https://nodejs.org first." -ForegroundColor Yellow
    Read-Host "Press Enter to exit..."
    exit
}
Write-Success "Node.js detected ($nodeExe): $nodeVersion"

# 3. Check and Install Server Dependencies
$serverDir = Join-Path $PSScriptRoot "server"
$nodeModulesDir = Join-Path $serverDir "node_modules"

if (-not (Test-Path $nodeModulesDir)) {
    Write-Info "Server dependencies not found."
} else {
    Write-Success "Dependencies are ready."
}

# 4. Show Setup Instructions
Write-Header "CodexLink Setup Instructions"
Write-Host "👉 STEP 1: Load Browser Extension" -ForegroundColor Yellow -Bold
Write-Info "1. Open Chrome or Edge and navigate to: chrome://extensions"
Write-Info "2. Enable 'Developer mode' in the top-right corner."
Write-Info "3. Click 'Load unpacked' and select the extension directory:"
Write-Host "      $PSScriptRoot\extension" -ForegroundColor DarkCyan
Write-Info "4. Click the CodexLink icon in your toolbar to open the Sidepanel."

Write-Header "Starting Server (Press Ctrl+C to shut down)"

# 5. Start Node.js Server
& $nodeExe "$serverDir\index.js"
