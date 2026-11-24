import { expect, test, type Page } from '@playwright/test';
import { dateInputValue } from '../../src/shared/date-input';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

interface SeedOptions {
  orderNo: string;
  channel?: 'online' | 'offline';
  recipientName?: string;
  recipientInfo?: string;
  amount?: number;
  isDraft?: boolean;
  items?: Array<{ name: string; sku: string; packCount: number; quantity: number; unitPriceCents?: number }>;
}

async function seedOrder(page: Page, options: SeedOptions) {
  const response = await page.request.post('/api/orders', {
    data: {
      orderNo: options.orderNo,
      orderedAt: dateInputValue(),
      channel: options.channel ?? 'online',
      recipientName: options.recipientName ?? '默认收件人',
      recipientInfo: options.recipientInfo ?? '杭州市西湖区默认地址',
      amount: options.amount ?? 0,
      isDraft: options.isDraft ?? false,
      items: (options.items ?? [{ name: '工作台产品', sku: `WB-${Date.now()}`, packCount: 10, quantity: 10 }]).map((item) => ({
        ...item,
        specification: '标准',
        packagingName: '纸箱',
        unitPriceCents: item.unitPriceCents ?? 0,
      })),
    },
  });
  expect(response.ok()).toBeTruthy();
  return Number((await response.json()).data.id);
}

async function advanceToShipping(page: Page, orderId: number) {
  for (const to of ['stock_reported', 'pending_packing', 'ship_pending', 'shipping']) {
    const response = await page.request.post(`/api/orders/${orderId}/status`, { data: { to } });
    expect(response.ok()).toBeTruthy();
  }
}

async function cleanupOrders(page: Page, orderIds: number[]) {
  for (const orderId of orderIds) {
    const history = await page.request.get(`/api/shipping/orders/${orderId}/shipments`);
    if (history.ok()) {
      for (const shipment of (await history.json()).data) await page.request.delete(`/api/shipping/shipments/${shipment.id}`);
    }
    await page.request.delete(`/api/orders/${orderId}`);
  }
}

async function openOrders(page: Page) {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
}

test('订单页顶部只剩渠道标签，新建订单只在全部和草稿显示', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = Date.now();
  const draftId = await seedOrder(page, { orderNo: `E2E-HEAD-DRAFT-${stamp}`, isDraft: true });
  try {
    await openOrders(page);
    await expect(page.locator('.orders-page .orders-page-heading')).toHaveCount(0);
    await expect(page.locator('.orders-page .page-title')).toHaveCount(0);
    await expect(page.locator('.orders-channel-tabs')).toBeVisible();
    await expect(page.locator('.orders-channel-tabs').getByRole('tab')).toHaveCount(2);

    const status = (label: string) => page.locator('.orders-page .status-cards .status-card', { hasText: label });
    await status('全部订单').click();
    await expect(page.getByRole('button', { name: '新建订单' })).toBeVisible();
    await status('草稿').click();
    await expect(page.getByRole('button', { name: '新建订单' })).toBeVisible();
    await status('待备货').click();
    await expect(page.getByRole('button', { name: '新建订单' })).toHaveCount(0);
    await status('发货中').click();
    await expect(page.getByRole('button', { name: '新建订单' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '批量发货' })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await status('草稿').click();
    await expect(page.getByRole('button', { name: '新建订单' })).toBeVisible();
    await status('待备货').click();
    await expect(page.getByRole('button', { name: '新建订单' })).toHaveCount(0);
    await status('发货中').click();
    await expect(page.getByRole('button', { name: '新建订单' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '批量发货' })).toBeVisible();
  } finally {
    await cleanupOrders(page, [draftId]);
  }
});

