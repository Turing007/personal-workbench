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

    await modal.locator('button[title="数量区间价"]').first().click();
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

// 重构护栏（第 3 步）：明细弹窗打开时产品详情走批量接口，不再逐行 N+1。
test('报价明细取数：多行产品一次批量拉取', async ({ page, request }) => {
  test.setTimeout(60_000);
  const stamp = Date.now();
  const productIds: number[] = [];
  let quotationId: number | undefined;
  const productRequests: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/products')) productRequests.push(url);
  });

  try {
    for (let index = 0; index < 2; index += 1) {
      const response = await page.request.post('/api/products', {
        data: { name: `批量取数产品${stamp}-${index}`, sku: `BATCH-${stamp}-${index}`, specification: '21V', status: 'active', category: '电动工具', batteryVoltage: '21V', packaging: [{ name: '彩盒', packCount: 10, innerWeight: 0.8, outerSize: '50×40×30', purchasePrice: 5 }] },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      productIds.push(((await response.json()).data as { id: number }).id);
    }
    const quoteResponse = await page.request.post('/api/quotations', {
      data: {
        quotationDate: new Date().toISOString().slice(0, 10),
        customerName: `批量客户${stamp}`,
        contactName: '', contactPhone: '', customerAddress: '',
        validUntil: '', remark: '', taxRateBps: 0, pricingBasis: 'shipping_ex_tax',
        companySnapshot: { name: '测试公司', logoRelativePath: null, phone: '', address: '', defaultIssuer: '', wechatQrRelativePath: null },
        displayConfig: { showLogo: false, showCompanyPhone: false, showCompanyAddress: false, showContactPhone: false, showTax: true, showTaxIncludedTotal: true, columns: { image: true, name: true, specification: true, unitPrice: true, tierPrice: true, remark: true } },
        items: productIds.map((productId, index) => ({ productId, isTemporary: false, name: `批量取数产品${stamp}-${index}`, sku: `BATCH-${stamp}-${index}`, specification: '21V', parameters: '', unitPriceCents: 100, remark: '', sortOrder: index })),
        customFields: [],
      },
    });
    expect(quoteResponse.ok()).toBeTruthy();
    quotationId = ((await quoteResponse.json()).data as { id: number }).id;

    await page.goto('/');
    await page.getByRole('button', { name: '报价单', exact: true }).click();
    await page.locator('.quotation-toolbar .search-control input').fill(`批量客户${stamp}`);
    await page.locator('.quotation-table-desktop tbody tr', { hasText: `批量客户${stamp}` }).getByTitle('编辑报价单').click();
    productRequests.length = 0;
    await page.getByRole('button', { name: '编辑产品明细' }).click();
    const modal = page.getByRole('dialog', { name: '产品明细' });
    await expect(modal).toBeVisible();
    // 两行产品详情就绪（电池下拉出现裸机选项 = 产品已加载）
    await expect(modal.getByLabel('电池配置').first()).toContainText('裸机');
    const batchRequests = productRequests.filter((url) => url.includes('/api/products?ids='));
    const singleRequests = productRequests.filter((url) => /\/api\/products\/\d+/.test(url));
    expect(batchRequests.length).toBe(1);
    expect(singleRequests.length).toBe(0);
    expect(batchRequests[0]).toContain(productIds.join(','));
  } finally {
    if (quotationId) await authDelete(request, `/api/quotations/${quotationId}`, { confirmed: true });
    for (const productId of productIds) await authDelete(request, `/api/products/${productId}`);
  }
});

