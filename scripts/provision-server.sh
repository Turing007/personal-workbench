#!/usr/bin/env bash
# 在云服务器上装 Docker（只需跑一次），并先汇报机器现状。
#
# 用法:
#   SSH_KEY=~/.ssh/workbench_deploy_ed25519 bash scripts/provision-server.sh root@服务器IP
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "用法: bash scripts/provision-server.sh 用户名@服务器IP" >&2
  exit 1
fi

SERVER="$1"
SSH=(ssh)
if [ -n "${SSH_KEY:-}" ]; then
  SSH=(-i "$SSH_KEY" -o IdentitiesOnly=yes)
fi

echo "==> 机器现状（系统 / CPU / 内存 / 磁盘）..."
"${SSH[@]}" "$SERVER" '
  . /etc/os-release 2>/dev/null && echo "系统:   $PRETTY_NAME"
  echo "内核:   $(uname -sr)"
  echo "CPU:    $(nproc) 核"
  free -h | awk "/Mem:/ {print \"内存:   \" \$7 \" 可用 / \" \$2 \" 总量\"}"
  df -h / | awk "NR==2 {print \"磁盘:   \" \$4 \" 可用 / \" \$2 \" 总量\"}"
  command -v docker >/dev/null 2>&1 && echo "Docker: 已装 $(docker --version)" || echo "Docker: 未安装"
'

echo ""
read -r -p "==> 确认在这台机器上安装 Docker？输入 yes 继续: " answer
if [ "$answer" != "yes" ]; then
  echo "已取消。"
  exit 1
fi

echo "==> 安装 Docker（官方脚本，几分钟）..."
"${SSH[@]}" "$SERVER" 'curl -fsSL https://get.docker.com | sh && systemctl enable --now docker'

echo "==> 验证..."
"${SSH[@]}" "$SERVER" 'docker --version && docker compose version'
echo "==> Docker 就绪，可以跑 deploy-to-server.sh 了。"
