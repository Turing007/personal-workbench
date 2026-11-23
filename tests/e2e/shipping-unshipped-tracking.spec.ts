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

/** 建一单（新建后是待备货），需要发货时再推进到待发货。 */
async function seedOrder(page: Page, stamp: number, channel?: 'online' | 'offline') {
  const customer = await (await page.request.post('/api/customers', {
    data: { name: `E2E发货${stamp}`, contactName: '发货联系人', contactPhone: '13900000002', shippingInfo: '杭州市西湖区' },
  })).json();
  const created = await page.request.post('/api/orders', {
    data: {
      orderNo: '',
      orderedAt: new Date().toISOString(),
      channel,
      customerId: customer.data.id,
      recipientName: '发货联系人',
      recipientInfo: '杭州市西湖区',
      amount: 100,
      items: [{ name: 'E2E发货产品', sku: `SH-${stamp}`, specification: '标准', packagingName: '纸箱', packCount: 10, quantity: 20, unitPriceCents: 500 }],
    },
  });
  expect(created.ok()).toBeTruthy();
  const order = (await created.json()).data;
  return { customerId: Number(customer.data.id), orderId: Number(order.id), orderNo: String(order.order_no) };
}

async function openShipping(page: Page) {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '发货', exact: true }).click();
}

async function advanceToShipPending(page: Page, orderId: number) {
  for (const to of ['stock_reported', 'pending_packing', 'ship_pending']) {
    const advanced = await page.request.post(`/api/orders/${orderId}/status`, { data: { to } });
    expect(advanced.ok()).toBeTruthy();
  }
}

