import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

function localDateISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

test.describe('备货模块', () => {
  test('待备货订单按供应商分组生成备货表，可补关联并标记已备货', async ({ page }) => {
    const stamp = Date.now();
    const today = localDateISO();

    const productResponse = await page.request.post('/api/products', {
      data: {
        name: `E2E冲压脚${stamp}`,
        specification: '58款',
        sku: '',
        supplier: 'E2E大公2',
        status: 'active',
        packaging: [{ name: '彩盒', innerSize: '', innerWeight: 0, outerSize: '', outerWeight: 0, packCount: 100 }],
      },
    });
    expect(productResponse.ok()).toBeTruthy();
    const systemProduct = (await productResponse.json()).data;

    const customerResponse = await page.request.post('/api/customers', {
      data: { name: `E2E备货客户${stamp}`, contactName: '联系人', contactPhone: '13900000000', shippingInfo: '广州市' },
    });
    expect(customerResponse.ok()).toBeTruthy();
    const customer = (await customerResponse.json()).data;

    // 手工创建一条未关联系统产品的临时客户产品，订单明细挂在该产品上
    const tempProductResponse = await page.request.post(`/api/customers/${customer.id}/products`, {
      data: { name: `E2E手填品${stamp}`, specification: '黑色', sku: '', packCount: null, finalPriceCents: null },
    });
    expect(tempProductResponse.ok()).toBeTruthy();
    const tempCustomerProduct = (await tempProductResponse.json()).data;

    const orderResponse = await page.request.post('/api/orders', {
      data: {
        orderNo: '',
        customerId: customer.id,
        orderedAt: `${today}T08:00:00.000Z`,
        recipientName: '联系人',
        recipientInfo: '广州市',
        amount: 0,
        trackingNo: '',
        paymentNote: '',
        remark: '',
        items: [{ name: `E2E手填品${stamp}`, sku: '', specification: '黑色', quantity: 4, unitPriceCents: 100, customerProductId: tempCustomerProduct.id }],
      },
    });
    expect(orderResponse.ok()).toBeTruthy();
    const order = (await orderResponse.json()).data;
    const orderId = Number(order.id ?? order.order_id);

    try {
      await page.goto('/');
      await page.getByRole('button', { name: '备货', exact: true }).click();
      await expect(page.getByLabel('按下单日期筛选')).toBeVisible();
      await expect(page.getByRole('button', { name: '标记已备货' }).first()).toBeVisible();
      // 其他用例可能泄漏待备货订单，所有断言只作用于本用例自己的数据
      const myRow = page.locator('.stock-group .stock-item', { hasText: `E2E手填品${stamp}` });
      await expect(myRow).toBeVisible();
      await expect(page.getByText('未关联产品', { exact: true })).toBeVisible();

      // 未关联明细就地补关联：选择系统产品并填写报供名称
      await myRow.getByRole('button', { name: '关联产品' }).click();
      const linkDialog = page.getByRole('dialog', { name: '关联系统产品' });
      await expect(linkDialog).toBeVisible();
      // 搜索框一键清空：输入后出现小叉，点一下清空，再重新搜索
      const searchBox = linkDialog.getByRole('textbox', { name: '搜索系统产品' });
      await searchBox.fill('E2E');
      await linkDialog.getByRole('button', { name: '清空搜索' }).click();
      await expect(searchBox).toHaveValue('');
      await searchBox.fill(`E2E冲压脚${stamp}`);
      await linkDialog.getByRole('button', { name: new RegExp(`E2E冲压脚${stamp}`) }).first().click();
      await linkDialog.getByRole('textbox', { name: '供应商产品名称' }).fill(`E2E报供名${stamp}`);
      await linkDialog.getByRole('button', { name: '保存关联' }).click();

      const supplierGroup = page.locator('.stock-group', { hasText: 'E2E大公2' });
      await expect(supplierGroup.getByText(`E2E报供名${stamp}`)).toBeVisible();
      await expect(supplierGroup.locator('.stock-item-spec')).toContainText('黑色 × 4');
      await expect(page.getByText(`E2E手填品${stamp}`)).toHaveCount(0);

      // 标记已备货：本单离开备货表
      await page.getByRole('button', { name: '标记已备货' }).first().click();
      const confirmDialog = page.getByRole('dialog', { name: '标记已备货' });
      await expect(confirmDialog).toBeVisible();
      // 存在未单独确认的供应商时按钮文案为「仍然标记」，两种文案都应可完成整页标记。
      await confirmDialog.getByRole('button', { name: /确认标记|仍然标记/ }).click();
      await expect(page.getByText(`E2E报供名${stamp}`)).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/orders/${orderId}`);
      await page.request.delete(`/api/customer-products/${tempCustomerProduct.id}`);
      await page.request.delete(`/api/customers/${customer.id}`);
      await page.request.delete(`/api/products/${systemProduct.id}`);
    }
  });

  test('供应商确认备货只推进只涉及该供应商的订单，跨供应商订单留给整页标记', async ({ page }) => {
    const stamp = Date.now();
    const today = localDateISO();
    const supplierA = `E2E供应商A${stamp}`;
    const supplierB = `E2E供应商B${stamp}`;
    const createSystemProduct = async (name: string, supplier: string) => {
      const response = await page.request.post('/api/products', {
        data: {
          name, specification: '58款', sku: '', supplier, status: 'active',
          packaging: [{ name: '彩盒', innerSize: '', innerWeight: 0, outerSize: '', outerWeight: 0, packCount: 100 }],
        },
      });
      expect(response.ok()).toBeTruthy();
      return (await response.json()).data;
    };
    const productA = await createSystemProduct(`E2E产品A${stamp}`, supplierA);
    const productB = await createSystemProduct(`E2E产品B${stamp}`, supplierB);
    const customer = (await (await page.request.post('/api/customers', {
      data: { name: `E2E确认客户${stamp}`, contactName: '', contactPhone: '', shippingInfo: '' },
    })).json()).data;
    const createCustomerProduct = async (systemProductId: number, supplierProductName: string, specification: string) => {
      const response = await page.request.post(`/api/customers/${customer.id}/products/from-library/complete`, {
        data: { systemProductId, name: supplierProductName, supplierProductName, specification, sku: '', packCount: null, finalPriceCents: null },
      });
      expect(response.ok()).toBeTruthy();
      return (await response.json()).data;
    };
    const customerProductA = await createCustomerProduct(productA.id, `E2E报供A${stamp}`, '58款');
    const customerProductB = await createCustomerProduct(productB.id, `E2E报供B${stamp}`, '30款');
    const createOrder = async (items: Array<Record<string, unknown>>) => {
      const response = await page.request.post('/api/orders', {
        data: {
          orderNo: '', customerId: customer.id, orderedAt: `${today}T08:00:00.000Z`,
          recipientName: '张三', recipientInfo: '广州市', amount: 0, trackingNo: '', paymentNote: '', remark: '', items,
        },
      });
      if (!response.ok()) throw new Error(`创建订单失败：${response.status()} ${await response.text()}`);
      return Number((await response.json()).data.id);
    };
    // 订单一：只涉及供应商 A；订单二：同时涉及 A、B。
    const orderAId = await createOrder([{ name: '', sku: '', specification: '58款', quantity: 4, unitPriceCents: 100, customerProductId: customerProductA.id }]);
    const orderABId = await createOrder([
      { name: '', sku: '', specification: '58款', quantity: 2, unitPriceCents: 100, customerProductId: customerProductA.id },
      { name: '', sku: '', specification: '30款', quantity: 3, unitPriceCents: 100, customerProductId: customerProductB.id },
    ]);

    try {
      await page.goto('/');
      await page.getByRole('button', { name: '备货', exact: true }).click();
      const groupA = page.locator('.stock-group', { hasText: supplierA });
      await expect(groupA).toBeVisible();
      // 同品名同规格合并数量：订单一 4 + 订单二 2
      await expect(groupA.locator('.stock-item-spec')).toContainText('58款 × 6');

      await groupA.getByRole('button', { name: '确认备货' }).click();
      const dialog = page.getByRole('dialog', { name: '确认备货' });
      await expect(dialog).toContainText('1 张只涉及该供应商的订单');
      await expect(dialog).toContainText('1 张订单还涉及其他供应商');
      await dialog.getByRole('button', { name: '确定' }).click();

      // 只涉及 A 的订单推进到已备货；跨供应商订单留在备货表里（A 组剩 2 件）
      await expect(groupA.locator('.stock-item-spec')).toContainText('58款 × 2');
      const orderADetail = (await (await page.request.get(`/api/orders/${orderAId}/detail`)).json()).data;
      expect(orderADetail.status).toBe('stock_reported');
      const orderABDetail = (await (await page.request.get(`/api/orders/${orderABId}/detail`)).json()).data;
      expect(orderABDetail.status).toBe('pending_stock');
      await expect(page.locator('.stock-group', { hasText: supplierB }).locator('.stock-item-spec')).toContainText('30款 × 3');
    } finally {
      await page.request.delete(`/api/orders/${orderABId}`);
      await page.request.delete(`/api/orders/${orderAId}`);
      await page.request.delete(`/api/customer-products/${customerProductB.id}`);
      await page.request.delete(`/api/customer-products/${customerProductA.id}`);
      await page.request.delete(`/api/customers/${customer.id}`);
      await page.request.delete(`/api/products/${productB.id}`);
      await page.request.delete(`/api/products/${productA.id}`);
    }
  });

  test('备货表支持切换到全部待备货', async ({ page }) => {
    const stamp = Date.now();
    const customerResponse = await page.request.post('/api/customers', {
      data: { name: `E2E导出客户${stamp}`, contactName: '', contactPhone: '', shippingInfo: '' },
    });
    expect(customerResponse.ok()).toBeTruthy();
    const customer = (await customerResponse.json()).data;
    const orderResponse = await page.request.post('/api/orders', {
      data: {
        orderNo: '',
        customerId: customer.id,
        orderedAt: `${localDateISO()}T08:00:00.000Z`,
        recipientName: '联系人',
        recipientInfo: '',
        amount: 0,
        trackingNo: '',
        paymentNote: '',
        remark: '',
        items: [{ name: `E2E导出品${stamp}`, sku: '', specification: '', quantity: 2, unitPriceCents: 100 }],
      },
    });
    expect(orderResponse.ok()).toBeTruthy();
    const order = (await orderResponse.json()).data;
    const orderId = Number(order.id ?? order.order_id);

    try {
      await page.goto('/');
      await page.getByRole('button', { name: '备货', exact: true }).click();
      await expect(page.getByText(`E2E导出品${stamp}`)).toBeVisible();

      await page.getByRole('button', { name: '全部', exact: true }).click();
      await expect(page.getByLabel('按下单日期筛选')).toBeDisabled();
      await expect(page.getByText(`E2E导出品${stamp}`)).toBeVisible();
    } finally {
      await page.request.delete(`/api/orders/${orderId}`);
      await page.request.delete(`/api/customers/${customer.id}`);
    }
  });
});
