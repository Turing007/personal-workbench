# 构建：多阶段构建，最终镜像只包含生产依赖与编译产物。
# 要求 Node 22+（项目使用内置 node:sqlite）；基座用 Debian slim —— sharp（缩略图）的
# 预编译二进制在 glibc 环境下最稳，alpine(musl) 容易踩坑。
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src ./src
# npm run build 末尾要执行它生成 dist/build-info.json；镜像里没有 .git，
# commit 号由构建参数 WORKBENCH_GIT_COMMIT 从外部传进来。
COPY scripts/write-build-info.mjs ./scripts/
ARG WORKBENCH_GIT_COMMIT=
ENV WORKBENCH_GIT_COMMIT=${WORKBENCH_GIT_COMMIT}
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    WORKBENCH_HOST=0.0.0.0 \
    WORKBENCH_PORT=52341 \
    WORKBENCH_ENV=production \
    WORKBENCH_DATA_DIR=/data \
    WORKBENCH_TRUST_PROXY=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# PDF 导出（产品图册 / 报价单 / 销售单 / 购销合同）全部由 Playwright 渲染，镜像必须自带浏览器。
# 几个必须踩的点：
#  1) playwright 包不再随 npm 安装自动下载浏览器，必须显式 install；
#  2) 运行时镜像里没有 .bin/playwright，只能直接 node 调 cli.js；
#  3) --with-deps 顺带补齐 Chromium 依赖的系统库（slim 基座没有）；
#  4) apt 默认的 deb.debian.org 从北京实测只有 ~17KB/s、阿里云公网镜像当天也只有 ~25KB/s，
#     换清华 TUNA（实测 ~76MB/s，且公网可达，不像 mirrors.cloud.aliyuncs.com 只限 ECS 内网）；
#  5) 中文字体单独装：图册与单据模板全是中文，缺字体 Chromium 渲染出来是方块。
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
  && node node_modules/playwright/cli.js install --with-deps chromium \
  && apt-get install -y --no-install-recommends fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/dist ./dist
VOLUME /data
EXPOSE 52341
# 用 Node 自带的 fetch 做健康检查，避免额外安装 curl/wget。
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.WORKBENCH_PORT || 52341) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server/main.js"]
