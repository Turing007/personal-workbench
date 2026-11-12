import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

test('工作台：默认落地、待办、快捷新建和跳到待审核水单', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('工作台', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.dashboard-metrics > div')).toHaveCount(4);
  await expect(page.locator('.dashboard-task')).toHaveCount(7);

  await page.getByRole('button', { name: '新建订单' }).click();
  const orderDialog = page.getByRole('dialog', { name: '新建订单' });
  await expect(orderDialog).toBeVisible();
  await orderDialog.getByRole('button', { name: '取消' }).click();

  await page.locator('.sidebar-nav').getByRole('button', { name: '工作台', exact: true }).click();
  await page.getByRole('button', { name: '新建报价' }).click();
  const quoteDialog = page.getByRole('dialog', { name: /新建报价单/ });
  await expect(quoteDialog).toBeVisible();
  await quoteDialog.getByRole('button', { name: '取消' }).click();

  await page.locator('.sidebar-nav').getByRole('button', { name: '工作台', exact: true }).click();
  await page.getByRole('button', { name: '新建产品' }).click();
  const productDialog = page.getByRole('dialog', { name: '添加产品' });
  await expect(productDialog).toBeVisible();
  await productDialog.getByRole('button', { name: '关闭' }).click();

  await page.locator('.sidebar-nav').getByRole('button', { name: '工作台', exact: true }).click();
  await page.locator('.dashboard-task', { hasText: '待审核水单' }).click();
  await expect(page.getByText('水单收款', { exact: true })).toBeVisible();
  await expect(page.getByLabel('水单状态')).toHaveValue('pending');
});

test('工作台手机端不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.dashboard-metrics')).toBeVisible();
  await expect(page.locator('.dashboard-task')).toHaveCount(7);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
