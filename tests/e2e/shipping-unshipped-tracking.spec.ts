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
      // 原发货模块入口必须消失，避免两套发货入口。
      await expect(page.locator('.sidebar-nav').getByRole('button', { name: '发货', exact: true })).toHaveCount(0);
      await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(online.orderNo);
      const row = page.locator('.orders-table-desktop tbody tr', { hasText: online.orderNo }).first();
      await expect(row.locator('.order-status-cell')).toContainText('待发货');

      await row.getByRole('button', { name: '发货', exact: true }).click();
      // 只改状态，不自动切到发货中视图；当前还是普通订单表格。
      await expect(page.getByText('发货工作区')).toHaveCount(0);
      await expect(page.locator('.orders-data-table')).toBeVisible();
      await expect(row.locator('.order-status-cell')).toContainText('发货中');

      // 当前渠道只看当前渠道的发货中订单。
      await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(offline.orderNo);
      await expect(page.locator('.orders-table-desktop tbody tr', { hasText: offline.orderNo })).toHaveCount(0);
      await page.getByPlaceholder('搜索订单号、客户、收件人、品名、SKU、规格').fill(online.orderNo);

      await row.getByRole('button', { name: '继续发货', exact: true }).click();
      await expect(page.locator('.orders-page .status-cards .status-card', { hasText: '发货中' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.shipping-address-group', { hasText: online.orderNo })).toBeVisible();

      await page.locator('.orders-channel-tabs').getByRole('tab', { name: /线下订单/ }).click();
      await expect(page.locator('.shipping-address-group', { hasText: online.orderNo })).toHaveCount(0);
    } finally {
      await cleanupOrders(page, [online.id, offline.id]);
    }
  });

  test('同地址三单合并：2箱 + 3箱 + 5箱，发货表保留拆解并共用单号确认', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
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
      const group = page.locator('.shipping-address-group', { hasText: recipientInfo });
      await expect(group).toBeVisible();
      for (const order of orders) await expect(group).toContainText(order.orderNo);
      await expect(group).toContainText('2箱 + 3箱 + 5箱 = 10箱');

      // 拆开后每单独立，再并回同一地址组，箱数拆解恢复。
      await group.getByRole('button', { name: '拆开' }).click();
      await expect(page.locator('.shipping-address-group', { hasText: orders[0]!.orderNo })).toContainText('2箱');
      await expect(page.locator('.shipping-address-group', { hasText: orders[2]!.orderNo })).toContainText('5箱');
      await page.locator('.shipping-address-group', { hasText: orders[0]!.orderNo }).getByRole('button', { name: '合并地址' }).click();
      await expect(group).toContainText('2箱 + 3箱 + 5箱 = 10箱');

      const trackingNo = `SF-MERGE-${stamp}`;
      await group.getByRole('textbox', { name: '合并物流单号-合并收件人' }).fill(trackingNo);
      const sheet = page.getByRole('textbox', { name: '发货表' });
      await expect.poll(async () => sheet.inputValue()).toContain(`2箱 + 3箱 + 5箱 ${recipientInfo}`);

      await group.getByRole('button', { name: '确认合并发货' }).click();
      await expect(page.getByText('已确认 3 单本次发货')).toBeVisible();
      await expect(group).toHaveCount(0);
      await expect(page.getByRole('button', { name: '下载本批发货清单' })).toBeVisible();

      let batchId: number | undefined;
      for (const order of orders) {
        const detail = await (await page.request.get(`/api/orders/${order.id}`)).json();
        expect(detail.data.status).toBe('shipped');
        const history = await (await page.request.get(`/api/shipping/orders/${order.id}/shipments`)).json();
        expect(history.data).toHaveLength(1);
        expect(history.data[0].trackingNo).toBe(trackingNo);
        if (batchId == null) batchId = Number(history.data[0].batchId);
        expect(Number(history.data[0].batchId)).toBe(batchId);
      }
    } finally {
      await cleanupOrders(page, orders.map((order) => order.id));
    }
  });

  test('按数量分批发货：部分发完留在发货中，全部发完转已发货', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const stamp = Date.now();
    const order = await seedOrder(page, {
      orderNo: `E2E-SHIP-PART-${stamp}`,
      channel: 'online',
      recipientName: '分批收件人',
      recipientInfo: `杭州市西湖区分批发货${stamp}号`,
      items: [
        { name: '圆砂机', sku: `PART-A-${stamp}`, packCount: 10, quantity: 10 },
        { name: '水枪', sku: `PART-B-${stamp}`, packCount: 5, quantity: 5 },
      ],
    });
    try {
      await advanceToShipping(page, order.id);
      await openOrders(page, 'online');
      await openShippingStatusView(page);
      const group = page.locator('.shipping-address-group', { hasText: order.orderNo });
      await expect(group).toBeVisible();

      await page.getByLabel(`${order.orderNo}-圆砂机-本次数量`).fill('4');
      await group.getByRole('textbox', { name: `${order.orderNo}物流单号` }).fill(`SF-PART-1-${stamp}`);
      await group.getByRole('button', { name: '确认本次发货' }).click();
      await expect(page.getByText('已确认 1 单本次发货')).toBeVisible();

      const partial = await (await page.request.get(`/api/orders/${order.id}`)).json();
      expect(partial.data.status).toBe('shipping');
      expect(partial.data.items.find((item: { sku: string }) => item.sku === `PART-A-${stamp}`).shipped_quantity).toBe(4);
      expect(partial.data.items.find((item: { sku: string }) => item.sku === `PART-B-${stamp}`).shipped_quantity).toBe(5);
      await expect(group).toBeVisible();
      await expect(page.getByLabel(`${order.orderNo}-圆砂机-本次数量`)).toHaveValue('6');
      // 水枪已全部发完，不再出现在本次可发行里。
      await expect(page.getByLabel(`${order.orderNo}-水枪-本次数量`)).toHaveCount(0);

      await group.getByRole('textbox', { name: `${order.orderNo}物流单号` }).fill(`SF-PART-2-${stamp}`);
      await group.getByRole('button', { name: '确认本次发货' }).click();
      await expect(group).toHaveCount(0);

      const completed = await (await page.request.get(`/api/orders/${order.id}`)).json();
      expect(completed.data.status).toBe('shipped');
      expect(completed.data.items.every((item: { shipped_quantity: number; quantity: number }) => item.shipped_quantity === item.quantity)).toBe(true);
      const history = await (await page.request.get(`/api/shipping/orders/${order.id}/shipments`)).json();
      expect(history.data).toHaveLength(2);
    } finally {
      await cleanupOrders(page, [order.id]);
    }
  });

  test('未收款可以进入发货中，但确认发货按钮置灰；单号暂存刷新后还在', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const stamp = Date.now();
    const order = await seedOrder(page, {
      orderNo: `E2E-SHIP-UNPAID-${stamp}`,
      channel: 'online',
      recipientName: '未收款收件人',
      recipientInfo: `杭州市西湖区未收款${stamp}号`,
      amount: 100,
      items: [{ name: '未收款产品', sku: `UNPAID-${stamp}`, packCount: 10, quantity: 10 }],
    });
    try {
      await advanceToShipping(page, order.id);
      await openOrders(page, 'online');
      await openShippingStatusView(page);
      const group = page.locator('.shipping-address-group', { hasText: order.orderNo });
      await expect(group).toBeVisible();
      await expect(group).toContainText('未收款');
      await expect(group.getByRole('button', { name: '确认本次发货' })).toBeDisabled();

      const trackingInput = group.getByRole('textbox', { name: `${order.orderNo}物流单号` });
      const trackingNo = `SF-UNPAID-${stamp}`;
      const patch = page.waitForResponse((response) => (
        new URL(response.url()).pathname === `/api/orders/${order.id}/tracking` && response.request().method() === 'PATCH'
      ));
      await trackingInput.fill(trackingNo);
      await trackingInput.blur();
      expect((await patch).status()).toBe(200);

      await page.reload();
      await openOrders(page, 'online');
      await openShippingStatusView(page);
      await expect(page.locator('.shipping-address-group', { hasText: order.orderNo }).getByRole('textbox', { name: `${order.orderNo}物流单号` })).toHaveValue(trackingNo);
    } finally {
      await cleanupOrders(page, [order.id]);
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

  test('发货中勾选两个地址组，一次确认发货', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const stamp = Date.now();
    const orders: Array<{ id: number; orderNo: string; recipientInfo: string }> = [];
    try {
      for (const index of [1, 2]) {
        const recipientInfo = `杭州市西湖区批量确认${stamp}号${index}`;
        const order = await seedOrder(page, {
          orderNo: `E2E-SHIP-BATCH-CONFIRM-${stamp}-${index}`,
          channel: 'online',
          recipientInfo,
          items: [{ name: `批量确认产品${index}`, sku: `BATCH-CONFIRM-${stamp}-${index}`, packCount: 10, quantity: 10 }],
        });
        orders.push({ ...order, recipientInfo });
        await advanceToShipping(page, order.id);
      }

      await openOrders(page, 'online');
      await openShippingStatusView(page);
      for (const [index, order] of orders.entries()) {
        const group = page.locator('.shipping-address-group', { hasText: order.orderNo });
        await group.locator('.shipping-address-head input[type="checkbox"]').check();
        await group.getByRole('textbox', { name: `${order.orderNo}物流单号` }).fill(`SF-BATCH-${stamp}-${index + 1}`);
      }
      const bulk = page.locator('.shipping-progress-bulk');
      await expect(bulk).toContainText('已选 2 个地址 · 2 单');
      await bulk.getByRole('button', { name: '确认选中发货' }).click();
      await expect(page.getByText('已确认 2 单本次发货')).toBeVisible();
      for (const order of orders) await expect(page.locator('.shipping-address-group', { hasText: order.orderNo })).toHaveCount(0);

      let batchId: number | undefined;
      for (const order of orders) {
        const detail = await (await page.request.get(`/api/orders/${order.id}`)).json();
        expect(detail.data.status).toBe('shipped');
        const history = await (await page.request.get(`/api/shipping/orders/${order.id}/shipments`)).json();
        expect(history.data).toHaveLength(1);
        if (batchId == null) batchId = Number(history.data[0].batchId);
        expect(Number(history.data[0].batchId)).toBe(batchId);
      }
    } finally {
      await cleanupOrders(page, orders.map((order) => order.id));
    }
  });

  test('手机端发货中卡片不横滑，能展开地址组', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const stamp = Date.now();
    const order = await seedOrder(page, {
      orderNo: `E2E-SHIP-MOBILE-${stamp}`,
      channel: 'online',
      recipientName: '手机发货收件人',
      recipientInfo: `杭州市西湖区手机发货${stamp}号`,
      items: [{ name: '手机发货产品', sku: `MOBILE-${stamp}`, packCount: 10, quantity: 20 }],
    });
    try {
      await advanceToShipping(page, order.id);
      await page.goto('/');
      await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
      await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
      await page.locator('.orders-channel-tabs').getByRole('tab', { name: /线上订单/ }).click();
      await page.locator('.orders-page .status-cards .status-card', { hasText: '发货中' }).click();
      const group = page.locator('.shipping-address-group', { hasText: order.orderNo });
      await expect(group).toBeVisible();
      const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    } finally {
      await cleanupOrders(page, [order.id]);
    }
  });
});
