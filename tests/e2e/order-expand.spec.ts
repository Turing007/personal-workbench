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

async function seedOrder(page: import('@playwright/test').Page, orderNo: string) {
  const response = await page.request.post('/api/orders', {
    data: {
      orderNo,
      orderedAt: dateInputValue(),
      recipientName: '展开收件人',
      recipientInfo: '展开收件人 13800000000 广东省深圳市南山区科技园 A 栋 8 楼',
      items: [{ name: 'E2E展开产品', sku: `E2E-EXPAND-${Date.now()}`, specification: '12V 100Ah', packagingName: '彩盒包装', packCount: 1, quantity: 2, unitPriceCents: 5000 }],
    },
  });
  expect(response.ok()).toBeTruthy();
  const order = (await response.json()).data;
  return Number(order.id ?? order.order_id);
}

/** 上传并审核一笔水单，让订单满足发货前的全额收款条件；返回水单 ID 供清理。 */
async function payOrder(page: import('@playwright/test').Page, orderId: number, amountCents: number): Promise<number> {
  const upload = await page.request.post(`/api/finance/orders/${orderId}/proofs`, {
    multipart: {
      file: {
        name: `proof-${orderId}.png`,
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'),
      },
      amountCents: String(amountCents),
      paymentDate: dateInputValue(),
      paymentMethod: '银行转账',
      transactionNo: `TX-${orderId}-${Date.now()}`,
    },
  });
  expect(upload.ok()).toBeTruthy();
  const proofId = Number((await upload.json()).data.id);
  const approved = await page.request.post(`/api/finance/proofs/${proofId}/approve`, { data: {} });
  expect(approved.ok()).toBeTruthy();
  return proofId;
}

