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
async function seedOrder(page: Page, stamp: number) {
  const customer = await (await page.request.post('/api/customers', {
    data: { name: `E2E发货${stamp}`, contactName: '发货联系人', contactPhone: '13900000002', shippingInfo: '杭州市西湖区' },
  })).json();
  const created = await page.request.post('/api/orders', {
    data: {
      orderNo: '',
      orderedAt: new Date().toISOString(),
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
      await expect(page.getByRole('button', { name: '确认批次发货' })).toBeDisabled();
    } finally {
      await page.request.delete(`/api/orders/${orderId}`);
      await page.request.delete(`/api/customers/${customerId}`);
    }
  });
});
