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

test.describe('订单对公/对私结算与开票状态', () => {
  test('新建订单默认对私，对私订单在订单页与财务模块显示无需开票', async ({ page }) => {
    const stamp = Date.now();
    const name = `E2E结算客户${stamp}`;

    const customerResponse = await page.request.post('/api/customers', {
      data: { name, contactName: '结算联系人', contactPhone: '13900000000', shippingInfo: '杭州市西湖区' },
    });
    expect(customerResponse.ok()).toBeTruthy();
    const customer = (await customerResponse.json()).data;

    const createOrder = async (settlementType: string) => {
      const response = await page.request.post('/api/orders', {
        data: {
          orderNo: '',
          // 必须用本地日期：toISOString 取的是 UTC 日期，北京时间 0–8 点会落到前一天，
          // 于是订单进了上月，财务页按月筛选就查不到（这个用例深夜跑是绿的，早上跑就红）。
          orderedAt: dateInputValue(),
          customerId: customer.id,
          recipientName: '结算联系人',
          recipientInfo: '杭州市西湖区',
          amount: 100,
          trackingNo: '',
          paymentNote: '',
          remark: '',
          settlementType,
          items: [{ name: 'E2E结算产品', sku: `E2E-ST-${stamp}`, specification: '标准', packagingName: '', packCount: 10, quantity: 10, unitPriceCents: 1000 }],
        },
      });
      expect(response.ok()).toBeTruthy();
      const order = (await response.json()).data;
      return { id: Number(order.id ?? order.order_id), orderNo: String(order.order_no) };
    };
    const personalOrder = await createOrder('personal');
    const corporateOrder = await createOrder('corporate');

    // 订单表单：新建订单默认对私（历史订单仍按各自已存的值显示）
    await page.goto('/');
    await page.getByRole('button', { name: '订单', exact: true }).click();
    await page.getByRole('button', { name: '新建订单' }).click();
    const formDialog = page.getByRole('dialog', { name: '新建订单' });
    await expect(formDialog.getByRole('combobox', { name: '结算方式' })).toHaveValue('personal');
    await formDialog.getByRole('button', { name: '取消' }).click();

    // 订单页列表：对私显示无需开票，对公显示未申请
    const personalRow = page.locator('tbody tr', { hasText: personalOrder.orderNo });
    await expect(personalRow).toContainText('无需开票');
    await expect(personalRow).toContainText('对私');
    const corporateRow = page.locator('tbody tr', { hasText: corporateOrder.orderNo });
    await expect(corporateRow).toContainText('未申请');
    await expect(corporateRow).toContainText('对公');

    // 财务模块：对私发票列显示无需开票，详情隐藏新建开票申请
    await page.getByRole('button', { name: '财务', exact: true }).click();
    await page.getByRole('textbox', { name: '搜索订单号或客户' }).fill(name);
    const financePersonalRow = page.locator('tbody tr', { hasText: personalOrder.orderNo });
    await expect(financePersonalRow).toContainText('无需开票');
    // 列位置回归：发票列(第9格)显示无需开票，物流列(第10格)不得出现开票文案
    await expect(financePersonalRow.locator('td').nth(8)).toContainText('无需开票');
    await expect(financePersonalRow.locator('td').nth(9)).not.toContainText('无需开票');
    await financePersonalRow.getByRole('button', { name: '查看财务' }).click();
    const financeDialog = page.getByRole('dialog', { name: /财务详情/ });
    await expect(financeDialog).toBeVisible();
    await expect(financeDialog.getByText('该订单为对私结算，无需开票')).toBeVisible();
    await expect(financeDialog.getByRole('button', { name: '新建开票申请' })).toHaveCount(0);

    await page.request.delete(`/api/orders/${personalOrder.id}`);
    await page.request.delete(`/api/orders/${corporateOrder.id}`);
    await page.request.delete(`/api/customers/${customer.id}`);
  });
});
