import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

interface SeedOrderOptions {
  orderNo: string;
  channel?: 'online' | 'offline';
  recipientName?: string;
  recipientInfo?: string;
  amount?: number;
  items: Array<{ name: string; sku: string; packCount: number; quantity: number }>;
}

async function seedOrder(page: Page, options: SeedOrderOptions): Promise<{ id: number; orderNo: string }> {
  const created = await page.request.post('/api/orders', {
    data: {
      orderNo: options.orderNo,
      orderedAt: new Date().toISOString(),
      channel: options.channel ?? 'online',
      recipientName: options.recipientName ?? '发货收件人',
      recipientInfo: options.recipientInfo ?? '杭州市西湖区发货路 1 号',
      amount: options.amount ?? 0,
      shippingCents: 0,
      items: options.items.map((item) => ({
        name: item.name,
        sku: item.sku,
        specification: '标准',
        packagingName: '纸箱',
        packCount: item.packCount,
        quantity: item.quantity,
        unitPriceCents: 0,
      })),
    },
  });
  expect(created.ok()).toBeTruthy();
  const data = (await created.json()).data as { id: number; order_no: string };
  return { id: Number(data.id), orderNo: String(data.order_no) };
}

async function advanceToShipping(page: Page, orderId: number) {
  for (const to of ['stock_reported', 'pending_packing', 'ship_pending', 'shipping']) {
    const advanced = await page.request.post(`/api/orders/${orderId}/status`, { data: { to } });
    expect(advanced.ok()).toBeTruthy();
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

async function openOrders(page: Page, channel: 'online' | 'offline' = 'online') {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
  await page.locator('.orders-channel-tabs').getByRole('tab', { name: channel === 'online' ? /线上订单/ : /线下订单/ }).click();
}

async function openShippingStatusView(page: Page) {
  await page.locator('.orders-page .status-cards .status-card', { hasText: '发货中' }).click();
}

test.describe('发货中状态', () => {
  test('待发货点发货只变状态、不切视图；发货导航已移除', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const stamp = Date.now();
    const online = await seedOrder(page, {
      orderNo: `E2E-SHIP-ENTER-${stamp}`,
      channel: 'online',
      recipientInfo: `杭州市西湖区进入发货${stamp}号`,
      items: [{ name: '进入发货产品', sku: `ENTER-${stamp}`, packCount: 10, quantity: 10 }],
    });
    const offline = await seedOrder(page, {
      orderNo: `E2E-SHIP-OFFLINE-${stamp}`,
      channel: 'offline',
      recipientInfo: `杭州市西湖区线下发货${stamp}号`,
      items: [{ name: '线下发货产品', sku: `OFFLINE-${stamp}`, packCount: 10, quantity: 10 }],
    });
    try {
      for (const orderId of [online.id, offline.id]) {
        for (const to of ['stock_reported', 'pending_packing', 'ship_pending']) {
          const advanced = await page.request.post(`/api/orders/${orderId}/status`, { data: { to } });
          expect(advanced.ok()).toBeTruthy();
        }
      }

      await openOrders(page, 'online');
      await expect(page.locator('.sidebar-nav').getByRole('button', { name: '发货', exact: true })).toHaveCount(0);
      await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(online.orderNo);
      const row = page.locator('.orders-table-desktop tbody tr', { hasText: online.orderNo }).first();
      await expect(row.locator('.order-status-cell')).toContainText('待发货');

      await row.getByRole('button', { name: '发货', exact: true }).click();
      await expect(page.locator('.orders-data-table')).toBeVisible();
      await expect(row.locator('.order-status-cell')).toContainText('发货中');

      await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(offline.orderNo);
      await expect(page.locator('.orders-table-desktop tbody tr', { hasText: offline.orderNo })).toHaveCount(0);
      await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(online.orderNo);

      await row.getByRole('button', { name: '继续发货', exact: true }).click();
      await expect(page.locator('.orders-page .status-cards .status-card', { hasText: '发货中' })).toHaveAttribute('aria-pressed', 'true');
      const shippingRow = page.locator('.orders-shipping-table tbody tr', { hasText: online.orderNo });
      await expect(shippingRow).toBeVisible();
      await expect(shippingRow.getByLabel(`${online.orderNo}物流单号`)).toBeVisible();
      await expect(shippingRow.getByLabel(/本次发货数量/).first()).toBeVisible();

      await page.locator('.orders-channel-tabs').getByRole('tab', { name: /线下订单/ }).click();
      await expect(page.locator('.orders-shipping-table tbody tr', { hasText: online.orderNo })).toHaveCount(0);
    } finally {
      await cleanupOrders(page, [online.id, offline.id]);
    }
  });

  test('多选同地址订单生成发货表，箱数按单拆解并可复制', async ({ page, context }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const stamp = Date.now();
    const recipientInfo = `杭州市西湖区合并发货路${stamp}号`;
    const orders: Array<{ id: number; orderNo: string }> = [];
    try {
      for (const [index, quantity] of [20, 30, 50].entries()) {
        orders.push(await seedOrder(page, {
          orderNo: `E2E-SHIP-MERGE-${stamp}-${index + 1}`,
          channel: 'online',
          recipientName: '合并收件人',
          recipientInfo,
          items: [{ name: `合并产品${index + 1}`, sku: `MERGE-${stamp}-${index + 1}`, packCount: 10, quantity }],
        }));
      }
      for (const order of orders) await advanceToShipping(page, order.id);

      await openOrders(page, 'online');
      await openShippingStatusView(page);
      for (const order of orders) {
        await page.locator('.orders-shipping-table tbody tr', { hasText: order.orderNo }).getByRole('checkbox').check();
      }
      const bar = page.getByRole('region', { name: '发货表批量操作' });
      await expect(bar).toContainText('已选 3 单');
      await bar.getByRole('button', { name: '查看发货表' }).click();

      const drawer = page.getByRole('dialog', { name: '发货表' });
      await expect(drawer).toBeVisible();
      const sheet = drawer.getByRole('textbox', { name: '发货表' });
      await expect.poll(async () => sheet.inputValue()).toContain(`2箱 + 3箱 + 5箱 ${recipientInfo}`);
      await drawer.getByRole('button', { name: '复制发货表' }).click();
      await expect(page.getByText('已复制发货表（1 个地址）')).toBeVisible();
      await drawer.getByRole('button', { name: '关闭' }).click();

      for (const order of orders) {
        const detail = await (await page.request.get(`/api/orders/${order.id}`)).json();
        expect(detail.data.status).toBe('shipping');
        const history = await (await page.request.get(`/api/shipping/orders/${order.id}/shipments`)).json();
        expect(history.data).toHaveLength(0);
      }
    } finally {
      await cleanupOrders(page, orders.map((order) => order.id));
    }
  });

  test('多选不同收件地址生成发货表，地址之间空行', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const stamp = Date.now();
    const orders: Array<{ id: number; orderNo: string; recipientInfo: string }> = [];
    try {
      for (const index of [1, 2]) {
        const recipientInfo = `杭州市西湖区表格地址${stamp}号${index}`;
        const order = await seedOrder(page, {
          orderNo: `E2E-SHIP-SHEET-${stamp}-${index}`,
          channel: 'online',
          recipientInfo,
          items: [{ name: `表格产品${index}`, sku: `SHEET-${stamp}-${index}`, packCount: 10, quantity: 10 }],
        });
        orders.push({ ...order, recipientInfo });
        await advanceToShipping(page, order.id);
      }

      await openOrders(page, 'online');
      await openShippingStatusView(page);
      for (const order of orders) {
        await page.locator('.orders-shipping-table tbody tr', { hasText: order.orderNo }).getByRole('checkbox').check();
      }
      const bar = page.getByRole('region', { name: '发货表批量操作' });
      await expect(bar).toContainText('已选 2 单');
      await bar.getByRole('button', { name: '查看发货表' }).click();

      const drawer = page.getByRole('dialog', { name: '发货表' });
      const sheet = drawer.getByRole('textbox', { name: '发货表' });
      await expect.poll(async () => sheet.inputValue()).toContain(orders[0]!.recipientInfo);
      const value = await sheet.inputValue();
      for (const order of orders) expect(value).toContain(order.recipientInfo);
      expect(value.split('\n\n')).toHaveLength(2);
      expect(value.split('\n').some((line) => line.trim() === '')).toBe(true);
      await drawer.getByRole('button', { name: '关闭' }).click();
    } finally {
      await cleanupOrders(page, orders.map((order) => order.id));
    }
  });

  test('批量进入发货中：勾选两单后一键推进，不直接变已发货', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const stamp = Date.now();
    const orders: Array<{ id: number; orderNo: string }> = [];
    try {
      for (const index of [1, 2]) {
        const order = await seedOrder(page, {
          orderNo: `E2E-SHIP-BATCH-ENTER-${stamp}-${index}`,
          channel: 'online',
          recipientInfo: `杭州市西湖区批量进入${stamp}号${index}`,
          items: [{ name: `批量进入产品${index}`, sku: `BATCH-ENTER-${stamp}-${index}`, packCount: 10, quantity: 10 }],
        });
        orders.push(order);
        for (const to of ['stock_reported', 'pending_packing', 'ship_pending']) {
          const advanced = await page.request.post(`/api/orders/${order.id}/status`, { data: { to } });
          expect(advanced.ok()).toBeTruthy();
        }
      }

      await openOrders(page, 'online');
      for (const order of orders) await page.getByLabel(`选择订单${order.orderNo}`).check();
      const bulk = page.locator('.orders-bulk-bar');
      await expect(bulk).toContainText('已选 2 条');
      page.once('dialog', (dialog) => void dialog.accept());
      await bulk.getByRole('button', { name: '进入发货中' }).click();
      await expect(page.getByText('批量进入发货中完成：成功 2 单')).toBeVisible();
      for (const order of orders) {
        const detail = await (await page.request.get(`/api/orders/${order.id}`)).json();
        expect(detail.data.status).toBe('shipping');
        const history = await (await page.request.get(`/api/shipping/orders/${order.id}/shipments`)).json();
        expect(history.data).toHaveLength(0);
        await expect(page.locator('.orders-table-desktop tbody tr', { hasText: order.orderNo }).locator('.order-status-cell')).toContainText('发货中');
      }
    } finally {
      await cleanupOrders(page, orders.map((order) => order.id));
    }
  });

  test('手机端多选订单生成发货表，右侧抽屉可打开', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const stamp = Date.now();
    const orders: Array<{ id: number; orderNo: string; recipientInfo: string }> = [];
    try {
      for (const index of [1, 2]) {
        const recipientInfo = `杭州市西湖区手机表格${stamp}号${index}`;
        const order = await seedOrder(page, {
          orderNo: `E2E-SHIP-MOBILE-SHEET-${stamp}-${index}`,
          channel: 'online',
          recipientInfo,
          items: [{ name: `手机表格产品${index}`, sku: `MOBILE-SHEET-${stamp}-${index}`, packCount: 10, quantity: 10 }],
        });
        orders.push({ ...order, recipientInfo });
        await advanceToShipping(page, order.id);
      }

      await page.goto('/');
      await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
      await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
      await page.locator('.orders-channel-tabs').getByRole('tab', { name: /线上订单/ }).click();
      await openShippingStatusView(page);
      for (const order of orders) {
        await page.locator('.orders-shipping-mobile-card', { hasText: order.orderNo }).getByRole('checkbox').check();
      }
      const bar = page.getByRole('region', { name: '发货表批量操作' });
      await expect(bar).toContainText('已选 2 单');
      await bar.getByRole('button', { name: '查看发货表' }).click();
      const drawer = page.getByRole('dialog', { name: '发货表' });
      await expect(drawer).toBeVisible();
      const value = await drawer.getByRole('textbox', { name: '发货表' }).inputValue();
      for (const order of orders) expect(value).toContain(order.recipientInfo);
      expect(value.split('\n\n')).toHaveLength(2);
      await drawer.getByRole('button', { name: '关闭' }).click();
    } finally {
      await cleanupOrders(page, orders.map((order) => order.id));
    }
  });
});
