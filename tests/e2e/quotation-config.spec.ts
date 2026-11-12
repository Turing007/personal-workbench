import { expect, test, type APIRequestContext } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

async function authDelete(request: APIRequestContext, path: string, data?: Record<string, unknown>) {
  const response = await request.delete(path, {
    headers: { Cookie: `wb_session=${sessionCookie}` },
    ...(data ? { data } : {}),
  });
  if (!response.ok() && response.status() !== 404) throw new Error(`清理失败：DELETE ${path} -> ${response.status()}`);
}

test('报价明细配置表格：选电池和配件后自动算价，保存并转销售单保留配置', async ({ page, request }) => {
  const stamp = Date.now();
  const originalMatrixResponse = await page.request.get('/api/settings/battery-price-matrix');
  const originalMatrix = (await originalMatrixResponse.json()).data;
  let productId: number | undefined;
  let quotationId: number | undefined;
  let salesId: number | undefined;

  try {
    const matrix = { capacities: [1300, 1500, 2000], packCounts: [5, 10, 15, 20], prices: [[11, 12, 13, 14], [15, 16, 17, 18], [19, 20, 21, 22]] };
    expect((await page.request.put('/api/settings/battery-price-matrix', { data: matrix })).ok()).toBeTruthy();

    const productResponse = await page.request.post('/api/products', {
      data: {
        name: `报价配置电钻${stamp}`,
        sku: `QCFG-${stamp}`,
        specification: '21V 4.0Ah',
        status: 'active',
        category: '电动工具',
        batteryVoltage: '21V',
        purchaseQuotes: [{ supplier: '配置供应商', variant: '标准', price: 100, isDefault: true }],
        packaging: [{ name: '彩盒', packCount: 10, innerWeight: 0.8, outerSize: '50×40×30', purchasePrice: 5 }],
        accessoryPrices: [{ name: '锯片', price: 3, weight: 0.1 }, { name: '钻头', price: 2, weight: 0.05 }],
      },
    });
    expect(productResponse.ok()).toBeTruthy();
    const product = (await productResponse.json()).data;
    productId = product.id;

    const quoteResponse = await page.request.post('/api/quotations', {
      data: {
        quotationDate: new Date().toISOString().slice(0, 10),
        customerName: `配置客户${stamp}`,
        contactName: '王经理',
        contactPhone: '13800000000',
        customerAddress: '测试地址',
        validUntil: '',
        remark: '',
        taxRateBps: 1300,
        pricingBasis: 'shipping_ex_tax',
        companySnapshot: { name: '测试公司', logoRelativePath: null, phone: '', address: '', defaultIssuer: '', wechatQrRelativePath: null },
        displayConfig: { showLogo: false, showCompanyPhone: false, showCompanyAddress: false, showContactPhone: false, showTax: true, showTaxIncludedTotal: true, columns: { image: true, name: true, specification: true, unitPrice: true, tierPrice: true, remark: true } },
        items: [{ productId, isTemporary: false, name: product.name, sku: product.sku, specification: product.specification, parameters: '', unitPriceCents: 100, remark: '', sortOrder: 0 }],
        customFields: [],
      },
    });
    expect(quoteResponse.ok()).toBeTruthy();
    const quote = (await quoteResponse.json()).data;
    quotationId = quote.id;
    const quoteNumber = String(quote.number);

    await page.goto('/');
    await page.getByRole('button', { name: '报价单', exact: true }).click();
    await page.locator('tbody tr', { hasText: quoteNumber }).getByTitle('编辑报价单').click();
    await page.getByRole('button', { name: '编辑产品明细' }).click();
    const modal = page.getByRole('dialog', { name: '产品明细' });
    await expect(modal).toBeVisible();

    const batterySelect = modal.getByLabel('电池配置');
    await batterySelect.selectOption({ label: '10节 1500mAh 两电一充' });
    await expect(modal.getByLabel('单价').first()).not.toHaveValue('1.00');
    const beforeAccessory = Number(await modal.getByLabel('单价').first().inputValue());
    expect(beforeAccessory).toBeGreaterThan(100);

    await modal.getByRole('button', { name: '选择配件' }).click();
    await page.locator('.anchored-popover').last().locator('label', { hasText: '锯片' }).locator('input').check();
    await expect(modal.getByLabel('单价').first()).not.toHaveValue(String(beforeAccessory));
    await expect(modal).toContainText('kg');
    await expect(modal).toContainText('成本');

    await modal.locator('button[title="数量区间价 / 备注"]').first().click();
    await expect(modal.locator('.quotation-config-extra')).toBeVisible();
    await modal.getByRole('button', { name: '完成' }).click();
    await page.getByRole('button', { name: '保存报价单' }).click();
    await page.waitForTimeout(500);

    const detail = (await (await page.request.get(`/api/quotations/${quotationId}`)).json()).data;
    expect(detail.pricingBasis).toBe('shipping_ex_tax');
    expect(detail.items[0].configuration).toMatchObject({ mode: 'battery', priceBasis: 'shipping_ex_tax' });
    expect(detail.items[0].configuration.label).toContain('10节 1500mAh 两电一充');
    expect(detail.items[0].configuration.label).toContain('锯片');
    const savedPrice = detail.items[0].unitPriceCents;

    const statusResponse = await page.request.patch(`/api/quotations/${quotationId}/status`, { data: { status: 'won' } });
    expect(statusResponse.ok()).toBeTruthy();
    const salesResponse = await page.request.post(`/api/quotations/${quotationId}/copy-to-sales`, { data: {} });
    expect(salesResponse.ok()).toBeTruthy();
    const sales = (await salesResponse.json()).data;
    salesId = sales.id;
    expect(sales.pricingBasis).toBe('shipping_ex_tax');
    expect(sales.items[0].unitPriceCents).toBe(savedPrice);
    expect(sales.items[0].configuration.label).toContain('锯片');
  } finally {
    if (salesId) await authDelete(request, `/api/sales-documents/${salesId}`);
    if (quotationId) await authDelete(request, `/api/quotations/${quotationId}`, { confirmed: true });
    if (productId) await authDelete(request, `/api/products/${productId}`);
    await request.put('/api/settings/battery-price-matrix', {
      headers: { Cookie: `wb_session=${sessionCookie}` },
      data: originalMatrix,
    });
  }
});
