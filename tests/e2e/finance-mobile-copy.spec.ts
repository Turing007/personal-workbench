import { expect, test, type APIRequestContext } from '@playwright/test';
import { dateInputValue } from '../../src/shared/date-input';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

async function authenticatedDelete(request: APIRequestContext, path: string): Promise<void> {
  const response = await request.delete(path, { headers: { Cookie: `wb_session=${sessionCookie}` } });
  if (!response.ok() && response.status() !== 404) {
    throw new Error(`清理失败：DELETE ${path} -> HTTP ${response.status()}`);
  }
}

test('手机端财务可复制公司开票信息', async ({ page, context, request }) => {
  const stamp = Date.now();
  const companyName = `手机复制公司${stamp}有限公司`;
  const taxNo = `TAX${stamp}`;
  const companyResponse = await page.request.post('/api/finance/companies', {
    data: {
      fullName: companyName,
      taxNo,
      bankName: '中国银行测试支行',
      bankAccount: '1234567890',
      address: '浙江省宁波市测试路 1 号',
      phone: '13800000000',
    },
  });
  expect(companyResponse.ok()).toBeTruthy();
  const company = (await companyResponse.json()).data;

  const customerResponse = await page.request.post('/api/customers', {
    data: { name: `复制测试客户${stamp}`, contactName: '财务', contactPhone: '13800000000', shippingInfo: '浙江省宁波市测试路 1 号' },
  });
  expect(customerResponse.ok()).toBeTruthy();
  const customer = (await customerResponse.json()).data;

  const orderResponse = await page.request.post('/api/orders', {
    data: {
      orderNo: '',
      orderedAt: dateInputValue(),
      customerId: customer.id,
      recipientName: '财务',
      recipientInfo: '浙江省宁波市测试路 1 号',
      settlementType: 'corporate',
      companyId: company.id,
      items: [{ name: '复制测试产品', sku: `COPY-${stamp}`, specification: '标准', packagingName: '纸箱', packCount: 10, quantity: 10, unitPriceCents: 1000 }],
    },
  });
  expect(orderResponse.ok()).toBeTruthy();
  const order = (await orderResponse.json()).data;

  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:52399' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: '更多模块' }).click();
    await page.locator('.sidebar-nav').getByRole('button', { name: '财务', exact: true }).click();

    // 手机端原来没有“公司档案”入口，现在必须能看到。
    await expect(page.getByRole('button', { name: '公司档案' })).toBeVisible();
    const card = page.locator('.finance-card', { hasText: order.order_no });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: '复制开票' }).click();
    await expect(page.getByText(/已复制.*开票信息/)).toBeVisible();
    const cardClipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(cardClipboard).toContain('【开票信息】');
    expect(cardClipboard).toContain(companyName);
    expect(cardClipboard).toContain(taxNo);

    await card.getByRole('button', { name: '查看财务' }).click();
    const detail = page.getByRole('dialog', { name: /财务详情/ });
    await expect(detail).toBeVisible();
    await expect(detail.getByRole('button', { name: '复制开票信息' })).toBeVisible();
    await detail.getByRole('button', { name: '复制开票信息' }).click();
    const detailClipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(detailClipboard).toContain(companyName);
    await detail.getByRole('button', { name: '关闭' }).click();

    await page.getByRole('button', { name: '公司档案' }).click();
    const manager = page.getByRole('dialog', { name: '公司档案' });
    const companyRow = manager.locator('.company-row', { hasText: companyName });
    await expect(companyRow).toBeVisible();
    await expect(companyRow.getByTitle('复制开票信息（可直接发给客户）')).toBeVisible();
  } finally {
    await authenticatedDelete(request, `/api/orders/${order.id}`);
    await authenticatedDelete(request, `/api/finance/companies/${company.id}`);
    await authenticatedDelete(request, `/api/customers/${customer.id}`);
  }
});
