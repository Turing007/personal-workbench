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

async function seedOrder(page: import('@playwright/test').Page, orderNo: string) {
  const response = await page.request.post('/api/orders', {
    data: {
      orderNo,
      orderedAt: dateInputValue(),
      recipientName: '展开收件人',
      recipientInfo: '展开收件人 13800000000 广东省深圳市南山区科技园 A 栋 8 楼',
      items: [{ name: 'E2E展开产品', sku: `E2E-EXPAND-${Date.now()}`, specification: '12V 100Ah', packagingName: '彩盒包装', packCount: 1, quantity: 2, unitPriceCents: 5000 }],
    },
  });
  expect(response.ok()).toBeTruthy();
  const order = (await response.json()).data;
  return Number(order.id ?? order.order_id);
}

test('订单桌面行内展开显示产品、收件信息和财务摘要，批量条固定可见', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const orderNo = `E2E-EXPAND-${Date.now()}`;
  const orderId = await seedOrder(page, orderNo);
  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(orderNo);

    const row = page.locator('.orders-table-desktop tbody tr', { hasText: orderNo }).first();
    await row.getByRole('button', { name: `展开订单 ${orderNo}` }).click();
    const panel = page.locator('.order-expand-row .order-expand-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('E2E展开产品');
    await expect(panel).toContainText('12V 100Ah');
    await expect(panel).toContainText('展开收件人');
    await expect(panel).toContainText('财务摘要');
    await expect(panel.getByRole('button', { name: '查看详情' })).toBeVisible();
    await expect(panel.getByRole('button', { name: '编辑订单' })).toBeVisible();
    await expect(panel.getByRole('button', { name: '打印箱唛' })).toBeVisible();

    await row.locator('input[type=checkbox]').check();
    const bulk = page.locator('.orders-bulk-bar');
    await expect(bulk).toBeVisible();
    await expect(bulk).toContainText('已选 1 条');
    await bulk.getByRole('button', { name: '取消选择' }).click();
    await expect(bulk).toHaveCount(0);

    await row.getByRole('button', { name: `收起订单 ${orderNo}` }).click();
    await expect(panel).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/orders/${orderId}`);
  }
});

test('订单手机卡片可展开且不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const orderNo = `E2E-EXPAND-M-${Date.now()}`;
  const orderId = await seedOrder(page, orderNo);
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '更多模块' }).click();
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(orderNo);
    const card = page.locator('.orders-card-list .order-card', { hasText: orderNo }).first();
    await card.getByRole('button', { name: `展开订单 ${orderNo}` }).click();
    await expect(card.locator('.order-expand-panel')).toContainText('E2E展开产品');
    await expect(card.locator('.order-expand-panel')).toContainText('展开收件人');
    const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await page.request.delete(`/api/orders/${orderId}`);
  }
});
