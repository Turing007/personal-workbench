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

test('订单展开的产品明细带产品图', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = Date.now();
  const createdProduct = await page.request.post('/api/products', {
    data: { name: `E2E展开带图${stamp}`, specification: '12V 100Ah', status: 'active', packaging: [{ name: '彩盒包装', packCount: 10, innerWeight: 0.5, outerSize: '40×30×25', outerWeight: 8 }] },
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
    await expect(productCell.locator('.order-product-quick-spec')).toHaveText('12V 100Ah');
    await expect(productCell).toContainText('2 件');
    await expect(productCell.locator('.order-product-quick-thumb img')).toHaveAttribute('src', /\/api\/thumbs\/240\//);
    expect(await productCell.locator('.order-product-quick-list').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(3);
    await row.getByRole('button', { name: `展开订单 E2E-IMG-${stamp}` }).click();
    const panel = page.locator('.order-expand-row .order-expand-panel');
    await expect(panel.locator('.order-expand-product-thumb img')).toHaveCount(1);
    await expect(panel.locator('.order-expand-product-thumb img')).toBeVisible();
    await expect(panel.locator('.order-expand-product-thumb img')).toHaveAttribute('src', /\/api\/thumbs\/240\//);

    await page.setViewportSize({ width: 390, height: 844 });
    const card = page.locator('.orders-card-list .order-card', { hasText: `E2E-IMG-${stamp}` }).first();
    const cardProducts = card.locator('.order-card-products');
    await expect(cardProducts.locator('.order-product-quick-spec')).toHaveText('12V 100Ah');
    await expect(cardProducts).toContainText('2 件');
    await expect(cardProducts.locator('.order-product-quick-thumb img')).toBeVisible();
    expect(await cardProducts.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2);
  } finally {
    await page.request.delete(`/api/orders/${orderId}`);
    await page.request.delete(`/api/customer-products/${customerProduct.id}`);
    await page.request.delete(`/api/customers/${customer.id}`);
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test('订单桌面行内展开显示产品、收件信息和财务摘要，批量条固定可见', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const orderNo = `E2E-EXPAND-${Date.now()}`;
  const orderId = await seedOrder(page, orderNo);
  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(orderNo);

    const row = page.locator('.orders-table-desktop tbody tr', { hasText: orderNo }).first();
    await row.getByRole('button', { name: `展开订单 ${orderNo}` }).click();
    const panel = page.locator('.order-expand-row .order-expand-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('E2E展开产品');
    await expect(panel).toContainText('12V 100Ah');
    await expect(panel).toContainText('展开收件人');
    await expect(panel).toContainText('财务摘要');
    await expect(panel.getByRole('button', { name: '查看详情' })).toBeVisible();
    await expect(panel.getByRole('button', { name: '编辑订单' })).toBeVisible();
    await expect(panel.getByRole('button', { name: '打印箱唛' })).toBeVisible();

    await row.locator('input[type=checkbox]').check();
    const bulk = page.locator('.orders-bulk-bar');
    await expect(bulk).toBeVisible();
    await expect(bulk).toContainText('已选 1 条');
    await bulk.getByRole('button', { name: '取消选择' }).click();
    await expect(bulk).toHaveCount(0);

    await row.getByRole('button', { name: `收起订单 ${orderNo}` }).click();
    await expect(panel).toHaveCount(0);
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
    await expect(page.locator('.orders-data-table thead')).not.toContainText('物流单号');
    expect(await row.locator('.order-customer-cell').evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(125);
    await expect(row.locator('.order-product-quick-spec')).toHaveText('标准规格');
    await expect(row.locator('.order-extra-cell')).toContainText('1 个附件');
    await expect(row.locator('.order-extra-cell')).toContainText(remark);
    await expect(row.locator('.order-status-cell')).toContainText('待发货');
    await expect(page.locator('.orders-table-desktop')).not.toContainText(`SF-HIDDEN-${stamp}`);

    page.once('dialog', (dialog) => void dialog.accept());
    await row.locator('.order-ops-cell').getByRole('button', { name: '回退', exact: true }).click();
    await expect(row.locator('.order-status-cell')).toContainText('待打包');

    const detail = await page.request.get(`/api/orders/${orderId}`);
    const saved = (await detail.json()).data as { status: string; tracking_no: string };
    expect(saved.status).toBe('pending_packing');
    expect(saved.tracking_no).toBe(`SF-HIDDEN-${stamp}`);

    await page.setViewportSize({ width: 390, height: 844 });
    const card = page.locator('.orders-card-list .order-card', { hasText: orderNo }).first();
    await expect(card.locator('.order-card-meta')).toContainText('1 个附件');
    await expect(card.locator('.order-card-meta')).toContainText(`备注：${remark}`);
    await expect(card).not.toContainText(`SF-HIDDEN-${stamp}`);
  } finally {
    await page.request.delete(`/api/orders/${orderId}`);
  }
});

test('订单手机卡片可展开且不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const orderNo = `E2E-EXPAND-M-${Date.now()}`;
  const orderId = await seedOrder(page, orderNo);
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '更多模块' }).click();
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(orderNo);
    const card = page.locator('.orders-card-list .order-card', { hasText: orderNo }).first();
    await card.getByRole('button', { name: `展开订单 ${orderNo}` }).click();
    await expect(card.locator('.order-expand-panel')).toContainText('E2E展开产品');
    await expect(card.locator('.order-expand-panel')).toContainText('展开收件人');
    const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await page.request.delete(`/api/orders/${orderId}`);
  }
});