test('订单列表可编辑并复制收件人信息，已发货订单只读', async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const stamp = Date.now();
  const orderNo = `E2E-RECIPIENT-${stamp}`;
  const orderId = await seedOrder(page, {
    orderNo,
    recipientName: '原收件人',
    recipientInfo: `杭州市西湖区原地址${stamp}号`,
    items: [{ name: '收件人产品', sku: `RECIPIENT-${stamp}`, packCount: 10, quantity: 10 }],
  });
  const shippedId = await seedOrder(page, {
    orderNo: `E2E-RECIPIENT-SHIPPED-${stamp}`,
    recipientName: '已发货收件人',
    recipientInfo: `杭州市西湖区已发货${stamp}号`,
    items: [{ name: '已发货产品', sku: `RECIPIENT-SHIPPED-${stamp}`, packCount: 10, quantity: 10 }],
  });
  try {
    await advanceToShipping(page, shippedId);
    const detail = await (await page.request.get(`/api/orders/${shippedId}/detail`)).json();
    const itemId = Number(detail.data.items[0].id);
    const shipped = await page.request.post('/api/shipping/partial', {
      data: { orders: [{ orderId: shippedId, trackingNo: `SF-RECIPIENT-${stamp}`, items: [{ orderItemId: itemId, quantity: 10 }] }] },
    });
    expect(shipped.ok()).toBeTruthy();

    await openOrders(page);
    await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(orderNo);
    const row = page.locator('.orders-table-desktop tbody tr', { hasText: orderNo }).first();
    await expect(row).toBeVisible();
    await row.locator('.order-recipient-link').click();
    const modal = page.getByRole('dialog', { name: /收件人信息/ });
    await expect(modal).toBeVisible();
    await modal.getByLabel('收件人姓名').fill('新收件人');
    await modal.getByLabel('收件信息').fill(`杭州市西湖区新地址${stamp}号 13900000000`);
    await modal.getByRole('button', { name: '复制收件信息' }).click();
    await expect(page.getByText('已复制收件信息')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`新收件人 杭州市西湖区新地址${stamp}号 13900000000`);
    await modal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByText('订单已保存')).toBeVisible();
    await expect(row).toContainText('新收件人');

    const updated = await (await page.request.get(`/api/orders/${orderId}/detail`)).json();
    expect(updated.data.recipient_name).toBe('新收件人');
    expect(updated.data.recipient_info).toContain('新地址');

    await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(`E2E-RECIPIENT-SHIPPED-${stamp}`);
    const shippedRow = page.locator('.orders-table-desktop tbody tr', { hasText: `E2E-RECIPIENT-SHIPPED-${stamp}` }).first();
    await expect(shippedRow).toBeVisible();
    await expect(shippedRow.locator('.order-recipient-link')).toHaveCount(0);
    await expect(shippedRow.locator('.order-party-recipient')).toContainText('已发货收件人');
  } finally {
    await cleanupOrders(page, [orderId, shippedId]);
  }
});

test('手机端点击收件人姓名打开编辑窗', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const stamp = Date.now();
  const orderNo = `E2E-RECIPIENT-MOBILE-${stamp}`;
  const orderId = await seedOrder(page, {
    orderNo,
    recipientName: '手机收件人',
    recipientInfo: `杭州市西湖区手机收件${stamp}号`,
  });
  try {
    await page.goto('/');
    await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(orderNo);
    const card = page.locator('.orders-card-list .order-card', { hasText: orderNo }).first();
    await expect(card).toBeVisible();
    await card.locator('.order-recipient-link').click();
    const modal = page.getByRole('dialog', { name: /收件人信息/ });
    await expect(modal).toBeVisible();
    await expect(modal.getByLabel('收件人姓名')).toHaveValue('手机收件人');
    await modal.getByRole('button', { name: '关闭' }).click();
  } finally {
    await cleanupOrders(page, [orderId]);
  }
});