test('订单展开的产品明细带产品图', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = Date.now();
  const createdProduct = await page.request.post('/api/products', {
    data: { name: `E2E展开带图${stamp}`, specification: '12V 100Ah 高频纯正弦波', status: 'active', packaging: [{ name: '彩盒包装', packCount: 10, innerWeight: 0.5, outerSize: '40×30×25', outerWeight: 8 }] },
  });
  expect(createdProduct.ok()).toBe(true);
  const product = (await createdProduct.json()).data as { id: string };
  const uploaded = await page.request.post(`/api/products/${product.id}/images?category=product`, {
    multipart: { file: { name: `expand-${stamp}.png`, mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') } },
  });
  expect(uploaded.ok()).toBe(true);
  const createdCustomer = await page.request.post('/api/customers', {
    data: { name: `E2E展开客户${stamp}`, contactName: '图片收件人', contactPhone: '13800000000', shippingInfo: '广东省深圳市南山区' },
  });
  expect(createdCustomer.ok()).toBe(true);
  const customer = (await createdCustomer.json()).data as { id: number };
  const imported = await page.request.post(`/api/customers/${customer.id}/products/from-library`, { data: { systemProductId: Number(product.id) } });
  expect(imported.ok()).toBe(true);
  const customerProduct = (await imported.json()).data as { id: number };
  const createdOrder = await page.request.post('/api/orders', {
    data: {
      orderNo: `E2E-IMG-${stamp}`,
      orderedAt: dateInputValue(),
      customerId: customer.id,
      recipientName: '图片收件人',
      recipientInfo: '图片收件人 13800000000 广东省深圳市南山区',
      items: [{ customerProductId: customerProduct.id, name: '', sku: '', specification: '', quantity: 2, packCount: 1, unitPriceCents: 5000 }],
    },
  });
  expect(createdOrder.ok()).toBe(true);
  const order = (await createdOrder.json()).data;
  const orderId = Number(order.id ?? order.order_id);
  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(`E2E-IMG-${stamp}`);
    const row = page.locator('.orders-table-desktop tbody tr', { hasText: `E2E-IMG-${stamp}` }).first();
    await expect(page.locator('.orders-data-table thead')).not.toContainText('下单时间');
    await expect(row.locator('.order-no-cell')).toContainText(`E2E-IMG-${stamp}`);
    await expect(row.locator('.order-no-date')).toHaveText(dateInputValue());
    const productCell = row.locator('.order-product-cell');
    await expect(productCell).toContainText(`E2E展开带图${stamp}`);
    const desktopSpec = productCell.locator('.order-product-quick-spec');
    await expect(desktopSpec).toHaveText('12V 100Ah 高频纯正弦波 * 2');
    expect(await desktopSpec.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    await expect(productCell.locator('.order-product-quick-thumb img')).toHaveAttribute('src', /\/api\/thumbs\/240\//);
    const desktopSingle = await productCell.locator('.order-product-quick-list').evaluate((element) => {
      const card = element.querySelector('.order-product-quick-card')!;
      return { display: getComputedStyle(element).display, listWidth: element.getBoundingClientRect().width, cardWidth: card.getBoundingClientRect().width };
    });
    expect(desktopSingle.display).toBe('flex');
    expect(Math.abs(desktopSingle.cardWidth - desktopSingle.listWidth)).toBeLessThan(1.5);
    expect(await productCell.locator('.order-product-quick-thumb').first().evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width >= 48 && Math.abs(rect.width - rect.height) < 0.5;
    })).toBe(true);
    await productCell.locator('.order-product-quick-list').click();
    const productDialog = page.getByRole('dialog', { name: /产品明细/ });
    await expect(productDialog).toContainText(`E2E展开带图${stamp}`);
    await expect(productDialog).not.toContainText('包装快照');
    expect(await productDialog.locator('.order-detail-cards').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2);
    await productDialog.locator('.order-detail-card-media').click();
    const desktopImageDialog = page.getByRole('dialog', { name: /产品图片/ });
    await expect(desktopImageDialog.getByRole('button', { name: '关闭' })).toBeVisible();
    await desktopImageDialog.getByRole('button', { name: '关闭' }).click();
    await productDialog.getByRole('button', { name: '关闭' }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    const card = page.locator('.orders-card-list .order-card', { hasText: `E2E-IMG-${stamp}` }).first();
    const cardProducts = card.locator('.order-card-products');
    const mobileSpec = cardProducts.locator('.order-product-quick-spec');
    await expect(mobileSpec).toHaveText('12V 100Ah 高频纯正弦波 * 2');
    expect(await mobileSpec.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    await expect(cardProducts.locator('.order-product-quick-thumb img')).toBeVisible();
    const mobileSingle = await cardProducts.evaluate((element) => {
      const quickCard = element.querySelector('.order-product-quick-card')!;
      return { display: getComputedStyle(element).display, listWidth: element.getBoundingClientRect().width, cardWidth: quickCard.getBoundingClientRect().width };
    });
    expect(mobileSingle.display).toBe('flex');
    expect(Math.abs(mobileSingle.cardWidth - mobileSingle.listWidth)).toBeLessThan(1.5);
    await expect(card.locator('.order-expand-toggle')).toHaveCount(0);

    await cardProducts.click();
    const mobileProductDialog = page.getByRole('dialog', { name: /产品明细/ });
    expect(await mobileProductDialog.locator('.order-detail-cards').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1);
    await mobileProductDialog.locator('.order-detail-card-media').click();
    const mobileImageDialog = page.getByRole('dialog', { name: /产品图片/ });
    await expect(mobileImageDialog.getByRole('button', { name: '关闭' })).toBeVisible();
    await mobileImageDialog.getByRole('button', { name: '关闭' }).click();
    await mobileProductDialog.getByRole('button', { name: '关闭' }).click();
  } finally {
    await page.request.delete(`/api/orders/${orderId}`);
    await page.request.delete(`/api/customer-products/${customerProduct.id}`);
    await page.request.delete(`/api/customers/${customer.id}`);
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test('产品卡片等宽平分铺满整行，标题最多两行', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = Date.now();
  const shortNo = `E2E-ADAPT-SHORT-${stamp}`;
  const longNo = `E2E-ADAPT-LONG-${stamp}`;
  const fiveNo = `E2E-ADAPT-FIVE-${stamp}`;
  const createOrder = async (orderNo: string, names: string[]) => {
    const response = await page.request.post('/api/orders', {
      data: {
        orderNo,
        orderedAt: dateInputValue(),
        recipientName: '自适应测试',
        recipientInfo: '自适应测试 13800000000 深圳市南山区',
        items: names.map((name, index) => ({ name, sku: `ADP-${index}-${stamp}`, specification: '标准', quantity: 1, packCount: 1, unitPriceCents: 1000 })),
      },
    });
    expect(response.ok()).toBeTruthy();
    return Number((await response.json()).data.id);
  };
  const shortId = await createOrder(shortNo, ['圆砂', '水枪']);
  const longId = await createOrder(longNo, ['全自动无刷圆砂机高配版附赠螺丝刀套装', '水枪']);
  const fiveId = await createOrder(fiveNo, ['铁皮剪+手套+内六角', '水枪', '角磨机', '电钻', '电锤']);
  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    const productCell = async (orderNo: string) => {
      await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(orderNo);
      const row = page.locator('.orders-table-desktop tbody tr', { hasText: orderNo }).first();
      await expect(row).toBeVisible();
      return row.locator('.order-product-cell');
    };

    // 同一步里量出每张卡的宽度和所在行：同一行宽度一致，且该行宽度正好铺满列表。
    const assertRowsFill = async (cell: import('@playwright/test').Locator, expectedCards: number) => {
      const layout = await cell.locator('.order-product-quick-list').first().evaluate((element) => {
        const list = element.getBoundingClientRect();
        const cards = [...element.querySelectorAll('.order-product-quick-card')].map((card) => {
          const rect = card.getBoundingClientRect();
          return { top: Math.round(rect.top - list.top), width: rect.width };
        });
        return { listWidth: list.width, cards };
      });
      expect(layout.cards).toHaveLength(expectedCards);
      const rows = new Map<number, number[]>();
      for (const card of layout.cards) rows.set(card.top, [...(rows.get(card.top) ?? []), card.width]);
      for (const widths of rows.values()) {
        expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
        expect(Math.abs(widths.reduce((sum, width) => sum + width, 0) + 6 * (widths.length - 1) - layout.listWidth)).toBeLessThanOrEqual(1.5);
      }
      return rows;
    };
    const assertTitles = async (cell: import('@playwright/test').Locator) => {
      const titleMetrics = await cell.locator('.order-product-quick-copy strong').evaluateAll((elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          height: rect.height,
          lineHeight: parseFloat(getComputedStyle(element).lineHeight),
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
          whiteSpace: getComputedStyle(element).whiteSpace,
        };
      }));
      expect(titleMetrics.every((item) => item.whiteSpace === 'normal')).toBe(true);
      expect(titleMetrics.every((item) => item.height <= item.lineHeight * 2 + 1)).toBe(true);
      expect(titleMetrics.every((item) => item.scrollHeight <= item.clientHeight + 1)).toBe(true);
    };

    const shortCell = await productCell(shortNo);
    expect((await assertRowsFill(shortCell, 2)).size).toBe(1);
    await assertTitles(shortCell);
    const longCell = await productCell(longNo);
    expect((await assertRowsFill(longCell, 2)).size).toBe(1);
    await assertTitles(longCell);
    // 5 个产品：末行不满时独占整行，不留半截空白。
    const fiveCell = await productCell(fiveNo);
    const fiveRows = await assertRowsFill(fiveCell, 5);
    const lastRow = [...fiveRows.values()].at(-1)!;
    expect(lastRow).toHaveLength(1);
    await assertTitles(fiveCell);
  } finally {
    await page.request.delete(`/api/orders/${shortId}`);
    await page.request.delete(`/api/orders/${longId}`);
    await page.request.delete(`/api/orders/${fiveId}`);
  }
});

test('单产品卡片占满整行，长标题最多两行', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 });
  const stamp = Date.now();
  const orderNo = `E2E-WRAP-${stamp}`;
  const created = await page.request.post('/api/orders', {
    data: {
      orderNo,
      orderedAt: dateInputValue(),
      recipientName: '换行测试',
      recipientInfo: '换行测试 13800000000 深圳市南山区',
      items: [{ name: '全自动无刷圆砂机高配版附赠螺丝刀套装', sku: `WRAP-${stamp}`, specification: '标准', quantity: 1, packCount: 1, unitPriceCents: 1000 }],
    },
  });
  expect(created.ok()).toBeTruthy();
  const orderId = Number((await created.json()).data.id);
  try {
    await page.goto('/');
    await page.locator('.mobile-tabbar button', { hasText: '订单' }).first().click();
    await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(orderNo);
    const card = page.locator('.orders-card-list .order-card', { hasText: orderNo }).first();
    await expect(card).toBeVisible();
    await expect(card.locator('.order-product-quick-card')).toHaveCount(1);

    const layout = await card.locator('.order-product-quick-list').evaluate((element) => {
      const quickCard = element.querySelector('.order-product-quick-card')!;
      const title = element.querySelector('.order-product-quick-copy strong')!;
      const thumb = element.querySelector('.order-product-quick-thumb')!;
      const style = getComputedStyle(title);
      return {
        listWidth: element.getBoundingClientRect().width,
        cardWidth: quickCard.getBoundingClientRect().width,
        titleHeight: title.getBoundingClientRect().height,
        titleLineHeight: parseFloat(style.lineHeight),
        titleScrollHeight: title.scrollHeight,
        titleClientHeight: title.clientHeight,
        titleWhiteSpace: style.whiteSpace,
        thumbWidth: thumb.getBoundingClientRect().width,
        thumbHeight: thumb.getBoundingClientRect().height,
      };
    });
    expect(Math.abs(layout.cardWidth - layout.listWidth)).toBeLessThan(1.5);
    expect(layout.titleWhiteSpace).toBe('normal');
    expect(layout.titleHeight).toBeGreaterThan(layout.titleLineHeight);
    expect(layout.titleHeight).toBeLessThanOrEqual(layout.titleLineHeight * 2 + 1);
    expect(layout.titleScrollHeight).toBeLessThanOrEqual(layout.titleClientHeight + 1);
    // 缩略图固定 1:1，不随卡片文字高度拉伸。
    expect(layout.thumbWidth).toBeGreaterThanOrEqual(48);
    expect(Math.abs(layout.thumbWidth - layout.thumbHeight)).toBeLessThanOrEqual(0.5);
  } finally {
    await page.request.delete(`/api/orders/${orderId}`);
  }
});

