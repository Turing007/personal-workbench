import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { dateInputValue } from '../../src/shared/date-input';
import { ensureAuthenticated, injectSession } from './helpers/auth';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

async function seedCompanyOrder(page: Page, stamp: number) {
  const companyResponse = await page.request.post('/api/finance/companies', {
    data: { shortName: `批量公司${stamp}`, fullName: `批量公司${stamp}全称`, taxNo: `BATCH${stamp}` },
  });
  expect(companyResponse.ok()).toBeTruthy();
  const company = (await companyResponse.json()).data;
  const orderResponse = await page.request.post('/api/orders', {
    data: {
      orderNo: '',
      orderedAt: dateInputValue(),
      recipientName: '批量收件人',
      recipientInfo: '批量收件人 13800000000 广东省深圳市',
      settlementType: 'corporate',
      companyId: company.id,
      items: [{ name: '批量测试产品', sku: `BATCH-${stamp}`, specification: '标准', packagingName: '', packCount: 1, quantity: 1, unitPriceCents: 10000 }],
    },
  });
  expect(orderResponse.ok()).toBeTruthy();
  const order = (await orderResponse.json()).data;
  return { company, order };
}

async function uploadProof(page: Page, orderId: number, stamp: number, amountCents = 1000) {
  const response = await page.request.post(`/api/finance/orders/${orderId}/proofs`, {
    multipart: {
      file: { name: `批量水单-${stamp}-${amountCents}.png`, mimeType: 'image/png', buffer: PNG_1X1 },
      paymentDate: dateInputValue(),
      amountCents: String(amountCents),
      paymentMethod: '银行转账',
      payerName: '批量付款人',
      transactionNo: `BATCH-TX-${stamp}-${amountCents}`,
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data.id as number;
}

async function authenticatedDelete(request: APIRequestContext, path: string): Promise<void> {
  const response = await request.delete(path, { headers: { Cookie: `wb_session=${sessionCookie}` } });
  if (!response.ok() && response.status() !== 404) throw new Error(`清理失败：DELETE ${path} -> HTTP ${response.status()}`);
}

test('水单批量确认与批量驳回：勾选、合计、二次确认和逐条结果', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = Date.now();
  const { company, order } = await seedCompanyOrder(page, stamp);
  const orderNo = String(order.order_no);
  try {
    await uploadProof(page, order.id, stamp, 1000);
    await uploadProof(page, order.id, stamp, 2000);
    await uploadProof(page, order.id, stamp, 3000);

    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '水单', exact: true }).click();
    const rows = page.locator('.water-slip-table tbody tr', { hasText: orderNo });
    await expect(rows).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) await rows.nth(index).locator('input[type=checkbox]').check();

    const bulk = page.locator('.water-slip-bulk-bar');
    await expect(bulk).toContainText('已选 3 张');
    await expect(bulk).toContainText('合计 ¥60.00');

    page.once('dialog', (dialog) => dialog.accept());
    await bulk.getByRole('button', { name: '批量确认' }).click();
    await expect(page.getByText('已确认入账 3 张水单')).toBeVisible();
    await expect(rows.first()).toContainText('已入账');
    await expect(rows.first().locator('input[type=checkbox]')).toBeDisabled();

    await uploadProof(page, order.id, stamp, 4000);
    await page.reload();
    await page.locator('.sidebar-nav').getByRole('button', { name: '水单', exact: true }).click();
    const refreshed = page.locator('.water-slip-table tbody tr', { hasText: orderNo });
    await expect(refreshed).toHaveCount(4);
    const pendingRow = refreshed.filter({ hasText: '待确认' });
    await pendingRow.locator('input[type=checkbox]').check();
    await expect(page.locator('.water-slip-bulk-bar')).toContainText('已选 1 张');

    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'prompt') await dialog.accept('E2E批量驳回原因');
      else await dialog.accept();
    });
    await page.getByRole('button', { name: '批量驳回' }).click();
    await expect(page.getByText('已驳回 1 张水单')).toBeVisible();
    await expect(refreshed.filter({ hasText: '已驳回' })).toHaveCount(1);
  } finally {
    await authenticatedDelete(request, `/api/orders/${order.id}`);
    await authenticatedDelete(request, `/api/finance/companies/${company.id}`);
  }
});

test('水单手机卡片可展开查看付款信息，批量条不横向溢出', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const stamp = Date.now();
  const { company, order } = await seedCompanyOrder(page, stamp);
  const orderNo = String(order.order_no);
  try {
    await uploadProof(page, order.id, stamp, 1200);
    await page.goto('/');
    await page.getByRole('button', { name: '更多模块' }).click();
    await page.locator('.sidebar-nav').getByRole('button', { name: '水单', exact: true }).click();
    const card = page.locator('.water-slip-card', { hasText: orderNo }).first();
    await card.getByRole('button', { name: `展开水单 ${orderNo}` }).click();
    const panel = card.locator('.water-proof-expand-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('付款人');
    await expect(panel).toContainText('批量付款人');
    await expect(panel).toContainText('打开原图');
    await card.locator('.water-slip-card-check').check();
    await expect(page.locator('.water-slip-bulk-bar')).toContainText('已选 1 张');
    const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await authenticatedDelete(request, `/api/orders/${order.id}`);
    await authenticatedDelete(request, `/api/finance/companies/${company.id}`);
  }
});
