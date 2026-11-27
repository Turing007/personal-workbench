import { expect, test } from '@playwright/test';
import { dateInputValue } from '../../src/shared/date-input';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');

test('订单附件列：标贴 PDF 只显示一次，并使用归档附件的正确文件名', async ({ page }) => {
  const stamp = Date.now();
  const productName = `E2E标贴附件产品${stamp}`;
  const fileName = `订单标贴-${stamp}.pdf`;
  const orderNo = `E2E-STICKER-DEDUPE-${stamp}`;
  const customerResponse = await page.request.post('/api/customers', {
    data: { name: `E2E标贴附件客户${stamp}`, contactName: '张三', contactPhone: '13900000008', shippingInfo: '深圳市南山区' },
  });
  expect(customerResponse.ok(), await customerResponse.text()).toBeTruthy();
  const customer = (await customerResponse.json()).data as { id: number };
  const productResponse = await page.request.post(`/api/customers/${customer.id}/products`, {
    data: { name: productName, sku: `QA-STICKER-${stamp}`, packCount: 10, finalPriceCents: 10000, stickerEnabled: true, stickerPerSheet: 30 },
  });
  expect(productResponse.ok(), await productResponse.text()).toBeTruthy();
  const product = (await productResponse.json()).data as { id: number };
  const upload = await page.request.post(`/api/customer-products/${product.id}/attachments?category=label`, {
    multipart: { file: { name: fileName, mimeType: 'application/pdf', buffer: PDF } },
  });
  expect(upload.ok(), await upload.text()).toBeTruthy();
  const orderResponse = await page.request.post('/api/orders', {
    data: {
      orderNo,
      orderedAt: dateInputValue(),
      customerId: customer.id,
      customerName: `E2E标贴附件客户${stamp}`,
      recipientName: '张三',
      recipientInfo: '张三 13900000008 深圳市南山区',
      items: [{ customerProductId: product.id, quantity: 5, packCount: 10, unitPriceCents: 1000 }],
    },
  });
  expect(orderResponse.ok(), await orderResponse.text()).toBeTruthy();
  const orderId = Number((await orderResponse.json()).data.id);

  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(orderNo);
    const row = page.locator('.orders-table-desktop tbody tr', { hasText: orderNo }).first();
    await expect(row).toBeVisible();
    const links = row.locator('.order-extra-files a');
    await expect(links).toHaveCount(1);
    await expect(links).toContainText(fileName);
    await expect(links).toHaveAttribute('title', new RegExp(`标贴：${fileName}.*剩 0.*本单需 5`));
    await expect(links).toHaveClass(/is-short/);
    await expect(row.locator('.order-attachment-cell')).not.toContainText(`标贴 · ${productName}`);

    await page.setViewportSize({ width: 390, height: 844 });
    const card = page.locator('.orders-card-list .order-card', { hasText: orderNo }).first();
    await expect(card).toBeVisible();
    await expect(card.locator('.order-extra-files a')).toHaveCount(1);
    await expect(card.locator('.order-extra-files a')).toContainText(fileName);
  } finally {
    await page.request.delete(`/api/orders/${orderId}`);
    await page.request.delete(`/api/customers/${customer.id}`);
  }
});