test('手机端产品卡片等宽铺满整行，末行独占整行', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const stamp = Date.now();
  const tiepijianNo = `E2E-FLOW-TPJ-${stamp}`;
  const xiaoyingjuNo = `E2E-FLOW-XYJ-${stamp}`;
  const createOrder = async (orderNo: string, names: string[]) => {
    const response = await page.request.post('/api/orders', {
      data: {
        orderNo,
        orderedAt: dateInputValue(),
        recipientName: '换行规则测试',
        recipientInfo: '换行规则测试 13800000000 深圳市南山区',
        items: names.map((name, index) => ({ name, sku: `FLOW-${index}-${stamp}`, specification: '标准', quantity: 1, packCount: 1, unitPriceCents: 1000 })),
      },
    });
    expect(response.ok()).toBeTruthy();
    return Number((await response.json()).data.id);
  };
  const tiepijianId = await createOrder(tiepijianNo, ['铁皮剪+手套+内六角', '铁皮剪+手套+内六角', '铁皮剪+手套+内六角']);
  const xiaoyingjuId = await createOrder(xiaoyingjuNo, ['小鹰锯-4寸外转子带底板', '水泵-有刷']);
  const assertRowsFill = async (container: import('@playwright/test').Locator, expectedCards: number) => {
    const layout = await container.evaluate((element) => {
      const list = element.getBoundingClientRect();
      const cards = [...element.querySelectorAll('.order-product-quick-card')].map((card) => {
        const rect = card.getBoundingClientRect();
        return { top: Math.round(rect.top - list.top), width: rect.width };
      });
      return { listWidth: list.width, cards };
    });
    expect(layout.cards).toHaveLength(expectedCards);
    const rows = new Map<number, number[]>();
    for (const card of layout.cards) rows.set(card.top, [...(rows.get(card.top) ?? []), card.width]);
    for (const widths of rows.values()) {
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
      expect(Math.abs(widths.reduce((sum, width) => sum + width, 0) + 6 * (widths.length - 1) - layout.listWidth)).toBeLessThanOrEqual(1.5);
    }
    return rows;
  };
  const assertTitlesVisible = async (container: import('@playwright/test').Locator) => {
    const metrics = await container.locator('.order-product-quick-copy strong').evaluateAll((elements) => elements.map((element) => ({
      height: element.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(element).lineHeight),
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    })));
    expect(metrics.every((item) => item.height <= item.lineHeight * 2 + 1)).toBe(true);
    expect(metrics.every((item) => item.scrollHeight <= item.clientHeight + 1)).toBe(true);
  };
  try {
    await page.goto('/');
    await page.locator('.mobile-tabbar button', { hasText: '订单' }).first().click();
    const openMobileOrder = async (orderNo: string) => {
      await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(orderNo);
      const card = page.locator('.orders-card-list .order-card', { hasText: orderNo }).first();
      await expect(card).toBeVisible();
      return card;
    };
    const tiepijianCard = await openMobileOrder(tiepijianNo);
    const tiepijianRows = await assertRowsFill(tiepijianCard.locator('.order-card-products'), 3);
    expect([...tiepijianRows.values()].at(-1)).toHaveLength(1);
    await assertTitlesVisible(tiepijianCard);

    const xiaoyingjuCard = await openMobileOrder(xiaoyingjuNo);
    const xiaoyingjuRows = await assertRowsFill(xiaoyingjuCard.locator('.order-card-products'), 2);
    expect(xiaoyingjuRows.size).toBe(1);
    await assertTitlesVisible(xiaoyingjuCard);
  } finally {
    await page.request.delete(`/api/orders/${tiepijianId}`);
    await page.request.delete(`/api/orders/${xiaoyingjuId}`);
  }
});

