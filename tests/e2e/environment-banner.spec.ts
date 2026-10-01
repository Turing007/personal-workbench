import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

/**
 * 本机测试实例与线上只差一个端口，认错就是拿错库录数据，所以测试端必须有常驻标识。
 * 判定完全来自服务端 /health 的 environment 字段，这里把两个分支都验一遍。
 */
let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

// 生产构建注册了 service worker，/health 可能被它代发，而 SW 发出的请求不吃 page.route，
// 所以这里先禁掉 SW，让下面的 mock 真正生效。
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serviceWorker', { value: { register: () => Promise.reject(new Error('SW disabled for test')) } });
  });
});

test.describe('测试环境标识', () => {
  test('测试实例：横条常驻，且不会把页面顶出纵向滚动', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.environment-banner')).toBeVisible();
    await expect(page.locator('.environment-banner')).toHaveText(/测试环境/);

    // 横条用固定定位 + 外壳 padding 让位，全高容器都扣掉了 --env-banner-h；
    // 只要漏掉一处，登录页就会多出 26px 的滚动条。
    const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('登录后工作台内同样可见，设置里写明当前环境', async ({ page, context }) => {
    await injectSession(context, sessionCookie);
    await page.goto('/');
    await expect(page.locator('.environment-banner')).toBeVisible();

    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '运行环境', exact: true }).click();
    await expect(page.locator('.setting-row', { hasText: '当前环境' })).toContainText('测试');
  });

  test('服务端报 production 时不显示任何标识', async ({ page }) => {
    await page.route('**/health', async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      json.data.environment = 'production';
      await route.fulfill({ response, json });
    });

    await page.goto('/');
    await expect(page.locator('.auth-card')).toBeVisible();
    await expect(page.locator('.environment-banner')).toHaveCount(0);
    await expect(page.locator('.environment-shell.is-test')).toHaveCount(0);
  });
});
