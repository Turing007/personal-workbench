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
COPY --from=build /app/dist ./dist
VOLUME /data
EXPOSE 52341
# 用 Node 自带的 fetch 做健康检查，避免额外安装 curl/wget。
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.WORKBENCH_PORT || 52341) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server/main.js"]
