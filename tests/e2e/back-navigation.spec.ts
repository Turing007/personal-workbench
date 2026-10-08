import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

/**
 * 浏览器后退 = 安卓壳返回键走的是同一条路（壳里 canGoBack → goBack）。
 * 这里用 page.goBack() 复现手机返回键：必须先关弹窗/抽屉，再逐格回上一级菜单，
 * 而不是一点就离开当前页面（App 里表现为直接收起应用）。
 */
test.describe('返回键逐级返回', () => {
  test('切换模块后，返回键回到上一级菜单而不是退出', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.orders-page')).toBeVisible();

    await page.getByRole('button', { name: '财务', exact: true }).click();
    await expect(page.locator('.finance-page')).toBeVisible();

    await page.goBack();
    await expect(page.locator('.orders-page')).toBeVisible();
    await expect(page.locator('.finance-page')).toHaveCount(0);
  });

  test('弹窗打开时，返回键先关弹窗、页面不动', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '新建订单' }).click();
    const dialog = page.getByRole('dialog', { name: '新建订单' });
    await expect(dialog).toBeVisible();

    await page.goBack();
    await expect(dialog).toHaveCount(0);
    // 关弹窗不算页面跳转：还停在订单页。
    await expect(page.locator('.orders-page')).toBeVisible();
  });
});

test.describe('返回键逐级返回（手机端）', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('「更多」抽屉打开时，返回键先关抽屉', async ({ page, context }) => {
    await page.goto('/');
    const client = await context.newCDPSession(page);
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toHaveClass(/is-mobile-open/);

    await page.goBack();
    await expect(sidebar).not.toHaveClass(/is-mobile-open/);
    // 关抽屉同样不算页面跳转。
    await expect(page.locator('.orders-page')).toBeVisible();
  });
});
