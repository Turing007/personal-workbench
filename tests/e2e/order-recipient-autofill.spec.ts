import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

test('订单编辑：收件信息自动提取收件人名称，手改后不再覆盖', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
  await page.getByRole('button', { name: '新建订单' }).click();
  const dialog = page.getByRole('dialog', { name: '新建订单' });
  await expect(dialog).toBeVisible();

  const name = dialog.locator('label', { hasText: '收件人名称' }).locator('input');
  const info = dialog.locator('label', { hasText: '收件信息' }).locator('textarea');

  await info.fill('收件人：张三 13800000000 广东省深圳市宝安区演示路 88 号');
  await expect(name).toHaveValue('张三');

  // 手动改过姓名后，再改收件信息不能覆盖。
  await name.fill('王五');
  await info.fill('李四 13900000000 上海市浦东新区');
  await expect(name).toHaveValue('王五');

  // 清空姓名后又回到自动提取。
  await name.fill('');
  await info.fill('赵六 13700000000 浙江省义乌市');
  await expect(name).toHaveValue('赵六');

  await dialog.locator('.modal-close').click();
  await expect(dialog).toHaveCount(0);
});
