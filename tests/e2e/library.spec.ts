import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

const stamp = Date.now();
const PDF = Buffer.from(`%PDF-1.4\n% library-e2e-${stamp}\n%%EOF`);

test('资料库：上传标贴 → 搜索/编辑 → 回收站恢复 → 彻底删除', async ({ page }) => {
  test.setTimeout(90_000);
  const customerName = `E2E资料客户${stamp}`;
  const createdCustomer = await page.request.post('/api/customers', {
    data: { name: customerName, contactName: '陈经理', contactPhone: '13800001234', shippingInfo: '广东省深圳市宝安区' },
  });
  expect(createdCustomer.ok()).toBe(true);
  const customer = (await createdCustomer.json()).data as { id: number };
  const fileName = `E2E客户标贴-${stamp}.pdf`;
  const title = `E2E资料标贴-${stamp}`;
  page.on('dialog', (dialog) => { void dialog.accept(); });

  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '资料库', exact: true }).click();
    await expect(page.locator('.library-page')).toBeVisible();
    await expect(page.getByRole('button', { name: '上传资料' })).toBeVisible();

    await page.getByRole('button', { name: '上传资料' }).click();
    const uploadDialog = page.getByRole('dialog', { name: '上传资料' });
    await expect(uploadDialog).toBeVisible();
    await uploadDialog.locator('input[type=file][aria-label="选择资料文件"]').setInputFiles({ name: fileName, mimeType: 'application/pdf', buffer: PDF });
    await uploadDialog.locator('label', { hasText: '分类' }).locator('select').selectOption('label');
    await uploadDialog.locator('input[aria-label="客户"]').fill(customerName);
    await uploadDialog.locator('[role="option"]').filter({ hasText: customerName }).first().click();
    await uploadDialog.locator('.library-pending-row .input').fill(title);
    await uploadDialog.getByRole('button', { name: /上传（1）/ }).click();
    await expect(uploadDialog).toBeHidden({ timeout: 15_000 });

    const row = page.locator('.library-table tbody tr', { hasText: title });
    await expect(row).toBeVisible();
    await expect(row).toContainText(customerName);
    await expect(row).toContainText('客户标贴');

    // 搜索
    await page.locator('.library-toolbar .search-control input').fill(title);
    await expect(page.locator('.library-table tbody tr', { hasText: title })).toHaveCount(1);

    // 编辑名称
    await row.locator('button[title="编辑信息"]').click();
    const editDialog = page.getByRole('dialog', { name: /编辑资料/ });
    await expect(editDialog).toBeVisible();
    const renamed = `${title}-改名`;
    await editDialog.locator('label', { hasText: '资料名称' }).locator('input').fill(renamed);
    await editDialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editDialog).toBeHidden();
    await expect(page.locator('.library-table tbody tr', { hasText: renamed })).toBeVisible();

    // 移入回收站 → 恢复
    await page.locator('.library-toolbar .search-control input').fill('');
    const renamedRow = page.locator('.library-table tbody tr', { hasText: renamed });
    await renamedRow.locator('button[title="移入回收站"]').click();
    await expect(page.locator('.library-table tbody tr', { hasText: renamed })).toHaveCount(0);
    await page.getByRole('button', { name: '回收站', exact: true }).click();
    const trashRow = page.locator('.library-table tbody tr', { hasText: renamed });
    await expect(trashRow).toBeVisible();
    await trashRow.locator('button[title="恢复"]').click();
    await expect(page.locator('.library-table tbody tr', { hasText: renamed })).toHaveCount(0);
    await page.getByRole('button', { name: '返回资料库' }).click();
    await page.locator('.library-toolbar .search-control input').fill(renamed);
    await expect(page.locator('.library-table tbody tr', { hasText: renamed })).toBeVisible();

    // 再删一次并彻底删除
    await page.locator('.library-table tbody tr', { hasText: renamed }).locator('button[title="移入回收站"]').click();
    await page.getByRole('button', { name: '回收站', exact: true }).click();
    await page.locator('.library-table tbody tr', { hasText: renamed }).locator('button[title="彻底删除"]').click();
    await expect(page.locator('.library-table tbody tr', { hasText: renamed })).toHaveCount(0);
  } finally {
    const list = await page.request.get('/api/library?trash=1&pageSize=500');
    if (list.ok()) {
      const items = ((await list.json()).data as { items: Array<{ id: number; title: string }> }).items;
      for (const item of items.filter((entry) => entry.title.startsWith('E2E资料标贴-'))) {
        await page.request.delete(`/api/library/${item.id}/purge`);
      }
    }
    await page.request.delete(`/api/customers/${customer.id}`);
  }
});
