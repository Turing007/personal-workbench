import { defineConfig } from '@playwright/test';

// e2e 使用独立的数据目录与端口，避免读写真实工作台数据；
// 数据库为空时由 spec 里的 beforeAll 自动初始化管理员并登录。
export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://127.0.0.1:52399',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run start',
    url: 'http://127.0.0.1:52399/health',
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      WORKBENCH_PORT: '52399',
      WORKBENCH_DATA_DIR: './test-results/e2e-workbench-data',
    },
  },
});
