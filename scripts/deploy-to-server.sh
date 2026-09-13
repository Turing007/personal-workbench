#!/usr/bin/env bash
# 从本机（Windows Git Bash / macOS / Linux）一键部署工作台到云服务器。
#
# 用法:
#   bash scripts/deploy-to-server.sh 用户名@服务器IP 域名
# 示例:
#   bash scripts/deploy-to-server.sh root@1.2.3.4 1-2-3-4.sslip.io
#
# 前提:
#   1. 服务器已安装 Docker（官方安装指引见 get.docker.com 官网文档）
#   2. 云控制台安全组已放行 22、80、443 端口
#   3. 本机可 SSH 免密或已配置登录方式
#
# 数据迁移: 部署完成后，在电脑上「设置 → 备份与恢复 → 创建备份」下载 ZIP，
#          打开服务器站点用管理员账号「设置 → 选择备份恢复」上传即可。
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "用法: bash scripts/deploy-to-server.sh 用户名@服务器IP 域名" >&2
  echo "示例: bash scripts/deploy-to-server.sh root@1.2.3.4 1-2-3-4.sslip.io" >&2
  exit 1
fi

SERVER="$1"
DOMAIN="$2"
REMOTE_DIR="~/workbench"

echo "==> [1/3] 打包源代码（不含数据与依赖）..."
tar -czf /tmp/workbench-deploy.tgz \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=data \
  --exclude=test-results \
  --exclude=playwright-report \
  --exclude=.git \
  --exclude=android \
  .

echo "==> [2/3] 上传到 ${SERVER}:${REMOTE_DIR} ..."
ssh "$SERVER" "mkdir -p ${REMOTE_DIR}"
scp -q /tmp/workbench-deploy.tgz "$SERVER:/tmp/workbench-deploy.tgz"
ssh "$SERVER" "tar -xzf /tmp/workbench-deploy.tgz -C ${REMOTE_DIR} && rm /tmp/workbench-deploy.tgz"
rm /tmp/workbench-deploy.tgz

echo "==> [3/3] 在服务器上构建并启动..."
ssh -t "$SERVER" "cd ${REMOTE_DIR} && echo 'WORKBENCH_DOMAIN=${DOMAIN}' > .env && bash deploy/remote-deploy.sh"

echo ""
echo "==> 部署完成！首次访问 https://${DOMAIN} 时，页面会引导你创建管理员账号。"
