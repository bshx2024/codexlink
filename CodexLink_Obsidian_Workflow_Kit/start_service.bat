@echo off
title 🔗 CodexLink Local Helper
cd /d "%~dp02_server"
echo ======================================================
echo   CodexLink Local Helper (One-Click Startup)
echo ======================================================
echo.
echo [*] Checking for Node.js installation...
node -v >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed on your system!
    echo Please download and install Node.js from: https://nodejs.org/
    echo.
    pause
    exit /b
)

echo [✔] Node.js detected.
echo.
echo [*] Inspecting dependencies...
if not exist "node_modules" (
    echo [*] Server dependencies not found. Auto-installing now...
    call npm install
    echo.
)

echo [✔] Dependencies are ready.
echo [*] Launching CodexLink Bridge Server...
echo.
node index.js
pause
