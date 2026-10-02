#!/usr/bin/env bash
# 从本机（Windows Git Bash / macOS / Linux）一键部署工作台到云服务器。
#
# 用法:
#   bash scripts/deploy-to-server.sh 用户名@服务器IP                # IP 直连（无需备案）
#   bash scripts/deploy-to-server.sh 用户名@服务器IP 已备案域名      # 附带 HTTPS
#   bash scripts/deploy-to-server.sh 用户名@服务器IP 'a.com,www.a.com'  # 多个名字共用一张证书
#
# 需要指定私钥时用环境变量传：
#   SSH_KEY=~/.ssh/workbench_deploy_ed25519 bash scripts/deploy-to-server.sh root@1.2.3.4
#
# 前提:
#   1. 服务器已安装 Docker（缺的话先跑 scripts/provision-server.sh）
#   2. 云控制台防火墙已放行 22 与 52341（HTTPS 模式则放行 80、443）
#   3. 本机可用密钥免密登录该服务器
#
# 每次部署前会自动给线上数据库拍一份快照（data/backups/部署前快照-*.sqlite），
# 因为迁移是容器启动时自动执行的 —— 改坏了要能退回当天，而不是最多 24 小时前的定时备份。
# 快照失败会直接中止部署，不带病上线。
#
# 数据迁移: 别用 UI 的「选择备份恢复」—— 上传走 multipart，上限 20MB，全量数据有数百 MB。
#          正确做法是把本地 data/ 目录整份拷到服务器的 ~/workbench/data（compose 用的就是
#          bind mount），再重启容器；备份 ZIP 只适合做归档。
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "用法: bash scripts/deploy-to-server.sh 用户名@服务器IP [域名]" >&2
  exit 1
fi

SERVER="$1"
DOMAIN="${2:-}"
REMOTE_DIR="~/workbench"
# 域名要拼进远端命令，先卡死字符集，避免把 shell 元字符带过去。
# 允许写多个（逗号分隔）：Caddy 会给站点块里所有名字签同一张证书，
# 线上就是 vigortech.xyz + www.vigortech.xyz 一起覆盖。
if [ -n "$DOMAIN" ]; then
  printf '%s' "$DOMAIN" | grep -Eq '[A-Za-z0-9]' || { echo "!! 域名无效：$DOMAIN" >&2; exit 1; }
  for domain_part in $(printf '%s' "$DOMAIN" | tr ',' ' '); do
    if ! printf '%s' "$domain_part" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$'; then
      echo "!! 域名格式无效：$domain_part" >&2
      exit 1
    fi
  done
fi
SSH=(ssh)
SCP=(scp)
if [ -n "${SSH_KEY:-}" ]; then
  # 数组里必须带上 ssh/scp 本身：漏掉的话整条命令会以 -i 开头，bash 直接报 command not found。
  SSH=(ssh -i "$SSH_KEY" -o IdentitiesOnly=yes)
  SCP=(scp -i "$SSH_KEY" -o IdentitiesOnly=yes)
fi

echo "==> [1/5] 检查服务器连通性与 Docker..."
if ! "${SSH[@]}" -o BatchMode=yes -o ConnectTimeout=15 "$SERVER" 'true' 2>/dev/null; then
  echo "!! 连不上 ${SERVER}。请确认：IP 正确、安全组放行 22、已用 SSH_KEY=私钥路径 指定登录密钥（或已配好免密）。" >&2
  exit 1
fi
if ! "${SSH[@]}" "$SERVER" 'command -v docker >/dev/null 2>&1'; then
  echo "!! 服务器上还没有 Docker。先执行: bash scripts/provision-server.sh $SERVER" >&2
  exit 1
fi

echo "==> [2/5] 打包源代码（不含数据与依赖）..."
tar -czf /tmp/workbench-deploy.tgz \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=data \
  --exclude=test-results \
  --exclude=playwright-report \
  --exclude=.git \
  --exclude=android \
  .

echo "==> [3/5] 上传到 ${SERVER}:${REMOTE_DIR} ..."
"${SSH[@]}" "$SERVER" "mkdir -p ${REMOTE_DIR}"
"${SCP[@]}" -q /tmp/workbench-deploy.tgz "$SERVER:/tmp/workbench-deploy.tgz"
"${SSH[@]}" "$SERVER" "tar -xzf /tmp/workbench-deploy.tgz -C ${REMOTE_DIR} && rm /tmp/workbench-deploy.tgz"
rm /tmp/workbench-deploy.tgz