test('订单桌面行不显示展开箭头，批量选择条固定可见', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const orderNo = `E2E-EXPAND-${Date.now()}`;
  const orderId = await seedOrder(page, orderNo);
  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(orderNo);

    const row = page.locator('.orders-table-desktop tbody tr', { hasText: orderNo }).first();
    await expect(row.locator('.order-expand-toggle')).toHaveCount(0);
    await expect(row.getByRole('button', { name: new RegExp(`展开订单 ${orderNo}`) })).toHaveCount(0);

    await row.locator('input[type=checkbox]').check();
    const bulk = page.locator('.orders-bulk-bar');
    await expect(bulk).toBeVisible();
    await expect(bulk).toContainText('已选 1 条');
    await bulk.getByRole('button', { name: '取消选择' }).click();
    await expect(bulk).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/orders/${orderId}`);
  }
});

test('状态列只显示箱唛已打印，打印时间通过悬停提示查看', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const orderNo = `E2E-PRINT-HINT-${Date.now()}`;
  const orderId = await seedOrder(page, orderNo);
  try {
    const labels = await page.request.get(`/api/orders/${orderId}/labels`);
    expect(labels.ok()).toBeTruthy();
    const labelId = Number((await labels.json()).data.labels[0].id);
    const printed = await page.request.post('/api/labels/print-history', {
      data: { orderIds: [orderId], labels: [{ orderId, id: labelId }], actionType: 'print' },
    });
    expect(printed.ok()).toBeTruthy();

    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(orderNo);
    const statusText = page.locator('.orders-table-desktop tbody tr', { hasText: orderNo }).first().locator('.order-status-cell .status-sub');
    await expect(statusText).toHaveText('已打印箱唛');
    await expect(statusText).not.toContainText(/\d{4}/);
    await expect(statusText).toHaveAttribute('title', /^箱唛打印时间：/);
  } finally {
    await page.request.delete(`/api/orders/${orderId}`);
  }
});

test('订单列表显示附件备注、隐藏物流单号，并可回退误点的完成打包', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = Date.now();
  const orderNo = `E2E-EXTRA-ROLLBACK-${stamp}`;
  const remark = '客户要求周五前发出，外箱贴绿色标签';
  const created = await page.request.post('/api/orders', {
    data: {
      orderNo,
      orderedAt: dateInputValue(),
      customerId: null,
      customerName: '回退测试客户',
      recipientName: '回退测试收件人',
      recipientInfo: '回退测试收件人 13800000000 广东省深圳市南山区',
      trackingNo: `SF-HIDDEN-${stamp}`,
      remark,
      items: [{ name: '回退测试产品', sku: `E2E-ROLLBACK-${stamp}`, specification: '标准规格', packagingName: '彩盒', packCount: 1, quantity: 2, unitPriceCents: 5000 }],
    },
  });
  expect(created.ok()).toBeTruthy();
  const orderId = Number((await created.json()).data.id);
  try {
    const attachmentName = `order-attachment-${stamp}.png`;
    const attachment = await page.request.post(`/api/orders/${orderId}/contracts`, {
      multipart: { file: { name: attachmentName, mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') } },
    });
    expect(attachment.ok()).toBeTruthy();
    for (const to of ['stock_reported', 'pending_packing', 'ship_pending']) {
      const advanced = await page.request.post(`/api/orders/${orderId}/status`, { data: { to } });
      expect(advanced.ok()).toBeTruthy();
    }

    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(orderNo);
    const row = page.locator('.orders-table-desktop tbody tr', { hasText: orderNo }).first();
    await expect(page.getByRole('button', { name: '展开筛选' })).toHaveCount(0);
    await expect(page.locator('.orders-data-table thead')).not.toContainText('物流单号');
    expect(await row.locator('.order-customer-cell').evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(130);
    await expect(row.locator('.order-product-quick-spec')).toHaveText('标准规格 * 2');
    await expect(page.locator('.orders-data-table thead .order-attachment-cell')).toHaveText('附件');
    await expect(page.locator('.orders-data-table thead .order-remark-cell')).toHaveText('备注');
    await expect(row.locator('.order-attachment-cell')).toContainText(attachmentName);
    await expect(row.locator('.order-attachment-cell')).not.toContainText(remark);
    await expect(row.locator('.order-extra-files a').first()).toHaveAttribute('title', attachmentName);
    expect(await row.locator('.order-extra-files a span').first().evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('nowrap');
    await expect(row.locator('.order-remark-cell')).toHaveText(remark);
    await expect(row.locator('.order-remark-cell')).not.toContainText(attachmentName);
    const tableWidth = await page.locator('.orders-table-desktop').evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(tableWidth.scrollWidth).toBeLessThanOrEqual(tableWidth.clientWidth + 1);
    await expect(row.locator('.order-extra-files')).toContainText(attachmentName);
    await expect(row.locator('.order-remark-full')).toHaveText(remark);
    await expect(row.locator('.order-status-cell')).toContainText('待发货');
    const topActions = row.locator('.order-ops-cell .row-actions-cell.is-top');
    const bottomActions = row.locator('.order-ops-cell .row-actions-cell.is-bottom');
    await expect(topActions).toHaveCount(3);
    await expect(bottomActions).toHaveCount(3);
    await expect(topActions.nth(0)).toContainText('详情');
    await expect(topActions.nth(1)).toContainText('编辑');
    await expect(topActions.nth(2)).toContainText('箱唛');
    await expect(bottomActions.nth(0)).toContainText('发货');
    await expect(bottomActions.nth(1)).toContainText('回退');
    await expect(bottomActions.nth(2).getByRole('button', { name: '删除订单' })).toBeVisible();
    await expect(page.locator('.orders-table-desktop')).not.toContainText(`SF-HIDDEN-${stamp}`);
    await expect(row.locator('.order-expand-toggle')).toHaveCount(0);

    page.once('dialog', (dialog) => void dialog.accept());
    await row.locator('.order-ops-cell').getByRole('button', { name: '回退', exact: true }).click();
    await expect(row.locator('.order-status-cell')).toContainText('待打包');

    const detail = await page.request.get(`/api/orders/${orderId}`);
    const saved = (await detail.json()).data as { status: string; tracking_no: string };
    expect(saved.status).toBe('pending_packing');
    expect(saved.tracking_no).toBe(`SF-HIDDEN-${stamp}`);

    await page.setViewportSize({ width: 390, height: 844 });
    const card = page.locator('.orders-card-list .order-card', { hasText: orderNo }).first();
    await expect(card.locator('.order-card-extra')).toContainText(attachmentName);
    await expect(card.locator('.order-extra-files a').first()).toHaveAttribute('title', attachmentName);
    await expect(card.locator('.order-remark-full')).toHaveText(remark);
    await expect(card).not.toContainText(`SF-HIDDEN-${stamp}`);
    await expect(card.locator('.order-expand-toggle')).toHaveCount(0);
    // 箱数在状态胶囊前；未付款和成本待补在金额下方，未付款标红。
    await expect(card.locator('.order-card-head .order-box-link')).toContainText('箱');
    await expect(card.locator('.order-card-meta .order-box-link')).toHaveCount(0);
    await expect(card.locator('.order-card-money .order-card-payment')).toHaveText('未付款');
    await expect(card.locator('.order-card-money .order-card-payment')).toHaveAttribute('style', /--color-danger/);
    await expect(card.locator('.order-card-money .order-card-profit-link')).toContainText('成本待补');
    await expect(row.locator('.payment-sub')).toHaveText('未付款');
    await expect(row.locator('.payment-sub')).toHaveAttribute('style', /--color-danger/);
  } finally {
    await page.request.delete(`/api/orders/${orderId}`);
  }
});

test('已发货订单需在详情里撤销发货记录，退回发货中', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = Date.now();
  const orderNo = `E2E-UNSHIP-${stamp}`;
  const orderId = await seedOrder(page, orderNo);
  let proofId: number | undefined;
  try {
    for (const to of ['stock_reported', 'pending_packing', 'ship_pending', 'shipping']) {
      const advanced = await page.request.post(`/api/orders/${orderId}/status`, { data: { to } });
      expect(advanced.ok()).toBeTruthy();
    }
    proofId = await payOrder(page, orderId, 10000);
    const beforeShip = await (await page.request.get(`/api/orders/${orderId}/detail`)).json();
    const item = beforeShip.data.items[0] as { id: number; quantity: number };
    const shipped = await page.request.post('/api/shipping/partial', {
      data: { orders: [{ orderId, trackingNo: `SF-UNDO-${stamp}`, items: [{ orderItemId: item.id, quantity: item.quantity }] }] },
    });
    expect(shipped.ok()).toBeTruthy();

    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(orderNo);
    const row = page.locator('.orders-table-desktop tbody tr', { hasText: orderNo }).first();
    await expect(row.locator('.order-status-cell')).toContainText('已发货');
    await expect(row.locator('.order-status-cell')).not.toContainText('箱唛待打印');

    await row.locator('.order-ops-cell').getByRole('button', { name: '详情', exact: true }).click();
    const detailDialog = page.getByRole('dialog', { name: /订单详情/ });
    await expect(detailDialog.getByText('发货记录')).toBeVisible();
    page.once('dialog', (dialog) => void dialog.accept());
    await detailDialog.getByRole('button', { name: '撤销本次' }).click();
    await expect(detailDialog.getByText('发货记录')).toHaveCount(0);

    const detail = await page.request.get(`/api/orders/${orderId}`);
    const saved = (await detail.json()).data as { status: string };
    expect(saved.status).toBe('shipping');
  } finally {
    if (proofId != null) await page.request.post(`/api/finance/proofs/${proofId}/void`, { data: { note: 'e2e 清理' } });
    await page.request.delete(`/api/orders/${orderId}`);
  }
});

test('订单没有附件时只收起附件列，备注常驻可点击添加', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const orderNo = `E2E-EMPTY-EXTRA-${Date.now()}`;
  const orderId = await seedOrder(page, orderNo);
  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(orderNo);
    const row = page.locator('.orders-table-desktop tbody tr', { hasText: orderNo }).first();
    await expect(row).toBeVisible();
    const head = page.locator('.orders-data-table thead');
    await expect(head).not.toContainText('附件');
    await expect(head).toContainText('备注');
    await expect(row.locator('.order-attachment-cell')).toHaveCount(0);
    await expect(row.locator('.order-remark-cell')).toContainText('点击添加');

    await page.setViewportSize({ width: 390, height: 844 });
    const card = page.locator('.orders-card-list .order-card', { hasText: orderNo }).first();
    await expect(card).toBeVisible();
    await expect(card.locator('.order-card-extra')).toContainText('点击添加');
    await expect(card.locator('.order-extra-files')).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/orders/${orderId}`);
  }
});

