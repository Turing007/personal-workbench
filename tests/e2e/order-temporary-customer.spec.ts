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

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

test.describe('订单临时客户', () => {
  test('未建客户档案：直接输名字开单，从系统产品库选品带图，保存后列表标临时', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const stamp = Date.now();
    const tempName = `E2E临时客户${stamp}`;
    const productName = `E2E临时选品${stamp}`;

    const createdProduct = await page.request.post('/api/products', {
      data: { name: productName, sku: `E2E-TMP-${stamp}`, specification: '20V', status: 'active', packaging: [{ name: '彩盒包装', packCount: 10, innerWeight: 0.5, outerSize: '40×30×25', outerWeight: 8 }] },
    });
    expect(createdProduct.ok()).toBe(true);
    const product = (await createdProduct.json()).data as { id: string };
    const uploaded = await page.request.post(`/api/products/${product.id}/images?category=product`, {
      multipart: { file: { name: `tmp-${stamp}.png`, mimeType: 'image/png', buffer: PNG_1PX } },
    });
    expect(uploaded.ok()).toBe(true);

    let orderId: number | undefined;
    try {
      await page.goto('/');
      await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
      await page.getByRole('button', { name: '新建订单' }).click();
      const formDialog = page.getByRole('dialog', { name: '新建订单' });
      await expect(formDialog).toBeVisible();

      const selector = formDialog.getByRole('textbox', { name: '客户', exact: true });
      await selector.click();
      await selector.fill(tempName);
      await formDialog.getByRole('option').filter({ hasText: '按临时客户开单' }).first().click();
      await expect(formDialog.getByText('临时', { exact: true }).first()).toBeVisible();

      await formDialog.getByPlaceholder('从收件信息自动提取，可修改').fill('临时收件人');

      await formDialog.getByRole('button', { name: '填写订单详情' }).click();
      const detailDialog = page.getByRole('dialog', { name: '填写订单详情' });
      await expect(detailDialog).toBeVisible();
      // 临时客户下客户产品库不可用，给出提示
      await expect(detailDialog.getByText(/临时客户暂不能用客户产品库/)).toBeVisible();

      await detailDialog.getByRole('button', { name: '从系统产品库添加' }).click();
      await detailDialog.getByPlaceholder('筛选品名').fill(productName);
      await detailDialog.locator('button[title="选择产品"]').first().click();

      const nameInput = detailDialog.locator('input[aria-label="订单产品品名"]').first();
      await expect(nameInput).toHaveValue(productName);
      // 系统产品图带入明细行缩略图
      await expect(detailDialog.locator('.order-item-card img').first()).toBeVisible();
      await detailDialog.locator('input[aria-label="订单产品单价"]').first().fill('12.5');
      await detailDialog.getByRole('button', { name: '完成', exact: true }).click();

      await formDialog.getByRole('button', { name: '保存订单' }).click();
      await expect(formDialog).not.toBeVisible();

      const list = await page.request.get(`/api/orders?q=${encodeURIComponent(tempName)}`);
      const listData = (await list.json()).data as { rows?: Array<Record<string, unknown>>; items?: Array<Record<string, unknown>> };
      const rows = listData.rows ?? listData.items ?? [];
      const order = rows.find((row) => row.customer_name === tempName);
      expect(order).toBeTruthy();
      orderId = Number(order!.id);
      expect(order!.customer_id).toBeNull();

      const detail = await page.request.get(`/api/orders/${orderId}/detail`);
      const detailBody = JSON.parse(await detail.text()) as { data: { items: Array<Record<string, unknown>> } };
      const item = detailBody.data.items[0];
      expect(item.product_id).toBe(Number(product.id));
      expect(item.customer_product_id).toBeNull();

      // 列表行显示临时标记
      await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(tempName);
      const row = page.locator('.orders-table-desktop tbody tr', { hasText: tempName }).first();
      await expect(row.getByText('临时', { exact: true })).toBeVisible();
    } finally {
      if (orderId) await page.request.delete(`/api/orders/${orderId}`);
      await page.request.delete(`/api/products/${product.id}`);
    }
  });

  test('转正：行内展开入口预览挂接订单，确认后建客户并挂接', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const stamp = Date.now();
    const tempName = `E2E转正客户${stamp}`;
    const orderNo = `E2E-PROMO-${stamp}`;
    const created = await page.request.post('/api/orders', {
      data: {
        orderNo,
        orderedAt: dateInputValue(),
        customerId: null,
        customerName: tempName,
        recipientName: '转正收件人',
        recipientInfo: '转正收件人 13800000000 广东省深圳市南山区',
        items: [{ name: 'E2E转正产品', sku: `E2E-PROMO-${stamp}`, specification: '标准', packagingName: '彩盒', packCount: 1, quantity: 2, unitPriceCents: 5000 }],
      },
    });
    expect(created.ok()).toBe(true);
    const orderId = Number((await created.json()).data.id);

    let customerId: number | undefined;
    try {
      await page.goto('/');
      await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
      await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(orderNo);
      const row = page.locator('.orders-table-desktop tbody tr', { hasText: orderNo }).first();
      await row.getByRole('button', { name: `展开订单 ${orderNo}` }).click();
      const panel = page.locator('.order-expand-row .order-expand-panel');
      await expect(panel.getByText(/临时客户/)).toBeVisible();
      await panel.getByRole('button', { name: '转正为客户' }).click();

      const promoteDialog = page.getByRole('dialog', { name: '临时客户转正' });
      await expect(promoteDialog).toBeVisible();
      await expect(promoteDialog.getByText(/将挂接 1 个/)).toBeVisible();
      await promoteDialog.getByRole('button', { name: /确认转正并挂接/ }).click();
      await expect(promoteDialog).not.toBeVisible();

      const customers = await page.request.get(`/api/customers?q=${encodeURIComponent(tempName)}`);
      const customerItems = (await customers.json()).data.items as Array<{ id: number; name: string }>;
      const customer = customerItems.find((item) => item.name === tempName);
      expect(customer).toBeTruthy();
      customerId = customer!.id;

      const detail = await page.request.get(`/api/orders/${orderId}/detail`);
      const detailBody = JSON.parse(await detail.text()) as { data: { customer_id: number; customer_name: string } };
      expect(detailBody.data.customer_id).toBe(customerId);
      expect(detailBody.data.customer_name).toBe(tempName);
    } finally {
      await page.request.delete(`/api/orders/${orderId}`);
      if (customerId) await page.request.delete(`/api/customers/${customerId}`);
    }
  });
});