test.describe('发货工作区收待发货订单', () => {
  test('待发货订单能加入批次并保存物流单号，刷新后单号还在', async ({ page }) => {
    const stamp = Date.now();
    const { customerId, orderId, orderNo } = await seedOrder(page, stamp);
    try {
      await advanceToShipPending(page, orderId);
      await openShipping(page);
      const available = page.locator('.shipping-available-order', { hasText: orderNo });
      await expect(available).toBeVisible();
      await expect(available.getByText('待发货')).toBeVisible();
      await available.getByRole('button', { name: '加入批次' }).click();

      const trackingInput = page.getByRole('textbox', { name: `${orderNo}物流单号` });
      await expect(trackingInput).toBeVisible();
      const patchResponse = page.waitForResponse((response) => (
        new URL(response.url()).pathname === `/api/orders/${orderId}/tracking` && response.request().method() === 'PATCH'
      ));
      await trackingInput.fill(`SF${stamp}`);
      await trackingInput.blur();
      expect((await patchResponse).status()).toBe(200);

      await openShipping(page);
      await page.locator('.shipping-available-order', { hasText: orderNo }).getByRole('button', { name: '加入批次' }).click();
      await expect(page.getByRole('textbox', { name: `${orderNo}物流单号` })).toHaveValue(`SF${stamp}`);
    } finally {
      await page.request.delete(`/api/orders/${orderId}`);
      await page.request.delete(`/api/customers/${customerId}`);
    }
  });

  test('发货工作区按渠道筛选待发货订单', async ({ page }) => {
    const stamp = Date.now();
    const online = await seedOrder(page, stamp, 'online');
    const offline = await seedOrder(page, stamp + 1, 'offline');
    try {
      await advanceToShipPending(page, online.orderId);
      await advanceToShipPending(page, offline.orderId);
      await openShipping(page);

      const channelSelect = page.getByRole('combobox', { name: '订单渠道筛选' });
      await expect(page.locator('.shipping-available-order', { hasText: online.orderNo })).toBeVisible();
      await expect(page.locator('.shipping-available-order', { hasText: offline.orderNo })).toBeVisible();

      await channelSelect.selectOption('online');
      await expect(page.locator('.shipping-available-order', { hasText: online.orderNo })).toBeVisible();
      await expect(page.locator('.shipping-available-order', { hasText: offline.orderNo })).toHaveCount(0);

      await channelSelect.selectOption('offline');
      await expect(page.locator('.shipping-available-order', { hasText: offline.orderNo })).toBeVisible();
      await expect(page.locator('.shipping-available-order', { hasText: online.orderNo })).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/orders/${online.orderId}`);
      await page.request.delete(`/api/orders/${offline.orderId}`);
      await page.request.delete(`/api/customers/${online.customerId}`);
      await page.request.delete(`/api/customers/${offline.customerId}`);
    }
  });

  test('待发货订单可按产品数量分批发货，发完后自动完成', async ({ page }) => {
    const stamp = Date.now();
    const orderNo = `E2E-PARTIAL-${stamp}`;
    const customer = await (await page.request.post('/api/customers', {
      data: { name: `E2E分批客户${stamp}`, contactName: '分批联系人', contactPhone: '13900000003', shippingInfo: '杭州市西湖区' },
    })).json();
    const created = await page.request.post('/api/orders', {
      data: {
        orderNo,
        orderedAt: new Date().toISOString(),
        channel: 'online',
        customerId: customer.data.id,
        recipientName: '分批联系人',
        recipientInfo: '杭州市西湖区',
        amount: 0,
        items: [
          { name: '圆砂机', sku: `PART-A-${stamp}`, specification: '20V', packagingName: '纸箱', packCount: 10, quantity: 10, unitPriceCents: 0 },
          { name: '水枪', sku: `PART-B-${stamp}`, specification: 'MT', packagingName: '纸箱', packCount: 5, quantity: 5, unitPriceCents: 0 },
        ],
      },
    });
    expect(created.ok()).toBeTruthy();
    const orderId = Number((await created.json()).data.id);
    try {
      await advanceToShipPending(page, orderId);
      await openShipping(page);
      await page.locator('.shipping-available-order', { hasText: orderNo }).getByRole('button', { name: '加入批次' }).click();
      await page.getByLabel(`${orderNo}-圆砂机-本次数量`).fill('4');
      await page.getByRole('textbox', { name: `${orderNo}物流单号` }).fill(`SF-PART-A-${stamp}`);
      await page.getByRole('button', { name: '确认本次发货' }).click();
      await expect(page.getByText('已确认 1 单本次发货')).toBeVisible();
      await expect(page.getByRole('button', { name: '下载本批发货清单' })).toBeVisible();

      const partial = await (await page.request.get(`/api/orders/${orderId}/detail`)).json();
      expect(partial.data.status).toBe('ship_pending');
      expect(partial.data.items.find((item: { sku: string }) => item.sku === `PART-A-${stamp}`).shipped_quantity).toBe(4);
      expect(partial.data.items.find((item: { sku: string }) => item.sku === `PART-B-${stamp}`).shipped_quantity).toBe(0);

      const available = page.locator('.shipping-available-order', { hasText: orderNo });
      await expect(available).toContainText('部分发货');
      await available.getByRole('button', { name: '加入批次' }).click();
      const batchOrder = page.locator('.shipping-batch-order', { hasText: orderNo });
      await batchOrder.getByRole('button', { name: '本次全发' }).click();
      await page.getByRole('textbox', { name: `${orderNo}物流单号` }).fill(`SF-PART-B-${stamp}`);
      await page.getByRole('button', { name: '确认本次发货' }).click();
      await expect(page.getByText('已确认 1 单本次发货')).toBeVisible();

      const completed = await (await page.request.get(`/api/orders/${orderId}/detail`)).json();
      expect(completed.data.status).toBe('shipped');
      expect(completed.data.items.every((item: { shipped_quantity: number; quantity: number }) => item.shipped_quantity === item.quantity)).toBe(true);
      const history = await (await page.request.get(`/api/shipping/orders/${orderId}/shipments`)).json();
      expect(history.data).toHaveLength(2);
    } finally {
      const history = await page.request.get(`/api/shipping/orders/${orderId}/shipments`);
      if (history.ok()) {
        for (const shipment of (await history.json()).data) await page.request.delete(`/api/shipping/shipments/${shipment.id}`);
      }
      await page.request.delete(`/api/orders/${orderId}`);
      await page.request.delete(`/api/customers/${customer.data.id}`);
    }
  });

  test('待发货订单点“发货”只进入发货工作区，不自动加入批次', async ({ page }) => {
    const stamp = Date.now();
    const { customerId, orderId, orderNo } = await seedOrder(page, stamp);
    try {
      await advanceToShipPending(page, orderId);

      await page.goto('/');
      await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
      await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(orderNo);
      const row = page.locator('.orders-table-desktop tbody tr', { hasText: orderNo }).first();
      await expect(row.getByRole('button', { name: '发货', exact: true })).toBeVisible();
      await row.getByRole('button', { name: '发货', exact: true }).click();

      await expect(page.getByText('发货工作区', { exact: true })).toBeVisible();
      // 不再按单跳转：没有自动塞入批次（无物流单号输入框），订单仍留在可加入列表里
      await expect(page.getByRole('textbox', { name: `${orderNo}物流单号` })).toHaveCount(0);
      const available = page.locator('.shipping-available-order', { hasText: orderNo });
      await expect(available.getByRole('button', { name: '加入批次' })).toBeVisible();

      // 未确认收到货款：可以准备批次，但不能确认发货
      await available.getByRole('button', { name: '加入批次' }).click();
      await expect(page.locator('.shipping-batch-order', { hasText: orderNo })).toContainText('未收款');
      await expect(page.getByText(/未确认收到货款/)).toBeVisible();
      await expect(page.getByRole('button', { name: '确认本次发货' })).toBeDisabled();
    } finally {
      await page.request.delete(`/api/orders/${orderId}`);
      await page.request.delete(`/api/customers/${customerId}`);
    }
  });
});