test('点击备注用小弹窗直接编辑并保存', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const orderNo = `E2E-REMARK-${Date.now()}`;
  const orderId = await seedOrder(page, orderNo);
  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(orderNo);
    const row = page.locator('.orders-table-desktop tbody tr', { hasText: orderNo }).first();
    await expect(row.locator('.order-remark-cell')).toContainText('点击添加');
    await row.getByRole('button', { name: `编辑订单${orderNo}备注` }).click();

    const dialog = page.getByRole('dialog', { name: new RegExp(`订单备注.*${orderNo}`) });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('备注内容').fill('加急单，周五前发出');
    await dialog.getByRole('button', { name: '保存备注' }).click();
    await expect(dialog).toBeHidden();
    await expect(row.locator('.order-remark-cell')).toContainText('加急单，周五前发出');

    await row.getByRole('button', { name: `编辑订单${orderNo}备注` }).click();
    const reopened = page.getByRole('dialog', { name: new RegExp(`订单备注.*${orderNo}`) });
    await expect(reopened.getByLabel('备注内容')).toHaveValue('加急单，周五前发出');
    await reopened.getByRole('button', { name: '取消' }).click();
  } finally {
    await page.request.delete(`/api/orders/${orderId}`);
  }
});

test('点击总箱数打开箱唛编辑与打印', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 900 });
  const orderNo = `E2E-BOX-${Date.now()}`;
  const orderId = await seedOrder(page, orderNo);
  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(orderNo);
    const row = page.locator('.orders-table-desktop tbody tr', { hasText: orderNo }).first();
    await row.getByRole('button', { name: `编辑或打印订单${orderNo}箱唛` }).click();

    const dialog = page.getByRole('dialog', { name: new RegExp(`箱唛编辑.*${orderNo}`) });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: '预览并打印' })).toBeVisible();
    await dialog.getByRole('button', { name: '关闭' }).click();
    await expect(dialog).toBeHidden();
  } finally {
    await page.request.delete(`/api/orders/${orderId}`);
  }
});

test('订单手机卡片不显示展开箭头且不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const orderNo = `E2E-EXPAND-M-${Date.now()}`;
  const orderId = await seedOrder(page, orderNo);
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '更多模块' }).click();
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(orderNo);
    const card = page.locator('.orders-card-list .order-card', { hasText: orderNo }).first();
    await expect(card.locator('.order-expand-toggle')).toHaveCount(0);
    await expect(card.locator('.order-card-products')).toContainText('E2E展开产品');
    const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await page.request.delete(`/api/orders/${orderId}`);
  }
});
