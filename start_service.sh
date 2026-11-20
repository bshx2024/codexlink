#!/usr/bin/env bash
# ==============================================================================
# ComLinkAI - Linux Desktop Local Helper (One-Click Startup)
# 用于 Linux 桌面环境 (Ubuntu, Debian, Fedora, Arch 等) 本地启动 Bridge 服务的脚本
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="${SCRIPT_DIR}/server"

echo "======================================================"
echo "  🔗 ComLinkAI Linux Local Helper (One-Click Startup)"
echo "======================================================"
echo ""

# 检查 Node.js 是否已安装
if ! command -v node &> /dev/null; then
    echo "[错误] 您的系统尚未安装 Node.js！"
    echo "请先通过包管理器安装 Node.js 18+ 或从 https://nodejs.org 下载安装。"
    echo "Ubuntu/Debian 快捷安装: sudo apt install -y nodejs npm"
    exit 1
fi

echo "[✔] Node.js 版本: $(node -v)"
echo ""

# 检查并安装依赖
cd "${SERVER_DIR}"
if [ ! -d "node_modules" ]; then
    echo "[*] 未找到依赖库，正在自动执行 npm install..."
    npm install
    echo ""
fi

echo "[✔] 依赖项已就绪。"
echo "[*] 正在启动 ComLinkAI Bridge 服务 (端口: 3010)..."
echo "👉 请在 Chrome 浏览器中加载 extension 目录并打开侧边栏！"
echo ""

node index.js
