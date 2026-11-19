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

test('订单详情显示成本快照和毛利，成本编辑器可补录整单费用', async ({ page }) => {
  const stamp = Date.now();
  const customer = await page.request.post('/api/customers', {
    data: { name: `E2E利润客户${stamp}`, contactName: '王工', contactPhone: '13800000000', shippingInfo: '深圳市南山区' },
  });
  expect(customer.ok()).toBeTruthy();
  const customerId = Number((await customer.json()).data.id);
  const customerProduct = await page.request.post(`/api/customers/${customerId}/products`, {
    data: {
      name: `E2E利润产品${stamp}`,
      specification: '24V 100Ah',
      sku: `PROFIT-${stamp}`,
      packCount: 10,
      finalPriceCents: 8800,
      costPriceCents: 3000,
      batteryCostCents: 800,
      chargerCostCents: 300,
      packagingCostCents: 200,
      accessoryCostCents: 100,
      otherCostCents: 0,
      costConfirmed: true,
      packaging: [{ name: '彩盒', innerSize: '', innerWeight: 0, outerSize: '', outerWeight: 0, packCount: 10 }],
    },
  });
  expect(customerProduct.ok()).toBeTruthy();
  const customerProductId = Number((await customerProduct.json()).data.id);
  const orderNo = `SO-PROFIT-${stamp}`;
  const order = await page.request.post('/api/orders', {
    data: {
      orderNo,
      orderedAt: dateInputValue(),
      customerId,
      recipientName: '王工',
      recipientInfo: '王工 13800000000 深圳市南山区',
      shippingCents: 0,
      logisticsCostCents: 1500,
      labelCostCents: 100,
      otherCostCents: 500,
      otherCostNote: '平台手续费',
      costConfirmed: true,
      items: [{
        customerProductId,
        quantity: 2,
        unitPriceCents: 8800,
        packCount: 10,
      }],
    },
  });
  expect(order.ok()).toBeTruthy();
  const orderId = Number((await order.json()).data.id);

  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(orderNo);
    const row = page.locator('.orders-table-desktop tbody tr', { hasText: orderNo }).first();
    await expect(row.locator('.order-profit-sub')).toContainText('毛利 ¥67.00');
    await row.getByRole('button', { name: '详情' }).click();
    const detail = page.getByRole('dialog', { name: new RegExp(`订单详情.*${orderNo}`) });
    const profitCard = detail.locator('.order-profit-card');
    await expect(profitCard).toContainText('订单收入');
    await expect(profitCard).toContainText('¥ 176.00');
    await expect(profitCard).toContainText('¥ 109.00');
    await expect(profitCard).toContainText('¥ 67.00');
    await expect(profitCard).toContainText('38.1%');

    await detail.getByRole('button', { name: '编辑订单' }).click();
    const editDialog = page.getByRole('dialog', { name: new RegExp(`编辑订单.*${orderNo}`) });
    await editDialog.getByRole('button', { name: '成本与利润' }).click();
    const costDialog = page.getByRole('dialog', { name: '订单成本与利润' });
    await expect(costDialog.getByLabel('实际物流费')).toHaveValue('15.00');
    await expect(costDialog.getByLabel('标贴成本')).toHaveValue('1.00');
    await expect(costDialog.getByLabel('其他整单费用')).toHaveValue('5.00');
    await expect(costDialog.getByLabel('机头单件成本')).toHaveValue('30.00');
    await expect(costDialog).toContainText('44.00');
    await costDialog.getByRole('button', { name: '完成' }).click();
    await editDialog.getByRole('button', { name: '取消' }).click();

    await page.locator('.sidebar-nav').getByRole('button', { name: '财务', exact: true }).click();
    await expect(page.getByText('本期毛利', { exact: true })).toBeVisible();
  } finally {
    await page.request.delete(`/api/orders/${orderId}`);
    await page.request.delete(`/api/customer-products/${customerProductId}`);
    await page.request.delete(`/api/customers/${customerId}`);
  }
});
