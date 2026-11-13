import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

test('订单左侧筛选：多选状态、保存常用视图、应用和收起', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
  const main = page.locator('.filter-rail-main');
  const beforeOpen = await main.boundingBox();
  await page.getByRole('button', { name: '展开筛选' }).click();
  const rail = page.locator('.filter-rail');
  await expect(rail).toBeVisible();
  // 展开后的筛选栏浮在内容上方，主区域宽度和左缘不变。
  const afterOpen = await main.boundingBox();
  expect(afterOpen?.width).toBe(beforeOpen?.width);
  expect(afterOpen?.x).toBe(beforeOpen?.x);

  const pendingStock = rail.locator('label', { hasText: '待备货' }).locator('input');
  await pendingStock.check();
  await expect(pendingStock).toBeChecked();

  page.once('dialog', (dialog) => dialog.accept('E2E待备货'));
  await rail.getByRole('button', { name: '保存当前筛选' }).click();
  const views = rail.getByLabel('常用视图');
  await expect(views.locator('option', { hasText: 'E2E待备货' })).toHaveCount(1);
  await views.selectOption({ label: 'E2E待备货' });

  await rail.locator('label', { hasText: '已发货' }).locator('input').check();
  await expect(rail.getByText('已修改')).toBeVisible();
  await rail.getByRole('button', { name: '更新当前视图' }).click();
  await expect(rail.getByText('已修改')).toHaveCount(0);

  await rail.getByRole('button', { name: '重置全部筛选' }).click();
  await expect(pendingStock).not.toBeChecked();

  await rail.getByRole('button', { name: '收起筛选' }).click();
  await expect(page.locator('.filter-rail')).toHaveCount(0);
  await page.getByRole('button', { name: '展开筛选' }).click();
  await expect(page.locator('.filter-rail')).toBeVisible();
});

test('订单左侧筛选手机端不显示', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '更多模块' }).click();
  await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
  await expect(page.locator('.filter-rail')).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
