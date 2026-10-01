#!/usr/bin/env bash
# 服务器端部署脚本：在项目目录内执行（deploy-to-server.sh 会自动调用）。
#
# 两种模式：
#   不设 WORKBENCH_DOMAIN → 只起应用，用 http://服务器IP:端口 直连（未备案域名的场景）
#   设了 WORKBENCH_DOMAIN → 额外起 Caddy，自动申请 HTTPS 证书（域名必须已备案）
# 前提：防火墙/安全组已放行对应端口。
set -euo pipefail
cd "$(dirname "$0")/.."

: "${WORKBENCH_PUBLIC_PORT:=52341}"

if [ -n "${WORKBENCH_DOMAIN:-}" ]; then
  echo "==> 域名模式：${WORKBENCH_DOMAIN}（含 HTTPS）"
  COMPOSE_PROFILE=(--profile https)
  # Caddy 拿不到域名就没法申请证书，这里提前拦住，别让容器起来才发现
  docker compose "${COMPOSE_PROFILE[@]}" config >/dev/null
elif [ "${1:-}" = "--https" ]; then
  echo "!! 指定了 --https 但没有 WORKBENCH_DOMAIN，无法申请证书。请在 .env 里设置域名。" >&2
  exit 1
else
  echo "==> IP 直连模式：不启用 Caddy，端口 ${WORKBENCH_PUBLIC_PORT}"
  COMPOSE_PROFILE=()
fi

echo "==> 构建 Docker 镜像并启动服务（首次构建需要几分钟）..."
docker compose "${COMPOSE_PROFILE[@]}" up -d --build

# 镜像是 Debian slim，里面没有 wget/curl，探活只能用 Node 自带的 fetch。
probe() {
  docker compose exec -T workbench node -e \
    "fetch('http://127.0.0.1:' + (process.env.WORKBENCH_PORT || 52341) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" \
    >/dev/null 2>&1
}

echo "==> 等待服务就绪..."
for _ in $(seq 1 40); do
  if probe; then
    echo "==> 工作台服务已启动 ✓"
    if [ -n "${WORKBENCH_DOMAIN:-}" ]; then
      echo "==> Caddy 正在申请 HTTPS 证书（首次约需 1-2 分钟）"
      echo "==> 稍后访问: https://${WORKBENCH_DOMAIN}"
    else
      echo "==> 访问地址: http://<服务器公网IP>:${WORKBENCH_PUBLIC_PORT}"
      echo "!! 记得在阿里云轻量控制台「防火墙」里放行 ${WORKBENCH_PUBLIC_PORT}/tcp"
    fi
    docker compose "${COMPOSE_PROFILE[@]}" ps
    exit 0
  fi
  sleep 3
done

echo "!! 服务未能在 120 秒内就绪，请查看日志: docker compose logs workbench" >&2
exit 1
