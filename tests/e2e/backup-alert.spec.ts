import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

/**
 * 自动备份失败必须显眼：原先只有设置页里一行小字，备份停摆可能几周都没人发现。
 */
let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context, page }) => {
  await injectSession(context, sessionCookie);
  // 生产构建注册了 service worker，/api/ GET 由它代发，而 SW 发出的请求不吃 page.route，
  // 所以这条用例里先禁掉 SW，让状态接口的 mock 真正生效。
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serviceWorker', { value: { register: () => Promise.reject(new Error('SW disabled for test')) } });
  });
});

const failedStatus = {
  ok: true,
  data: {
    enabled: true,
    running: false,
    todayDone: false,
    lastBackupAt: '2026-09-29T03:04:00.000Z',
    lastResult: 'failed',
    lastError: 'ENOSPC: no space left on device, write',
    keepCount: 2,
    directory: 'D:\\个人工作台备份',
    files: [],
  },
};

test('备份失败时顶部出现常驻横幅，可跳转设置也可确认关闭', async ({ page }) => {
  await page.route('**/api/backups/auto/status', (route) => route.fulfill({ json: failedStatus }));
  await page.goto('/');

  const banner = page.locator('.backup-alert');
  // 横幅依赖首屏加载完成后发出的那次状态请求，机器忙时首屏可超过默认 5s 断言窗口。
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).toContainText('自动备份失败');
  await expect(banner).toContainText('no space left on device');

  await banner.getByRole('button', { name: '知道了' }).click();
  await expect(banner).toHaveCount(0);
});

test('备份正常时不打扰', async ({ page }) => {
  await page.route('**/api/backups/auto/status', (route) => route.fulfill({
    json: { ...failedStatus, data: { ...failedStatus.data, todayDone: true, lastResult: 'success', lastError: null } },
  }));
  await page.goto('/');
  await expect(page.locator('.app-content')).toBeVisible();
  await expect(page.locator('.backup-alert')).toHaveCount(0);
});
