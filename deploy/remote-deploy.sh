#!/usr/bin/env bash
# 服务器端部署脚本：在项目目录内执行（deploy-to-server.sh 会自动调用）。
#
# 两种模式：
#   不设 WORKBENCH_DOMAIN → 只起应用，用 http://服务器IP:端口 直连（未备案域名的场景）
#   设了 WORKBENCH_DOMAIN → 额外起 Caddy，自动申请 HTTPS 证书（域名必须已备案）
# 前提：防火墙/安全组已放行对应端口。
set -euo pipefail
cd "$(dirname "$0")/.."

# 部署参数写在同目录的 .env 里。docker compose 会自动读它，但 bash 不会 ——
# 不显式载入的话，域名模式永远判成空、走不进 https 分支，Caddy 根本不会启动，
# 而 .env 里的 WORKBENCH_TRUST_PROXY=1 又已经生效：等于让公网直连的 52341
# 无条件信任 X-Forwarded-For，登录限流可以被伪造头绕过。
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  if ! . ./.env 2>/dev/null; then
    echo "!! 读取 .env 失败：值里不能带空格或引号（多域名请写成 a.com,www.a.com 这种无空格形式）。" >&2
    exit 1
  fi
  set +a
fi

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
      PRIMARY_DOMAIN="$(printf '%s' "$WORKBENCH_DOMAIN" | cut -d, -f1 | tr -d '[:space:]')"
      # 只探应用容器是不够的：Caddy 配置写错时它只会反复重启，应用却完全健康，
      # 脚本照样报「已启动 ✓」而站点其实是打不开的（踩过一次）。这里把整条 HTTPS 链路也验一遍：
      # 用 --resolve 指到 127.0.0.1，既走 Caddy 又校验证书与 SNI，还不受 DNS 回环影响。
      echo "==> 等待 Caddy 就绪并申请 HTTPS 证书（首次约需 1-2 分钟）..."
      https_ready=0
      for _ in $(seq 1 24); do
        if curl -fsS --max-time 10 --resolve "${PRIMARY_DOMAIN}:443:127.0.0.1" "https://${PRIMARY_DOMAIN}/health" >/dev/null 2>&1; then
          https_ready=1
          break
        fi
        sleep 5
      done
      if [ "$https_ready" != "1" ]; then
        echo "!! 应用是好的，但 HTTPS 在 2 分钟内没能就绪 —— 站点目前打不开，别当成功。" >&2
        docker compose "${COMPOSE_PROFILE[@]}" logs caddy --tail 20 >&2 || true
        echo "   常见原因：Caddyfile 语法错（多个域名逗号后必须有空格）、域名没解析到本机、80/443 未放行。" >&2
        docker compose "${COMPOSE_PROFILE[@]}" ps
        exit 1
      fi
      echo "==> HTTPS 链路已就绪 ✓  https://${PRIMARY_DOMAIN}"
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
