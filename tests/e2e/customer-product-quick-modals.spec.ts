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

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function seedProduct(page: Page, stamp: number) {
  const customerName = `E2E快捷${stamp}`;
  const customer = await (await page.request.post('/api/customers', {
    data: { name: customerName, contactName: '王五', contactPhone: '13900000003' },
  })).json();
  const productName = `E2E快捷产品${stamp}`;
  const created = await page.request.post(`/api/customers/${customer.data.id}/products`, {
    data: { name: productName, sku: `QA-${stamp}`, packCount: 10, finalPriceCents: 8800, finalPriceIncludesTax: 'exc', costPriceCents: 5000, costConfirmed: true },
  });
  expect(created.ok()).toBeTruthy();
  return { customerId: Number(customer.data.id), customerName, productName };
}

async function openCustomer(page: Page, customerName: string) {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '客户', exact: true }).click();
  await page.locator('.customer-list-panel .customer-list-item', { hasText: customerName }).first().click();
}

test('桌面端：标贴开关/每张数量即时保存，备注文字和图片、附件都可弹窗处理', async ({ page }) => {
  const stamp = Date.now();
  const { customerId, customerName, productName } = await seedProduct(page, stamp);
  try {
    await openCustomer(page, customerName);
    const row = page.locator('.customer-products-table-desktop tbody tr', { hasText: productName }).first();

    // 含税口径是金额上方的小胶囊，不跟金额挤在一行。
    const priceStack = row.locator('.customer-price-stack');
    await expect(priceStack.locator('.customer-tax-tag.is-exc')).toHaveText('不含税');
    const tagBox = await priceStack.locator('.customer-tax-tag').boundingBox();
    const amountBox = await priceStack.locator('span').last().boundingBox();
    expect(tagBox && amountBox && tagBox.y + tagBox.height <= amountBox.y + 1).toBe(true);

    // 标贴：未开启也能点开管理，开启 + 改每张数量 + 打印入库
    await row.getByRole('button', { name: `管理标贴库存：${productName}` }).click();
    const stickerDialog = page.getByRole('dialog', { name: /标贴管理/ });
    await expect(stickerDialog).toBeVisible();
    const enableResponse = page.waitForResponse((response) => response.url().includes('/sticker-settings') && response.request().method() === 'PATCH');
    await stickerDialog.getByLabel('该产品需要贴标').check();
    await enableResponse;
    const perSheetResponse = page.waitForResponse((response) => response.url().includes('/sticker-settings') && response.request().method() === 'PATCH');
    await stickerDialog.getByLabel('每张标贴数量').fill('5');
    await perSheetResponse;
    await stickerDialog.getByLabel('打印入库（张）').fill('2');
    const ledgerResponse = page.waitForResponse((response) => response.url().includes('/sticker/transactions'));
    await stickerDialog.getByRole('button', { name: '登记入库' }).click();
    await ledgerResponse;
    await expect(stickerDialog.locator('.cpe-sticker-stock strong')).toHaveText('10');
    await stickerDialog.locator(".modal-close").click();
    await expect(stickerDialog).toBeHidden();
    await expect(row.getByRole('button', { name: `管理标贴库存：${productName}` })).toContainText('10');

    // 备注：文字 + 直接选图上传；备注图片不计入附件数量
    await row.getByRole('button', { name: `编辑备注：${productName}` }).click();
    const remarkDialog = page.getByRole('dialog', { name: /备注 ·/ });
    await remarkDialog.getByRole('textbox').fill(`客户要求蓝色包装 ${stamp}`);
    const remarkUpload = page.waitForResponse((response) => response.url().includes('/attachments?category=remark'));
    await remarkDialog.locator('input[type="file"]').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG_1PX });
    await remarkUpload;
    await expect(remarkDialog.locator('.cpe-remark-image-grid img')).toHaveCount(1);
    await remarkDialog.getByRole('button', { name: '保存备注' }).click();
    await expect(remarkDialog).toBeHidden();
    await expect(row.getByRole('button', { name: `编辑备注：${productName}` })).toContainText(`客户要求蓝色包装 ${stamp}`);
    await expect(row.getByRole('button', { name: `管理附件：${productName}` })).toHaveText('上传');

    // 附件弹窗：上传后计数生效
    await row.getByRole('button', { name: `管理附件：${productName}` }).click();
    const attachmentDialog = page.getByRole('dialog', { name: /附件 ·/ });
    await attachmentDialog.locator('input[type="file"]').setInputFiles({ name: '说明书.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(attachmentDialog.locator('.cpe-attachment-row')).toHaveCount(1);
    await expect(attachmentDialog.locator('.cpe-attachment-row')).toContainText('说明书.txt');
    await attachmentDialog.locator(".modal-close").click();
    await expect(row.getByRole('button', { name: `管理附件：${productName}` })).toHaveText('1 个');
  } finally {
    await page.request.delete(`/api/customers/${customerId}`);
  }
});

test.describe('手机端', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('卡片上的标贴、备注、附件都能打开对应弹窗', async ({ page }) => {
    const stamp = Date.now();
    const { customerId, customerName, productName } = await seedProduct(page, stamp);
    try {
      await page.goto('/');
      await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
      await page.getByRole('button', { name: '客户', exact: true }).last().click();
      await page.locator('.customer-list-trigger:visible').first().click();
      await page.locator('.customer-list-item:visible').filter({ hasText: customerName }).first().click();
      const card = page.locator('.customer-product-card:visible').first();

      await card.getByRole('button', { name: `管理标贴库存：${productName}` }).click();
      await expect(page.getByRole('dialog', { name: /标贴管理/ })).toBeVisible();
      await page.getByRole("dialog", { name: /标贴管理/ }).locator(".modal-close").click();

      await card.getByRole('button', { name: `编辑备注：${productName}` }).click();
      await expect(page.getByRole('dialog', { name: /备注 ·/ })).toBeVisible();
      await page.getByRole("dialog", { name: /备注 ·/ }).locator(".modal-close").click();

      await card.getByRole('button', { name: `管理附件：${productName}` }).click();
      await expect(page.getByRole('dialog', { name: /附件 ·/ })).toBeVisible();
      await page.getByRole("dialog", { name: /附件 ·/ }).locator(".modal-close").click();
    } finally {
      await page.request.delete(`/api/customers/${customerId}`);
    }
  });
});
