# ==========================================================================
# CodexLink Digital Distribution Package Builder (Robust ASCII Paths)
# ==========================================================================

$kitName = "CodexLink_Obsidian_Workflow_Kit"
$workspaceRoot = "e:\kaifa\CodexLink"
$buildDir = Join-Path $workspaceRoot $kitName
$obsidianVault = "E:\obsidianfiles"

Write-Host "Creating distribution directories..." -ForegroundColor Cyan
if (Test-Path $buildDir) {
    Remove-Item $buildDir -Recurse -Force -ErrorAction SilentlyContinue | Out-Null
}
New-Item -ItemType Directory -Path $buildDir -Force | Out-Null

# 1. Copy Browser Extension using Robocopy
$extDest = Join-Path $buildDir "1_extension"
Write-Host "Copying extension..." -ForegroundColor Gray
New-Item -ItemType Directory -Path $extDest -Force | Out-Null
robocopy (Join-Path $workspaceRoot "extension") $extDest /E /XD .git node_modules /NJH /NJS /NFL /NDL > $null

# 2. Copy Local Server
$serverDest = Join-Path $buildDir "2_server"
Write-Host "Copying server files..." -ForegroundColor Gray
New-Item -ItemType Directory -Path $serverDest -Force | Out-Null
Copy-Item -Path (Join-Path $workspaceRoot "server\index.js") -Destination (Join-Path $serverDest "index.js") -Force
Copy-Item -Path (Join-Path $workspaceRoot "server\package.json") -Destination (Join-Path $serverDest "package.json") -Force

# 3. Copy Obsidian Vault Template using Robocopy
$obsDest = Join-Path $buildDir "3_obsidian_template"
Write-Host "Copying Obsidian Template folders..." -ForegroundColor Gray
New-Item -ItemType Directory -Path $obsDest -Force | Out-Null

$vaultItems = @(
    ".obsidian",
    ".claudian",
    ".claude",
    "01_原始资料_Raw",
    "02_消化复盘_Digest",
    "03_方法论模板_Templates",
    "04_最终输出_Output",
    "99_Codex_Skills",
    "tools"
)

foreach ($item in $vaultItems) {
    $srcPath = Join-Path $obsidianVault $item
    if (Test-Path $srcPath) {
        Write-Host "  Copying $item..." -ForegroundColor DarkGray
        if (Test-Path $srcPath -PathType Container) {
            $destItemPath = Join-Path $obsDest $item
            New-Item -ItemType Directory -Path $destItemPath -Force | Out-Null
            robocopy $srcPath $destItemPath /E /XD .git node_modules .venv __pycache__ .pytest_cache /XF *.pyc *.log /R:0 /W:0 /NJH /NJS /NFL /NDL > $null
        } else {
            Copy-Item -Path $srcPath -Destination $obsDest -Force
        }
    }
}

# 4. Create one-click startup batch file
$batContent = @"
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
"@

$batPath = Join-Path $buildDir "start_service.bat"
Set-Content -Path $batPath -Value $batContent

# 5. Create README.txt in the build root
$readmeContent = @"
==========================================================================
 🔗 CodexLink 双脑联动知识库闭环系统 - 用户使用说明书
==========================================================================

感谢您使用 CodexLink 闭环系统！这是一套将“网页剪存 -> AI 智能提炼 -> Obsidian 知识沉淀”完美打通的极速工作流。

只需简单三步，即可在您的电脑上完美运行：

--------------------------------------------------------------------------
👉 第一步：解压并载入浏览器插件
--------------------------------------------------------------------------
1. 在 Chrome (或 Edge) 浏览器地址栏输入：chrome://extensions/ 并回车。
2. 在页面右上角，开启【开发者模式】(Developer mode) 开关。
3. 点击左上角的【加载已解压的扩展程序】(Load unpacked) 按钮。
4. 选择本目录下这个文件夹：
   "1_extension"

--------------------------------------------------------------------------
👉 第二步：一键运行本地辅助服务 (本系统核心)
--------------------------------------------------------------------------
1. 双击运行根目录下的：
   "start_service.bat"
2. 系统会全自动检测您的 Node.js 环境、自动安装运行依赖，并保持在后台运行。
   (提示：如果您的电脑上还没有安装 Node.js，请先前往官网 https://nodejs.org 下载并安装)

--------------------------------------------------------------------------
👉 第三步：用 Obsidian 打开知识库模板
--------------------------------------------------------------------------
1. 打开您的 Obsidian 客户端。
2. 点击左侧的“打开本地文件夹 (Open folder as vault)”按钮。
3. 选择本目录下这个文件夹载入：
   "3_obsidian_template"
4. 此时，您的一整套“01_原始资料_Raw”分类目录、AI 插件配置都已经开箱即用完美载现！

--------------------------------------------------------------------------
🚀 开始体验极速工作流：
--------------------------------------------------------------------------
1. 打开浏览器，进入任何您想收藏或学习的网页。
2. 点击右上角插件栏的 CodexLink 徽章，展开右侧侧边栏。
3. 点击“提取并预览网页 Markdown”，接着点击出现的：
   - [一键剪存至 Obsidian]
4. 打开 Obsidian 客户端，您会发现文章已经以最完美的排版在左侧 "CodexLink" 目录下生成！

祝您学习与工作愉快！
==========================================================================
"@

$readmePath = Join-Path $buildDir "README.txt"
Set-Content -Path $readmePath -Value $readmeContent

# 6. Compress into ZIP
Write-Host "Compressing Kit into a single ZIP file..." -ForegroundColor Cyan
$zipPath = Join-Path $workspaceRoot "CodexLink_Obsidian_Workflow_Kit.zip"
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue | Out-Null
}
Compress-Archive -Path $buildDir -DestinationPath $zipPath

Write-Host "SUCCESS! Your digital distribution package is ready:" -ForegroundColor Green -Bold
Write-Host "Path: $zipPath" -ForegroundColor Green
