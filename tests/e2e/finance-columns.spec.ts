import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

test('财务分组表头、列设置保存与恢复默认', async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 900 });
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '财务', exact: true }).click();

  const groups = page.locator('.finance-table-groups th');
  await expect(groups).toHaveCount(5);
  for (const label of ['基础', '金额', '进度', '履约', '操作']) {
    await expect(page.locator('.finance-table-groups th', { hasText: label })).toBeVisible();
  }

  await page.locator('.finance-columns-button').click();
  const panel = page.getByRole('dialog', { name: '列设置' });
  await expect(panel).toBeVisible();
  await panel.locator('label', { hasText: '客户' }).locator('input').uncheck();
  await page.keyboard.press('Escape');

  const customerHeader = page.locator('.finance-column-head th', { hasText: '客户' });
  await expect(customerHeader).toBeHidden();
  await expect(page.locator('.finance-group-basic')).toHaveAttribute('colspan', '3');

  await page.reload();
  await page.locator('.sidebar-nav').getByRole('button', { name: '财务', exact: true }).click();
  await expect(page.locator('.finance-column-head th', { hasText: '客户' })).toBeHidden();

  await page.locator('.finance-columns-button').click();
  await page.getByRole('button', { name: '恢复默认' }).click();
  await expect(page.locator('.finance-column-head th', { hasText: '客户' })).toBeVisible();
  await expect(page.locator('.finance-group-basic')).toHaveAttribute('colspan', '4');
});

test('财务手机端不显示分组表头与列设置按钮', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '更多模块' }).click();
  await page.locator('.sidebar-nav').getByRole('button', { name: '财务', exact: true }).click();
  await expect(page.locator('.finance-columns-button')).toBeHidden();
  await expect(page.locator('.finance-table-desktop')).toBeHidden();
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
