#!/usr/bin/env bash
# ==============================================================================
# ComLinkAI - Linux VPS 7x24h 云端无头自动化引擎一键部署脚本
# 支持系统: Ubuntu 20.04/22.04/24.04 LTS, Debian 11/12
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}==================================================================${NC}"
echo -e "${GREEN}    🚀 ComLinkAI 7x24h 云端无头全自动外链引擎 一键部署向导       ${NC}"
echo -e "${CYAN}==================================================================${NC}"
echo ""

# 1. 检查是否为 root 用户
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[错误] 请使用 sudo 或 root 用户权限运行此脚本！${NC}"
  echo "示例: sudo bash deploy_vps.sh"
  exit 1
fi

# 2. 安装 Docker 与 Docker Compose (若未安装)
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}[1/5] 未检测到 Docker，正在自动安装官方最新版 Docker 环境...${NC}"
    apt-get update -y
    apt-get install -y ca-certificates curl gnupg lsb-release
    curl -fsSL https://get.docker.com | bash
    systemctl enable docker
    systemctl start docker
    echo -e "${GREEN}✔ Docker 安装完成！${NC}"
else
    echo -e "${GREEN}[✔] Docker 已安装: $(docker --version)${NC}"
fi

# 检查 docker compose 命令
if ! docker compose version &> /dev/null; then
    echo -e "${YELLOW}[2/5] 正在安装 docker-compose-plugin 插件...${NC}"
    apt-get update -y
    apt-get install -y docker-compose-plugin
fi

# 3. 创建日志与存证目录
echo -e "${YELLOW}[3/5] 初始化持久化存储与日志卷...${NC}"
mkdir -p logs artifacts APIVALE_Outreach_Hub
chmod -R 777 logs artifacts

# 4. 配置防火墙端口 (若启用了 ufw)
if command -v ufw &> /dev/null && ufw status | grep -q "Status: active"; then
    echo -e "${YELLOW}[4/5] 开放防火墙通信端口 (3010, 6080)...${NC}"
    ufw allow 3010/tcp comment 'ComLinkAI Bridge API'
    ufw allow 6080/tcp comment 'ComLinkAI noVNC Web Console'
    ufw reload
fi

# 5. 构建并启动容器
echo -e "${YELLOW}[5/5] 正在构建 ComLinkAI 云端守护容器镜像并后台启动...${NC}"
docker compose down || true
docker compose up -d --build

# 6. 获取 VPS 公网 IP
SERVER_IP=$(curl -s -4 ifconfig.me || curl -s -4 icanhazip.com || echo "YOUR_VPS_IP")

echo ""
echo -e "${CYAN}==================================================================${NC}"
echo -e "${GREEN}🎉 ComLinkAI 7x24h 云端无头自动化守护服务已部署成功并运行！${NC}"
echo -e "${CYAN}==================================================================${NC}"
echo ""
echo -e "🖥️  ${YELLOW}noVNC Web 浏览器可视化桌面控制台${NC}:"
echo -e "   👉 ${GREEN}http://${SERVER_IP}:6080/vnc.html${NC}"
echo -e "   (在任何手机或电脑浏览器打开该链接，即可实时看到 Chromium 与 ComLinkAI 插件的操作画面！)"
echo ""
echo -e "🔗 ${YELLOW}Bridge REST & WebSocket 状态检测${NC}:"
echo -e "   👉 ${GREEN}http://${SERVER_IP}:3010/health${NC}"
echo ""
echo -e "📝 ${YELLOW}常用运维指令${NC}:"
echo -e "   - 实时查看容器日志:    ${CYAN}docker compose logs -f${NC}"
echo -e "   - 重启自动化引擎:      ${CYAN}docker compose restart${NC}"
echo -e "   - 停止守护服务:        ${CYAN}docker compose down${NC}"
echo -e "   - 查看外链存证截图:    ${CYAN}ls -l artifacts/${NC}"
echo ""
echo -e "${CYAN}==================================================================${NC}"
