import { expect, test, type APIRequestContext } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

async function seedOrder(request: APIRequestContext): Promise<void> {
  const orderNo = `E2E-${Date.now()}`;
  const response = await request.post('/api/orders', {
    data: {
      orderNo,
      orderedAt: new Date().toISOString().slice(0, 10),
      recipientName: 'e2e 收件人',
      recipientInfo: 'e2e 收件人 13800000000 e2e 测试地址',
      items: [{ name: 'e2e 测试产品', quantity: 2, packCount: 1, unitPriceCents: 500 }],
    },
  });
  if (!response.ok()) throw new Error(`e2e 造数失败：HTTP ${response.status()} ${await response.text()}`);
}

test.describe('财务管理工作台', () => {
  let sessionCookie: string;

  test.beforeAll(async ({ request }) => {
    sessionCookie = await ensureAuthenticated(request);
    await seedOrder(request);
  });

  test.beforeEach(async ({ context }) => {
    await injectSession(context, sessionCookie);
  });

  test('显示财务列表、统计卡和订单财务详情', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: '财务管理' })).toBeVisible();
    await page.getByRole('button', { name: '财务管理' }).click();

    await expect(page.getByText('核验客户水单、登记收款并跟踪发票')).toBeVisible();
    await expect(page.getByText('本期应收')).toBeVisible();
    await expect(page.getByText('待审核水单')).toBeVisible();
    await expect(page.getByRole('textbox', { name: '搜索订单号或客户' })).toBeVisible();

    const financeButtons = page.getByRole('button', { name: '查看财务' });
    if (await financeButtons.count() > 0) {
      await financeButtons.first().click();
      await expect(page.getByRole('dialog', { name: /财务详情/ })).toBeVisible();
      await expect(page.getByText('客户水单', { exact: true })).toBeVisible();
      await expect(page.getByText('发票跟踪', { exact: true })).toBeVisible();
    }
  });

  test('订单详情显示财务详情入口', async ({ page }) => {
    const stamp = Date.now();
    const customerResponse = await page.request.post('/api/customers', {
      data: { name: `E2E财务入口客户${stamp}`, contactName: '联系人', contactPhone: '13700000000', shippingInfo: '北京市朝阳区' },
    });
    expect(customerResponse.ok()).toBeTruthy();
    const customer = (await customerResponse.json()).data;
    const orderResponse = await page.request.post('/api/orders', {
      data: {
        orderNo: '',
        orderedAt: new Date().toISOString(),
        customerId: customer.id,
        recipientName: '联系人',
        recipientInfo: '北京市朝阳区',
        amount: 100,
        trackingNo: '',
        paymentNote: '',
        remark: '',
        items: [{ name: 'E2E产品', sku: `E2E-FIN-${stamp}`, specification: '标准', packagingName: '', packCount: 10, quantity: 10, unitPriceCents: 1000 }],
      },
    });
    expect(orderResponse.ok()).toBeTruthy();
    const order = (await orderResponse.json()).data;
    const orderId = Number(order.id ?? order.order_id);

    try {
      await page.goto('/');
      const orderNav = page.getByRole('button', { name: '订单管理' });
      await expect(orderNav).toBeVisible();
      await orderNav.click();
      const orderRow = page.locator('tbody tr', { hasText: String(order.order_no) });
      await orderRow.getByRole('button', { name: '详情' }).click();
      await expect(page.getByRole('dialog', { name: /订单详情/ })).toBeVisible();
      await expect(page.getByRole('button', { name: '打开财务详情' })).toBeVisible();
    } finally {
      await page.request.delete(`/api/orders/${orderId}`);
      await page.request.delete(`/api/customers/${customer.id}`);
    }
  });

  test('客户开票信息自动带入，并可通过“调用客户开票信息”刷新', async ({ page }) => {
    const stamp = Date.now();
    const name = `E2E开票客户${stamp}`;
    const customerResponse = await page.request.post('/api/customers', {
      data: {
        name,
        contactName: '开票联系人',
        contactPhone: '13800000000',
        shippingInfo: '上海市浦东新区',
        invoiceTitle: `抬头${stamp}`,
        taxNo: `91310000${stamp}`,
      },
    });
    expect(customerResponse.ok()).toBeTruthy();
    const customer = (await customerResponse.json()).data;

    const orderResponse = await page.request.post('/api/orders', {
      data: {
        orderNo: '',
        orderedAt: new Date().toISOString(),
        customerId: customer.id,
        recipientName: '开票联系人',
        recipientInfo: '上海市浦东新区',
        amount: 100,
        trackingNo: '',
        paymentNote: '',
        remark: '',
        items: [{ name: 'E2E产品', sku: `E2E-${stamp}`, specification: '标准', packagingName: '', packCount: 10, quantity: 10, unitPriceCents: 1000 }],
      },
    });
    expect(orderResponse.ok()).toBeTruthy();
    const order = (await orderResponse.json()).data;
    const orderId = Number(order.id ?? order.order_id);

    await page.goto('/');
    await page.getByRole('button', { name: '财务管理' }).click();
    await page.getByRole('textbox', { name: '搜索订单号或客户' }).fill(name);
    await page.getByRole('button', { name: '查看财务' }).first().click();

    const dialog = page.getByRole('dialog', { name: /财务详情/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByPlaceholder('发票抬头')).toHaveValue(`抬头${stamp}`);
    await expect(dialog.getByPlaceholder('税号')).toHaveValue(`91310000${stamp}`);
    await expect(dialog.getByRole('button', { name: '调用客户开票信息' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '调用客户开票信息' })).toBeEnabled();

    const updateResponse = await page.request.put(`/api/customers/${customer.id}`, {
      data: {
        name,
        contactName: '开票联系人',
        contactPhone: '13800000000',
        shippingInfo: '上海市浦东新区',
        invoiceTitle: `新抬头${stamp}`,
        taxNo: `99991000${stamp}`,
      },
    });
    expect(updateResponse.ok()).toBeTruthy();

    await dialog.getByRole('button', { name: '调用客户开票信息' }).click();
    await expect(dialog.getByPlaceholder('发票抬头')).toHaveValue(`新抬头${stamp}`);
    await expect(dialog.getByPlaceholder('税号')).toHaveValue(`99991000${stamp}`);

    await page.request.delete(`/api/orders/${orderId}`);
    await page.request.delete(`/api/customers/${customer.id}`);
  });
});
