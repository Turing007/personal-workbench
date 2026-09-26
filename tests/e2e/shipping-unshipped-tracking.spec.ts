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

/** 建一单未发货订单（新建后状态是待备货，远早于「待发货」）。 */
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
  await page.locator('.sidebar-nav').getByRole('button', { name: '发货管理', exact: true }).click();
}

test.describe('发货工作区收未发货订单', () => {
  test('待备货订单能加入批次并单独保存物流单号，刷新后单号还在', async ({ page }) => {
    const stamp = Date.now();
    const { customerId, orderId, orderNo } = await seedOrder(page, stamp);
    try {
      await openShipping(page);
      const available = page.locator('.shipping-available-order', { hasText: orderNo });
      await expect(available).toBeVisible();
      // 状态徽标显示真实阶段，不再假装它是待发货
      await expect(available.getByText('待备货')).toBeVisible();
      await available.getByRole('button', { name: '加入批次' }).click();

      const trackingInput = page.getByRole('textbox', { name: `${orderNo}物流单号` });
      await expect(trackingInput).toBeVisible();
      const patchResponse = page.waitForResponse((response) => (
        new URL(response.url()).pathname === `/api/orders/${orderId}/tracking` && response.request().method() === 'PATCH'
      ));
      await trackingInput.fill(`SF${stamp}`);
      await trackingInput.blur();
      expect((await patchResponse).status()).toBe(200);

      // 未到「待发货」的单不能确认发货，但单号已经存住
      await expect(page.getByText('1 单未到「待发货」，本次不确认发货')).toBeVisible();
      await expect(page.getByRole('button', { name: '确认批次发货' })).toBeDisabled();

      await openShipping(page);
      await page.locator('.shipping-available-order', { hasText: orderNo }).getByRole('button', { name: '加入批次' }).click();
      await expect(page.getByRole('textbox', { name: `${orderNo}物流单号` })).toHaveValue(`SF${stamp}`);
    } finally {
      await page.request.delete(`/api/orders/${orderId}`);
      await page.request.delete(`/api/customers/${customerId}`);
    }
  });
});
