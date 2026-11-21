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

test('工作台：默认落地、待办、快捷新建和跳到待审核水单', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('工作台', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.dashboard-metrics > div')).toHaveCount(4);
  await expect(page.locator('.dashboard-task')).toHaveCount(7);

  await page.getByRole('button', { name: '新建订单' }).click();
  const orderDialog = page.getByRole('dialog', { name: '新建订单' });
  await expect(orderDialog).toBeVisible();
  await orderDialog.getByRole('button', { name: '取消' }).click();

  await page.locator('.sidebar-nav').getByRole('button', { name: '工作台', exact: true }).click();
  await page.getByRole('button', { name: '新建报价' }).click();
  const quoteDialog = page.getByRole('dialog', { name: /新建报价单/ });
  await expect(quoteDialog).toBeVisible();
  await quoteDialog.getByRole('button', { name: '取消' }).click();

  await page.locator('.sidebar-nav').getByRole('button', { name: '工作台', exact: true }).click();
  await page.getByRole('button', { name: '新建产品' }).click();
  const productDialog = page.getByRole('dialog', { name: '添加产品' });
  await expect(productDialog).toBeVisible();
  await productDialog.getByRole('button', { name: '关闭' }).click();

  await page.locator('.sidebar-nav').getByRole('button', { name: '工作台', exact: true }).click();
  await page.locator('.dashboard-task', { hasText: '待审核水单' }).click();
  await expect(page.getByText('水单收款', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '展开筛选' })).toHaveCount(0);
  const activeFilter = page.locator('.water-slip-active-filter');
  await expect(activeFilter).toContainText('当前只看：待确认');
  await activeFilter.click();
  await expect(activeFilter).toHaveCount(0);
});

test('工作台按渠道筛选并把渠道带入订单页签', async ({ page }) => {
  const stamp = Date.now();
  const onlineNo = `E2E-DASH-ONLINE-${stamp}`;
  const offlineNo = `E2E-DASH-OFFLINE-${stamp}`;
  const createOrder = async (orderNo: string, channel: 'online' | 'offline') => {
    const response = await page.request.post('/api/orders', {
      data: {
        orderNo,
        orderedAt: dateInputValue(),
        channel,
        recipientName: '工作台渠道收件人',
        recipientInfo: '工作台渠道收件人 13800000000 深圳市南山区',
        items: [{ name: `工作台渠道产品-${channel}`, sku: `DASH-${channel}-${stamp}`, specification: '标准', packagingName: '彩盒', packCount: 10, quantity: 1, unitPriceCents: 5000 }],
      },
    });
    expect(response.ok()).toBeTruthy();
    return Number((await response.json()).data.id);
  };
  const onlineId = await createOrder(onlineNo, 'online');
  const offlineId = await createOrder(offlineNo, 'offline');
  try {
    await page.goto('/');
    await page.getByRole('combobox', { name: '订单渠道筛选' }).selectOption('online');
    await page.locator('.dashboard-task', { hasText: '待备货' }).click();
    await expect(page.getByRole('tab', { name: /线上订单/ })).toHaveAttribute('aria-selected', 'true');

    const search = page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格');
    await search.fill(onlineNo);
    await expect(page.locator('.orders-table-desktop tbody tr', { hasText: onlineNo })).toHaveCount(1);
    await search.fill(offlineNo);
    await expect(page.locator('.orders-table-desktop tbody tr', { hasText: offlineNo })).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/orders/${onlineId}`);
    await page.request.delete(`/api/orders/${offlineId}`);
  }
});

test('工作台手机端不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.dashboard-metrics')).toBeVisible();
  await expect(page.locator('.dashboard-task')).toHaveCount(7);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
