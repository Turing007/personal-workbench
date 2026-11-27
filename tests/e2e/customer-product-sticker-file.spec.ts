import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');

async function openCustomerProducts(page: Page, customerName: string) {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '客户', exact: true }).click();
  await page.locator('.customer-list-panel .customer-list-item', { hasText: customerName }).first().click();
  await expect(page.locator('.customer-products-panel')).toBeVisible();
}

test('新建客户产品可直接启用贴标并引用最新标贴附件', async ({ page }) => {
  const stamp = Date.now();
  const customerName = `E2E贴标客户${stamp}`;
  const productName = `E2E贴标产品${stamp}`;
  const firstLabel = `标贴-初版-${stamp}.pdf`;
  const secondLabel = `标贴-新版-${stamp}.pdf`;
  const created = await page.request.post('/api/customers', {
    data: { name: customerName, contactName: '张三', contactPhone: '13900000009', shippingInfo: '杭州市西湖区' },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const customer = (await created.json()).data as { id: number };

  try {
    await openCustomerProducts(page, customerName);
    await page.getByRole('button', { name: '添加客户产品' }).click();
    const editor = page.getByRole('dialog');
    await expect(editor).toBeVisible();
    await editor.getByLabel('品名', { exact: true }).fill(productName);

    await editor.locator('.attachment-drop-section input[type="file"]').setInputFiles({ name: firstLabel, mimeType: 'application/pdf', buffer: PDF });
    await editor.getByLabel(`${firstLabel}附件类型`).selectOption('label');
    await editor.getByRole('checkbox', { name: '该产品需要贴标' }).check();
    await editor.getByLabel('每张标贴数量').fill('20');

    // 保存前就应看到将使用的标贴附件
    await expect(editor.getByRole('link', { name: firstLabel })).toBeVisible();
    await expect(editor.getByText('保存后生效')).toBeVisible();

    await editor.getByRole('button', { name: '保存产品' }).click();
    await expect(editor).toBeHidden({ timeout: 15000 });

    const row = page.locator('.customer-products-table-desktop tbody tr', { hasText: productName }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `管理标贴库存：${productName}` }).click();
    const stickerDialog = page.getByRole('dialog', { name: /标贴管理/ });
    await expect(stickerDialog.getByRole('checkbox', { name: '该产品需要贴标' })).toBeChecked();
    await expect(stickerDialog.getByLabel('每张标贴数量')).toHaveValue('20');
    await expect(stickerDialog.getByRole('link', { name: firstLabel })).toBeVisible();
    await expect(stickerDialog.getByText('保存后生效')).toHaveCount(0);
    await stickerDialog.locator('.modal-close').click();
    await expect(stickerDialog).toBeHidden();

    // 附件中再传一版标贴 PDF，标贴管理自动改用最新文件
    await row.getByRole('button', { name: `管理附件：${productName}` }).click();
    const attachmentDialog = page.getByRole('dialog', { name: /附件 ·/ });
    await attachmentDialog.getByLabel('附件类型').selectOption('label');
    await attachmentDialog.locator('input[type="file"]').setInputFiles({ name: secondLabel, mimeType: 'application/pdf', buffer: PDF });
    await expect(attachmentDialog.getByRole('link', { name: secondLabel })).toBeVisible();
    await attachmentDialog.locator('.modal-close').click();
    await expect(attachmentDialog).toBeHidden();
    await expect(row.getByRole('button', { name: `管理附件：${productName}` })).toHaveText('2 个');

    await row.getByRole('button', { name: `管理标贴库存：${productName}` }).click();
    const stickerDialogAgain = page.getByRole('dialog', { name: /标贴管理/ });
    await expect(stickerDialogAgain.getByRole('link', { name: secondLabel })).toBeVisible();
    await expect(stickerDialogAgain.getByRole('link', { name: firstLabel })).toHaveCount(0);
    await stickerDialogAgain.locator('.modal-close').click();
  } finally {
    await page.request.delete(`/api/customers/${customer.id}`);
  }
});