# 快照必须在重新构建之前：迁移是容器启动时自动跑的，一旦写坏，
# 最近的回滚点就只剩最多 24 小时前的那份定时备份，中间一天的单据全丢。
echo "==> [4/5] 部署前给线上数据库拍快照..."
RUNNING="$("${SSH[@]}" -o BatchMode=yes "$SERVER" "cd ${REMOTE_DIR} && docker compose ps --status running -q workbench 2>/dev/null | head -1" || true)"
if [ -z "$RUNNING" ]; then
  echo "    线上没有运行中的容器（首次部署），无数据可快照，跳过。"
elif "${SSH[@]}" -o BatchMode=yes "$SERVER" "cd ${REMOTE_DIR} && cp scripts/pre-deploy-snapshot.mjs data/.deploy-snapshot.mjs && docker compose exec -T workbench node /data/.deploy-snapshot.mjs; rc=\$?; rm -f data/.deploy-snapshot.mjs; exit \$rc"; then
  echo "    快照已落地在 data/backups/部署前快照-*.sqlite（保留最近 10 份）。"
  echo "    如需回滚：docker compose stop workbench → 用快照覆盖 data/workbench.sqlite 并删掉同目录的 -wal/-shm → docker compose up -d"
else
  echo "!! 部署前快照失败，已中止部署：线上仍是上一版在运行，数据未被改动。" >&2
  echo "   先查原因（磁盘满 / 数据库被占用 / 镜像里没有 node:sqlite），修好再重跑本脚本。" >&2
  exit 1
fi

echo "==> [5/5] 在服务器上构建并启动..."
# 部署包里没有 .git，把本机当前 commit 通过 .env 传进去，线上 /health 才能看出跑的是哪一版
GIT_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo '')"
if [ -n "$DOMAIN" ]; then
  # 两个约束同时成立才行：
  #   1) Caddyfile 里多个站点名必须是 `a.com, b.com`（逗号后要空格，否则 Caddy 报错）；
  #   2) .env 会被远端用 bash source 一次，裸空格会让 bash 把第二个域名当成命令执行。
  # 所以这里统一规范化成「逗号+空格」，写进 .env 时再整体加单引号 —— bash 与 docker compose
  # 都认带引号的值，compose 会把引号剥掉再传给 Caddy。
  # 逗号列表统一成「逗号+空格」。注意两点坑：
  #   1) 不能用 tr -d '[:space:]'：它是流式删除，会把上一行拆分出的换行一起删掉，
  #      两行直接粘成 a.comb.com —— 静默出错，比报错还难查；只删空格与制表符即可。
  #   2) 不用 paste -sd', '：Git Bash 上多字符分隔符会被吃掉。
  DOMAIN_VALUE="$(printf '%s' "$DOMAIN" | tr ',' '\n' | tr -d ' \t' | sed '/^$/d' | tr '\n' ',' | sed 's/,/, /g; s/, *$//')"
  # 走 Caddy 反向代理，才需要信任 X-Forwarded-*；WORKBENCH_ENV 显式写 production，线上不显示测试横条。
  # WORKBENCH_PUBLIC_PORT 写成 127.0.0.1:52341：域名模式下应用只需要被 Caddy 通过 compose 内网访问，
  # 不必再对公网发布一个端口（值里不能有空格，否则远端 source .env 会报 command not found）。
  "${SSH[@]}" "$SERVER" "cd ${REMOTE_DIR} && printf \"WORKBENCH_DOMAIN='%s'\nWORKBENCH_TRUST_PROXY=1\nWORKBENCH_PUBLIC_PORT=127.0.0.1:52341\nWORKBENCH_ENV=production\nWORKBENCH_GIT_COMMIT=%s\n\" '${DOMAIN_VALUE}' '${GIT_COMMIT}' > .env && bash deploy/remote-deploy.sh"
  echo ""
  echo "==> 完成。首次访问 https://$(printf '%s' "$DOMAIN_VALUE" | cut -d, -f1) 时，页面会引导你创建管理员账号。"
else
  "${SSH[@]}" "$SERVER" "cd ${REMOTE_DIR} && printf 'WORKBENCH_ENV=production\nWORKBENCH_GIT_COMMIT=%s\n' '${GIT_COMMIT}' > .env && bash deploy/remote-deploy.sh"
  echo ""
  echo "==> 完成。访问 http://<服务器IP>:52341 ，首次进入会引导创建管理员账号。"
  echo "    记得先在阿里云轻量控制台的「防火墙」里放行 52341/tcp。"
fi
