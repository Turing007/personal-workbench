#!/usr/bin/env bash
# 服务器端部署脚本：在项目目录内执行（deploy-to-server.sh 会自动调用）。
# 前提：服务器已安装 Docker 与 Docker Compose 插件，防火墙/安全组已放行 80、443。
set -euo pipefail
cd "$(dirname "$0")/.."

: "${WORKBENCH_DOMAIN:?请先设置 WORKBENCH_DOMAIN 环境变量（例如 1-2-3-4.sslip.io）}"

echo "==> 域名: ${WORKBENCH_DOMAIN}"
echo "==> 构建 Docker 镜像并启动服务（首次构建需要几分钟）..."
docker compose up -d --build

echo "==> 等待服务就绪..."
for attempt in $(seq 1 30); do
  if docker compose exec -T workbench wget -qO- http://127.0.0.1:52341/health >/dev/null 2>&1; then
    echo "==> 工作台服务已启动 ✓"
    echo "==> Caddy 正在自动申请 HTTPS 证书（首次约需 1-2 分钟）..."
    echo "==> 稍后访问: https://${WORKBENCH_DOMAIN}"
    docker compose ps
    exit 0
  fi
  sleep 2
done

echo "!! 服务未能在 60 秒内就绪，请查看日志: docker compose logs workbench" >&2
exit 1
