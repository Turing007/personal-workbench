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

async function createOrder(page: import('@playwright/test').Page, channel: 'online' | 'offline', stamp: number) {
  const orderNo = `E2E-CH-${channel}-${stamp}`;
  const response = await page.request.post('/api/orders', {
    data: {
      orderNo,
      orderedAt: dateInputValue(),
      channel,
      recipientName: '渠道收件人',
      recipientInfo: '渠道收件人 13800000000 深圳市南山区',
      items: [{ name: `E2E渠道产品-${channel}`, sku: `CH-${channel}-${stamp}`, specification: '标准', packagingName: '彩盒', packCount: 10, quantity: 2, unitPriceCents: 5000 }],
    },
  });
  expect(response.ok()).toBeTruthy();
  const order = (await response.json()).data;
  return { orderId: Number(order.id), orderNo: String(order.order_no) };
}

test('订单线上/线下页签互不串单，编辑可改渠道', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = Date.now();
  const online = await createOrder(page, 'online', stamp);
  const offline = await createOrder(page, 'offline', stamp);
  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    const onlineTab = page.getByRole('tab', { name: /线上订单/ });
    const offlineTab = page.getByRole('tab', { name: /线下订单/ });
    await expect(onlineTab).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: '新建订单' }).click();
    const onlineForm = page.getByRole('dialog', { name: '新建订单' });
    await expect(onlineForm.getByRole('combobox', { name: '订单渠道' })).toHaveValue('online');
    await expect(onlineForm.getByRole('combobox', { name: '订单渠道' })).toBeDisabled();
    await onlineForm.getByRole('button', { name: '取消' }).click();

    const search = page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格');
    await search.fill(offline.orderNo);
    await expect(page.locator('.orders-table-desktop tbody tr', { hasText: offline.orderNo })).toHaveCount(0);

    await offlineTab.click();
    const offlineRow = page.locator('.orders-table-desktop tbody tr', { hasText: offline.orderNo }).first();
    await expect(offlineRow).toHaveCount(1);
    await expect(page.locator('.orders-table-desktop tbody tr', { hasText: online.orderNo })).toHaveCount(0);
    await page.getByRole('button', { name: '新建订单' }).click();
    const offlineForm = page.getByRole('dialog', { name: '新建订单' });
    await expect(offlineForm.getByRole('combobox', { name: '订单渠道' })).toHaveValue('offline');
    await expect(offlineForm.getByRole('combobox', { name: '订单渠道' })).toBeDisabled();
    await offlineForm.getByRole('button', { name: '取消' }).click();

    page.once('dialog', (dialog) => void dialog.accept());
    await offlineRow.getByRole('button', { name: '编辑', exact: true }).click();
    const editDialog = page.getByRole('dialog', { name: new RegExp(`编辑订单.*${offline.orderNo}`) });
    await expect(editDialog).toBeVisible();
    await editDialog.getByRole('combobox', { name: '订单渠道' }).selectOption('online');
    await editDialog.getByRole('button', { name: '保存订单' }).click();
    await expect(editDialog).toBeHidden();

    await expect(page.locator('.orders-table-desktop tbody tr', { hasText: offline.orderNo })).toHaveCount(0);
    await onlineTab.click();
    await expect(page.locator('.orders-table-desktop tbody tr', { hasText: offline.orderNo })).toHaveCount(1);
  } finally {
    await page.request.delete(`/api/orders/${online.orderId}`);
    await page.request.delete(`/api/orders/${offline.orderId}`);
  }
});
