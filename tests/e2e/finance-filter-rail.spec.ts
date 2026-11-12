import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

test('财务左侧筛选：多选状态、保存和应用常用视图', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '财务', exact: true }).click();
  const rail = page.locator('.filter-rail');
  await expect(rail).toBeVisible();

  const paid = rail.locator('label', { hasText: '已付款' }).locator('input');
  const unpaid = rail.locator('label', { hasText: '未付款' }).locator('input');
  await paid.check();
  await unpaid.check();
  await expect(paid).toBeChecked();
  await expect(unpaid).toBeChecked();

  page.once('dialog', (dialog) => dialog.accept('E2E财务待处理'));
  await rail.getByRole('button', { name: '保存当前筛选' }).click();
  const views = rail.getByLabel('常用视图');
  await expect(views.locator('option', { hasText: 'E2E财务待处理' })).toHaveCount(1);
  await views.selectOption({ label: 'E2E财务待处理' });

  // 视图应用后再改筛选 → 提示「已修改」→ 更新回视图。
  await rail.locator('label', { hasText: '有驳回' }).locator('input').check();
  await expect(rail.getByText('已修改')).toBeVisible();
  await rail.getByRole('button', { name: '更新当前视图' }).click();
  await expect(rail.getByText('已修改')).toHaveCount(0);

  await rail.getByRole('button', { name: '重置全部筛选' }).click();
  await expect(paid).not.toBeChecked();
  await expect(unpaid).not.toBeChecked();
  await expect(rail.getByText('已修改')).toHaveCount(0);
});

test('水单左侧筛选：状态多选、保存视图，手机端回落下拉', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '水单', exact: true }).click();
  const rail = page.locator('.filter-rail');
  await expect(rail).toBeVisible();

  const pending = rail.locator('label', { hasText: '待确认' }).locator('input');
  await pending.check();
  await expect(pending).toBeChecked();

  page.once('dialog', (dialog) => dialog.accept('E2E水单待确认'));
  await rail.getByRole('button', { name: '保存当前筛选' }).click();
  await expect(rail.getByLabel('常用视图').locator('option', { hasText: 'E2E水单待确认' })).toHaveCount(1);

  await rail.getByRole('button', { name: '重置全部筛选' }).click();
  await expect(pending).not.toBeChecked();
  await expect(rail.getByText('已修改')).toHaveCount(0);

  // 手机端不显示筛选栏，继续使用工具条下拉，且不横向溢出。
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.filter-rail')).toBeHidden();
  await expect(page.getByLabel('水单状态')).toBeVisible();
  await expect(page.getByLabel('公司筛选')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
