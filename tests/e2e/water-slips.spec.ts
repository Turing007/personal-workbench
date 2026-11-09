import { expect, test } from '@playwright/test';
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

test.describe.configure({ timeout: 120_000 });

async function seedCompanyOrder(page: import('@playwright/test').Page, stamp: number) {
  const companyResponse = await page.request.post('/api/finance/companies', {
    data: { shortName: `水单公司${stamp}`, fullName: `水单公司${stamp}全称`, taxNo: `TAX${stamp}` },
  });
  expect(companyResponse.ok()).toBeTruthy();
  const company = (await companyResponse.json()).data;

  const orderResponse = await page.request.post('/api/orders', {
    data: {
      orderNo: '',
      orderedAt: dateInputValue(),
      recipientName: '水单收件人',
      recipientInfo: '水单收件人 13800000000 广东省深圳市',
      settlementType: 'corporate',
      companyId: company.id,
      items: [{ name: '水单测试产品', sku: `WS-${stamp}`, specification: '标准', packagingName: '', packCount: 1, quantity: 2, unitPriceCents: 5000 }],
    },
  });
  expect(orderResponse.ok()).toBeTruthy();
  const order = (await orderResponse.json()).data;
  return { company, order };
}

test('水单收款：订单号定位、上传、确认入账并按公司统计', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const stamp = Date.now();
  const { company, order } = await seedCompanyOrder(page, stamp);
  const orderNo = String(order.order_no);

  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '水单', exact: true }).click();
    await expect(page.getByText('水单收款', { exact: true })).toBeVisible();

    const lookup = page.getByLabel('查找订单');
    await lookup.fill(orderNo);
    await expect(page.locator('.water-slip-selected-order')).toContainText(orderNo);
    await expect(page.locator('.water-slip-selected-order')).toContainText(company.shortName);

    // 客户、收件人、金额都能用来查找订单。
    await lookup.fill('水单收件人');
    await page.locator('.water-slip-candidate', { hasText: orderNo }).click();
    await expect(page.locator('.water-slip-selected-order')).toContainText(orderNo);
    await lookup.fill('100');
    await page.locator('.water-slip-candidate', { hasText: orderNo }).click();
    await expect(page.locator('.water-slip-selected-order')).toContainText(orderNo);

    await page.locator('.water-slip-upload input[type=file]').setInputFiles({ name: `水单-${stamp}.png`, mimeType: 'image/png', buffer: PNG_1X1 });
    await page.locator('.water-slip-form label', { hasText: '付款金额' }).locator('input').fill('40');
    await page.getByRole('button', { name: '保存水单' }).click();

    await expect(page.getByText(/水单已保存到/)).toBeVisible();
    const pendingRow = page.locator('.water-slip-table tbody tr', { hasText: orderNo });
    await expect(pendingRow).toContainText('待确认');
    await expect(pendingRow).toContainText('¥40.00');

    await pendingRow.getByRole('button', { name: '确认入账' }).click();
    await expect(page.getByText('水单已确认入账')).toBeVisible();
    await expect(page.locator('.water-slip-table tbody tr', { hasText: orderNo })).toContainText('已入账');

    const companyCard = page.locator('.water-slip-company-card', { hasText: company.shortName });
    await expect(companyCard).toContainText('¥40.00');
    await expect(companyCard).toContainText('1 笔已入账');

    // 公司筛选后仍能看到这笔水单。
    await page.getByLabel('公司筛选').selectOption(String(company.id));
    await expect(page.locator('.water-slip-table tbody tr', { hasText: orderNo })).toBeVisible();

    // 财务台账按公司筛选，并在详情里显示公司。
    await page.locator('.sidebar-nav').getByRole('button', { name: '财务', exact: true }).click();
    await page.getByLabel('收款公司').selectOption(String(company.id));
    const financeRow = page.locator('tbody tr', { hasText: orderNo });
    await expect(financeRow).toContainText(company.shortName);
    await financeRow.getByRole('button', { name: '查看财务' }).click();
    const financeDialog = page.getByRole('dialog', { name: /财务详情/ });
    await expect(financeDialog).toContainText(company.shortName);
    await expect(financeDialog).toContainText(`开票公司：${company.shortName}`);
    await financeDialog.locator('.finance-detail-summary').getByTitle('复制开票信息（可直接发给客户）').click();
    await expect(page.getByText(`已复制「${company.shortName}」开票信息，可直接发给客户`)).toBeVisible();
    const copiedInvoiceInfo = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiedInvoiceInfo).toContain(`公司名称：${company.fullName}`);
    expect(copiedInvoiceInfo).toContain(`纳税人识别号：${company.taxNo}`);
  } finally {
    await page.request.delete(`/api/orders/${order.id}`);
    await page.request.delete(`/api/finance/companies/${company.id}`);
  }
});

test('水单收款：公司档案可在财务模块新增和停用', async ({ page }) => {
  const stamp = Date.now();
  const name = `档案公司${stamp}`;
  let companyId: number | undefined;
  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '财务', exact: true }).click();
    await page.getByRole('button', { name: '公司档案' }).click();
    const manager = page.getByRole('dialog', { name: '公司档案' });
    await expect(manager).toBeVisible();
    await manager.getByRole('button', { name: '新增公司' }).click();
    const fullName = `${name}全称`;
    await manager.getByLabel('公司名称').fill(fullName);
    await manager.getByRole('button', { name: '保存公司' }).click();
    await expect(manager.locator('.company-row', { hasText: name })).toBeVisible();

    const listResponse = await page.request.get('/api/finance/companies?includeInactive=1');
    const created = (await listResponse.json()).data.items.find((item: { fullName: string; id: number }) => item.fullName === fullName);
    companyId = created?.id;
    expect(companyId).toBeTruthy();

    await manager.locator('.company-row', { hasText: name }).getByTitle('编辑公司').click();
    await manager.locator('.company-form-check input').uncheck();
    await manager.getByRole('button', { name: '保存公司' }).click();
    await expect(manager.locator('.company-row', { hasText: name })).toContainText('已停用');
  } finally {
    if (companyId) await page.request.delete(`/api/finance/companies/${companyId}`);
  }
});

test('水单收款手机端不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '更多模块' }).click();
  await page.locator('.sidebar-nav').getByRole('button', { name: '水单', exact: true }).click();
  await expect(page.getByText('水单收款', { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator('.water-slip-stat-grid')).toBeVisible();
});
