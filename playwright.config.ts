import { defineConfig } from '@playwright/test';

// E2E 使用独立端口与隔离数据目录：不复用本机正在运行的生产实例，
// 也不受真实实例访问密码/存量数据影响，测试数据不再写入真实数据库。
const e2ePort = 52399;
// 视觉验收可切到独立数据目录，避免演示数据污染常规 e2e。
const e2eDataDir = process.env.WORKBENCH_E2E_DATA_DIR ?? 'node_modules/.tmp/e2e-data';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: `http://127.0.0.1:${e2ePort}`,
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run start',
    url: `http://127.0.0.1:${e2ePort}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      WORKBENCH_PORT: String(e2ePort),
      WORKBENCH_DATA_DIR: e2eDataDir,
    },
  },
});
