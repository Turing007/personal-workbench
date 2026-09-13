# 构建：多阶段构建，最终镜像只包含生产依赖与编译产物。
# 要求 Node 22+（项目使用内置 node:sqlite）。
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production \
    WORKBENCH_HOST=0.0.0.0 \
    WORKBENCH_PORT=52341 \
    WORKBENCH_DATA_DIR=/data \
    WORKBENCH_TRUST_PROXY=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
VOLUME /data
EXPOSE 52341
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${WORKBENCH_PORT}/health" >/dev/null 2>&1 || exit 1
CMD ["node", "dist/server/main.js"]