// 重构护栏（第 0 步）：手改价保留/恢复、复制行、切换价格口径。
// 与上一个用例同文件串行，避免并行争抢全局电池矩阵。
test('报价明细护栏：手改价保留与恢复、复制行、切换价格口径', async ({ page, request }) => {
  test.setTimeout(90_000);
  const stamp = Date.now();
  const originalMatrixResponse = await page.request.get('/api/settings/battery-price-matrix');
  const originalMatrix = (await originalMatrixResponse.json()).data;
  let productId: number | undefined;
  let quotationId: number | undefined;

  try {
    const matrix = { capacities: [1300, 1500, 2000], packCounts: [5, 10, 15, 20], prices: [[11, 12, 13, 14], [15, 16, 17, 18], [19, 20, 21, 22]] };
    expect((await page.request.put('/api/settings/battery-price-matrix', { data: matrix })).ok()).toBeTruthy();

    const productResponse = await page.request.post('/api/products', {
      data: {
        name: `报价护栏电钻${stamp}`,
        sku: `QGRD-${stamp}`,
        specification: '21V 4.0Ah',
        status: 'active',
        category: '电动工具',
        batteryVoltage: '21V',
        purchaseQuotes: [{ supplier: '护栏供应商', variant: '标准', price: 100, isDefault: true }],
        packaging: [{ name: '彩盒', packCount: 10, innerWeight: 0.8, outerSize: '50×40×30', purchasePrice: 5 }],
        accessoryPrices: [{ name: '锯片', price: 3, weight: 0.1 }],
      },
    });
    expect(productResponse.ok()).toBeTruthy();
    const product = (await productResponse.json()).data;
    productId = product.id;

    const quoteResponse = await page.request.post('/api/quotations', {
      data: {
        quotationDate: new Date().toISOString().slice(0, 10),
        customerName: `护栏客户${stamp}`,
        contactName: '', contactPhone: '', customerAddress: '',
        validUntil: '', remark: '',
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

    await page.goto('/');
    await page.getByRole('button', { name: '报价单', exact: true }).click();
    await page.locator('.quotation-toolbar .search-control input').fill(String(quote.number));
    await page.locator('.quotation-table-desktop tbody tr', { hasText: String(quote.number) }).getByTitle('编辑报价单').click();
    await page.getByRole('button', { name: '编辑产品明细' }).click();
    const modal = page.getByRole('dialog', { name: '产品明细' });
    await expect(modal).toBeVisible();

    // 选电池 → 自动价；手改 999 → 标记已手改；换配置不覆盖手改价
    await modal.getByLabel('电池配置').selectOption({ label: '10节 1500mAh 两电一充' });
    const priceInput = modal.getByLabel('单价').first();
    await expect(priceInput).not.toHaveValue('1.00');
    await priceInput.fill('999');
    const restoreButton = modal.getByTitle('恢复自动价');
    await expect(restoreButton).toBeVisible();
    await modal.getByLabel('电池配置').selectOption({ label: '5节 1300mAh 一电一充' });
    await expect(priceInput).toHaveValue('999');

    // 恢复自动价 → 回到当前配置的自动价
    await restoreButton.click();
    await expect(restoreButton).toHaveCount(0);
    await expect(priceInput).not.toHaveValue('999');
    const autoPrice = Number(await priceInput.inputValue());
    expect(autoPrice).toBeGreaterThan(0);

    // 复制行 → 配置与价格一起复制
    await modal.getByTitle('复制产品行').first().click();
    await expect(modal.getByLabel('单价')).toHaveCount(2);
    await expect(modal.getByLabel('单价').nth(1)).toHaveValue(autoPrice.toFixed(2));
    await expect(modal.getByLabel('电池配置').nth(1)).toHaveValue('5-1300-1');

    // 切换价格口径（含运含税）→ 重开后自动价含税抬升
    await modal.getByRole('button', { name: '完成' }).click();
    await page.getByLabel('价格口径').selectOption({ label: '含运含税' });
    await page.getByRole('button', { name: '编辑产品明细' }).click();
    await expect(modal).toBeVisible();
    await expect(modal.getByLabel('单价').first()).not.toHaveValue(autoPrice.toFixed(2));
    const taxedPrice = Number(await modal.getByLabel('单价').first().inputValue());
    expect(taxedPrice).toBeGreaterThan(autoPrice);
    await modal.getByRole('button', { name: '完成' }).click();
    await page.getByRole('button', { name: '保存报价单' }).click();
    await expect(page.getByText('报价单已保存', { exact: true })).toBeVisible();

    const detail = (await (await page.request.get(`/api/quotations/${quotationId}`)).json()).data;
    expect(detail.pricingBasis).toBe('shipping_inc_tax');
    expect(detail.items).toHaveLength(2);
    expect(detail.items[0].configuration.priceOverridden).toBe(false);
    expect(detail.items[0].configuration.priceBasis).toBe('shipping_inc_tax');
    expect(detail.items[0].unitPriceCents).toBe(detail.items[0].configuration.computedSalePriceCents);
    expect(detail.items[1].configuration.label).toBe(detail.items[0].configuration.label);
    expect(detail.items[1].unitPriceCents).toBe(detail.items[0].unitPriceCents);
  } finally {
    if (quotationId) await authDelete(request, `/api/quotations/${quotationId}`, { confirmed: true });
    if (productId) await authDelete(request, `/api/products/${productId}`);
    await request.put('/api/settings/battery-price-matrix', {
      headers: { Cookie: `wb_session=${sessionCookie}` },
      data: originalMatrix,
    });
  }
});
