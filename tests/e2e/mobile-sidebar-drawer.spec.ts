import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

const readBodyOverflow = (page: { evaluate: <T>(fn: () => T) => Promise<T> }) =>
  page.evaluate(() => document.body.style.overflow);

/**
 * 手机端抽屉是 position: fixed，底下的页面仍在文档流里。
 * 之前打开抽屉没有锁 body，手指在抽屉或遮罩上滑动会连带滚动底下的页面，
 * 关掉抽屉后位置已经跑偏；这里钉住「打开锁、关闭还原」这条不变量。
 */
test('手机端主导航抽屉：打开时锁住背景滚动，关闭后恢复', async ({ page }) => {
  await page.goto('/');

  expect(await readBodyOverflow(page)).toBe('');

  await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
  const drawer = page.locator('.sidebar');
  await expect(drawer).toHaveClass(/is-mobile-open/);
  await expect(drawer).toBeVisible();
  expect(await readBodyOverflow(page)).toBe('hidden');

  // 关掉抽屉的第一条路径：点遮罩。遮罩铺满全屏，而抽屉压在它的左半边上面，
  // 所以必须点在抽屉右侧的空档，直接 click() 会落在被抽屉盖住的位置上。
  await page.locator('.sidebar-backdrop').click({ position: { x: 370, y: 300 } });
  await expect(drawer).not.toHaveClass(/is-mobile-open/);
  await expect.poll(() => readBodyOverflow(page)).toBe('');

  // 关掉抽屉的第二条路径：点条目跳转后抽屉自动收起，且不能把 body 锁留在原地，
  // 否则跳过去的页面在真机上会整个滑不动。
  await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
  await expect(drawer).toHaveClass(/is-mobile-open/);
  await page.locator('.sidebar-nav').getByRole('button', { name: '订单管理', exact: true }).click();
  await expect(page.locator('.orders-page')).toBeVisible();
  await expect(drawer).not.toHaveClass(/is-mobile-open/);
  await expect.poll(() => readBodyOverflow(page)).toBe('');
});
