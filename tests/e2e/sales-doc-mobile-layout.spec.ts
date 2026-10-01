import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

test.describe('销售单抬头在窄屏不挤爆', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('手机端：抬头上限两列，开单日期完整可读', async ({ page }) => {
    await page.goto('/');
    await page.locator('.mobile-tabbar button', { hasText: '更多' }).first().click();
    await page.getByRole('button', { name: '销售单', exact: true }).last().click();
    await page.getByRole('button', { name: '新建销售单' }).first().click();
    await page.waitForSelector('.modal-panel', { timeout: 15000 });

    // 原先写死四列，日期框只剩 ~85px，值被截成「2026/0」，标签也折行
    const columns = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.sales-doc-fields.is-four')!).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(2);

    const dateInput = page.locator('.sales-doc-fields.is-four input[type="date"]').first();
    const truncated = await dateInput.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(truncated).toBe(false);
  });

  test('桌面端仍是四列', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: '销售单', exact: true }).click();
    await page.getByRole('button', { name: '新建销售单' }).first().click();
    await page.waitForSelector('.modal-panel', { timeout: 15000 });
    const columns = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.sales-doc-fields.is-four')!).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(4);
  });
});

test.describe('App 网络区块', () => {
  test('已保存的网络可以删除，删完列表立即更新', async ({ page }) => {
    // 原生壳注入的桥接对象在浏览器里不存在，这里按 AppBridge 的契约造一个假壳。
    await page.addInitScript(() => {
      const networks = [
        { label: '本地测试 · 局域网', url: 'http://192.168.1.10:52342', active: true },
        { label: '线上 · 隧道', url: 'http://101.200.149.84:52341', active: false },
      ];
      (window as unknown as { workbenchApp: unknown }).workbenchApp = {
        getNetworks: () => JSON.stringify(networks),
        switchNetwork: () => undefined,
        openAddressEditor: () => undefined,
        removeNetwork: (url: string) => {
          const index = networks.findIndex((item) => item.url === url);
          if (index >= 0) networks.splice(index, 1); // 删完要能反映到下一次 getNetworks，页面才刷新得出来
        },
      };
    });
    page.on('dialog', (dialog) => void dialog.accept()); // 删除要过一道 confirm

    await page.goto('/');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '手机连接', exact: true }).click();
    await expect(page.locator('.app-network-item')).toHaveCount(2);

    await page.locator('.app-network-item').nth(1).locator('.app-network-remove').click();
    await expect(page.locator('.app-network-item')).toHaveCount(1);
    await expect(page.locator('.app-network-item').first()).toContainText('本地测试');
  });
});