test('发货中页签卡片直接编辑本次数量并回填单号，不显示金额附件备注', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = Date.now();
  const orderNo = `E2E-DETAIL-SHIP-${stamp}`;
  const orderId = await seedOrder(page, {
    orderNo,
    recipientName: '详情发货收件人',
    recipientInfo: `杭州市西湖区详情发货${stamp}号`,
    amount: 8800,
    items: [
      { name: '圆砂机', sku: `DETAIL-A-${stamp}`, packCount: 10, quantity: 10 },
      { name: '水枪', sku: `DETAIL-B-${stamp}`, packCount: 5, quantity: 5 },
    ],
  });
  try {
    await advanceToShipping(page, orderId);
    await openOrders(page);
    await page.locator('.orders-page .status-cards .status-card', { hasText: '发货中' }).click();
    const card = page.locator('.orders-shipping-card', { hasText: orderNo });
    await expect(card).toBeVisible();
    await expect(card).not.toContainText('¥');
    await expect(card).not.toContainText('备注');
    await expect(card).not.toContainText('附件');
    await expect(card.getByRole('region', { name: '本次发货' })).toBeVisible();
    const cardLayout = await card.evaluate((element) => {
      const items = element.querySelector('.order-shipping-items')!;
      const input = element.querySelector('.orders-shipping-ship-box input')!;
      const confirm = element.querySelector('.orders-shipping-ship-box button')!;
      const form = element.querySelector('.order-shipping-form')!;
      const shipBox = element.querySelector('.orders-shipping-ship-box')!;
      return {
        columns: getComputedStyle(items).gridTemplateColumns.split(' ').length,
        inputBottom: input.getBoundingClientRect().bottom,
        confirmTop: confirm.getBoundingClientRect().top,
        shipTop: shipBox.getBoundingClientRect().top,
        formTop: form.getBoundingClientRect().top,
        cardTop: element.getBoundingClientRect().top,
      };
    });
    expect(cardLayout.columns).toBe(3);
    expect(cardLayout.confirmTop).toBeGreaterThanOrEqual(cardLayout.inputBottom - 1);
    expect(cardLayout.shipTop - cardLayout.cardTop).toBeLessThan(120);
    expect(cardLayout.shipTop).toBeLessThan(cardLayout.formTop);

    await card.getByLabel(`${orderNo}-圆砂机-本次发货数量`).fill('4');
    await card.getByLabel(`${orderNo}-水枪-本次发货数量`).fill('0');
    await card.getByLabel(`${orderNo}-本次物流单号`).fill(`SF-DETAIL-1-${stamp}`);
    await card.getByRole('button', { name: '确认本次发货' }).click();
    await expect(page.getByText('已确认 1 单本次发货')).toBeVisible();
    await expect(card).toContainText('已发 4/15 件 · 剩余 11 件');
    await expect(card.getByLabel(`${orderNo}-圆砂机-本次发货数量`)).toHaveValue('6');
    const partial = await (await page.request.get(`/api/orders/${orderId}`)).json();
    expect(partial.data.status).toBe('shipping');
    expect(partial.data.items.find((item: { sku: string }) => item.sku === `DETAIL-A-${stamp}`).shipped_quantity).toBe(4);
    expect(partial.data.items.find((item: { sku: string }) => item.sku === `DETAIL-B-${stamp}`).shipped_quantity).toBe(0);

    await card.getByLabel(`${orderNo}-圆砂机-本次发货数量`).fill('6');
    await card.getByLabel(`${orderNo}-水枪-本次发货数量`).fill('5');
    await card.getByLabel(`${orderNo}-本次物流单号`).fill(`SF-DETAIL-2-${stamp}`);
    await card.getByRole('button', { name: '确认本次发货' }).click();
    await expect(card).toHaveCount(0);
    const completed = await (await page.request.get(`/api/orders/${orderId}`)).json();
    expect(completed.data.status).toBe('shipped');
  } finally {
    await cleanupOrders(page, [orderId]);
  }
});

test('发货中卡片显示未收款并禁用确认发货', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = Date.now();
  const orderNo = `E2E-SHIP-UNPAID-CARD-${stamp}`;
  const orderId = await seedOrder(page, {
    orderNo,
    recipientName: '未收款卡片',
    recipientInfo: `杭州市西湖区未收款卡片${stamp}号`,
    items: [{ name: '未收款产品', sku: `UNPAID-CARD-${stamp}`, packCount: 10, quantity: 10, unitPriceCents: 1000 }],
  });
  try {
    await advanceToShipping(page, orderId);
    await openOrders(page);
    await page.locator('.orders-page .status-cards .status-card', { hasText: '发货中' }).click();
    const card = page.locator('.orders-shipping-card', { hasText: orderNo });
    await expect(card).toBeVisible();
    await expect(card).toContainText('未收款');
    const confirm = card.getByRole('button', { name: '确认本次发货' });
    await expect(confirm).toBeDisabled();
    await card.getByLabel(`${orderNo}-本次物流单号`).fill(`SF-UNPAID-CARD-${stamp}`);
    await expect(confirm).toBeDisabled();
    await expect(card).toContainText('未收齐全款，暂不能发货');
  } finally {
    await cleanupOrders(page, [orderId]);
  }
});

test('发货中可回退到待发货，有发货记录时不显示回退', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = Date.now();
  const orderNo = `E2E-SHIP-ROLLBACK-${stamp}`;
  const orderId = await seedOrder(page, {
    orderNo,
    recipientInfo: `杭州市西湖区回退测试${stamp}号`,
    items: [{ name: '回退产品', sku: `ROLLBACK-${stamp}`, packCount: 10, quantity: 10 }],
  });
  try {
    await advanceToShipping(page, orderId);
    await openOrders(page);
    await page.locator('.orders-page .status-cards .status-card', { hasText: '发货中' }).click();
    const card = page.locator('.orders-shipping-card', { hasText: orderNo });
    await expect(card).toBeVisible();
    page.once('dialog', (dialog) => void dialog.accept());
    await card.getByRole('button', { name: '回退', exact: true }).click();
    await expect(page.getByText(`订单 ${orderNo} 已回退到待发货`)).toBeVisible();
    await expect(card).toHaveCount(0);
    const detail = await (await page.request.get(`/api/orders/${orderId}`)).json();
    expect(detail.data.status).toBe('ship_pending');
  } finally {
    await cleanupOrders(page, [orderId]);
  }
});
