# ==============================================================================
# ComLinkAI - Cloud Headless Linux Container (7x24h Autonomous Outreach Engine)
# Supports: Xvfb Virtual Display + Chromium with Extension + noVNC Web GUI + Node.js
# ==============================================================================

FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    SCREEN_WIDTH=1920 \
    SCREEN_HEIGHT=1080 \
    SCREEN_DEPTH=24 \
    VNC_PORT=5900 \
    NOVNC_PORT=6080 \
    BRIDGE_PORT=3010

# 1. 安装基础依赖、Chromium、Xvfb 虚拟屏幕、Fluxbox、VNC 及中文字体支持
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    xvfb \
    fluxbox \
    x11vnc \
    novnc \
    websockify \
    supervisor \
    curl \
    ca-certificates \
    procps \
    net-tools \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-wqy-zenhei \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 2. 安装 Node.js 桥接服务依赖
COPY server/package.json server/
RUN cd server && npm install --production

# 3. 复制工程核心代码与资源
COPY extension /app/extension
COPY server /app/server
COPY APIVALE_Outreach_Hub /app/APIVALE_Outreach_Hub
COPY .agents /app/.agents
COPY docs /app/docs
COPY docker /app/docker

# 4. 创建运行目录与日志目录
RUN mkdir -p /app/logs /app/artifacts /app/data /root/.novnc \
    && chmod +x /app/docker/*.sh || true

# 5. 暴露对外端口:
#    3010: ComLinkAI 本地/云端 Bridge HTTP & WS 接口
#    6080: noVNC Web 浏览器可视化控制台 (浏览器直连查看桌面)
#    5900: 原生 VNC 端口
EXPOSE 3010 6080 5900

# 6. 容器启动入口 (Supervisord 统一守护各子进程)
CMD ["/usr/bin/supervisord", "-c", "/app/docker/supervisord.conf"]
