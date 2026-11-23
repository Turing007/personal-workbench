import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

async function navigateToOrders(page: import('@playwright/test').Page) {
  await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
  await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
}

async function openOrdersModule(page: import('@playwright/test').Page) {
  await page.goto('/');
  await navigateToOrders(page);
}

/** 发货前必须确认全额到账：上传并审核一笔水单，让接口推进到 shipped 能通过业务护栏。 */
async function payOrder(page: import('@playwright/test').Page, orderId: number, amountCents: number) {
  const upload = await page.request.post(`/api/finance/orders/${orderId}/proofs`, {
    multipart: {
      file: {
        name: `proof-${orderId}.png`,
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'),
      },
      amountCents: String(amountCents),
      paymentDate: new Date().toISOString().slice(0, 10),
      paymentMethod: '银行转账',
      transactionNo: `TX-${orderId}-${Date.now()}`,
    },
  });
  expect(upload.ok()).toBeTruthy();
  const proofId = Number((await upload.json()).data.id);
  const approved = await page.request.post(`/api/finance/proofs/${proofId}/approve`, { data: {} });
  expect(approved.ok()).toBeTruthy();
}

/**
 * 手机端订单卡片的状态胶囊就是一个按钮：点一下即完成当前流程节点。
 * 断言分三层：胶囊上写的是不是状态机里的下一步、点完有没有推进、刷新后是否仍然保持
 * —— 最后一层用来挡住「只改了前端 state，没真正写回服务端」这类假通过。
 */
test('手机端订单卡片：状态胶囊一键推进，刷新后仍保持新状态', async ({ page }) => {
  const stamp = Date.now();
  const name = `E2E一键推进客户${stamp}`;

  const customerResponse = await page.request.post('/api/customers', {
    data: { name, contactName: '一键推进联系人', contactPhone: '13900000000', shippingInfo: '杭州市西湖区' },
  });
  expect(customerResponse.ok()).toBeTruthy();
  const customer = (await customerResponse.json()).data;

  const orderResponse = await page.request.post('/api/orders', {
    data: {
      orderNo: '',
      orderedAt: new Date().toISOString(),
      customerId: customer.id,
      recipientName: '一键推进联系人',
      recipientInfo: '杭州市西湖区',
      amount: 100,
      trackingNo: '',
      paymentNote: '',
      remark: '',
      settlementType: 'corporate',
      items: [{ name: 'E2E一键推进产品', sku: `E2E-TAP-${stamp}`, specification: '标准', packagingName: '', packCount: 10, quantity: 10, unitPriceCents: 1000 }],
    },
  });
  expect(orderResponse.ok()).toBeTruthy();
  const created = (await orderResponse.json()).data;
  const orderId = Number(created.id ?? created.order_id);
  const orderNo = String(created.order_no);

  try {
    await openOrdersModule(page);

    const card = page.locator('.order-card', { hasText: orderNo });
    await expect(card).toBeVisible();

    // 新建订单落在「待备货」，胶囊上直接写出下一步动作，不用先勾选再找工具条
    const pill = card.locator('.status-action-pill');
    await expect(pill).toBeVisible();
    // 用 aria-label 精确断言：'已备货' 是 '确认已备货' 的子串，用子串匹配会假通过
    await expect(pill).toHaveAttribute('aria-label', '待备货，一键确认已备货');
    await expect(pill.locator('.status-action-pill-current')).toHaveText('待备货');
    await expect(pill.locator('.status-action-pill-next')).toHaveText('确认已备货');

    // 未打印箱唛时，流程会先弹一次确认（沿用桌面端行为）。Playwright 默认自动取消弹窗，
    // 不处理的话点击会被静默吞掉 —— 这里显式接受，才等于真人点掉「确定」。
    page.once('dialog', (dialog) => void dialog.accept());

    // 一键操作：只点一下胶囊
    await pill.click();

    const advanced = page.locator('.order-card', { hasText: orderNo }).locator('.status-action-pill');
    await expect(advanced).toHaveAttribute('aria-label', '已备货，一键开始打包');
    await expect(advanced.locator('.status-action-pill-current')).toHaveText('已备货');

    // 刷新后重新进入模块：状态来自服务端，说明是真的落地了
    await page.reload();
    await navigateToOrders(page);
    const afterReload = page.locator('.order-card', { hasText: orderNo }).locator('.status-action-pill');
    await expect(afterReload).toHaveAttribute('aria-label', '已备货，一键开始打包');

    const detail = await page.request.get(`/api/orders/${orderId}`);
    expect(detail.ok()).toBeTruthy();
    expect((await detail.json()).data.status).toBe('stock_reported');
  } finally {
    await page.request.delete(`/api/orders/${orderId}`);
    await page.request.delete(`/api/customers/${customer.id}`);
  }
});

test('手机端订单卡片：无后续动作的订单仍是只读状态，不出现可点的空按钮', async ({ page }) => {
  const stamp = Date.now();
  const name = `E2E只读胶囊客户${stamp}`;

  const customerResponse = await page.request.post('/api/customers', {
    data: { name, contactName: '只读联系人', contactPhone: '13900000001', shippingInfo: '杭州市西湖区' },
  });
  expect(customerResponse.ok()).toBeTruthy();
  const customer = (await customerResponse.json()).data;

  const orderResponse = await page.request.post('/api/orders', {
    data: {
      orderNo: '',
      orderedAt: new Date().toISOString(),
      customerId: customer.id,
      recipientName: '只读联系人',
      recipientInfo: '杭州市西湖区',
      amount: 100,
      trackingNo: '',
      paymentNote: '',
      remark: '',
      settlementType: 'corporate',
      items: [{ name: 'E2E只读胶囊产品', sku: `E2E-TAP-RO-${stamp}`, specification: '标准', packagingName: '', packCount: 10, quantity: 10, unitPriceCents: 1000 }],
    },
  });
  expect(orderResponse.ok()).toBeTruthy();
  const created = (await orderResponse.json()).data;
  const orderId = Number(created.id ?? created.order_id);
  const orderNo = String(created.order_no);
  let proofId: number | undefined;

  try {
    // 走到「已发货」为止：状态机在终点没有下一步，胶囊必须退回只读徽章。
    // 服务端只允许按顺序逐步推进，所以这里逐级调接口而不是一步跳到底。
    for (const step of [{ to: 'stock_reported' }, { to: 'pending_packing' }, { to: 'ship_pending' }]) {
      const advance = await page.request.post(`/api/orders/${orderId}/status`, { data: step });
      expect(advance.ok()).toBeTruthy();
    }
    proofId = await payOrder(page, orderId, 10000);
    const detail = await (await page.request.get(`/api/orders/${orderId}/detail`)).json();
    const item = detail.data.items[0] as { id: number; quantity: number };
    const shipped = await page.request.post('/api/shipping/partial', {
      data: { orders: [{ orderId, trackingNo: `E2E-TRACK-${stamp}`, items: [{ orderItemId: item.id, quantity: item.quantity }] }] },
    });
    expect(shipped.ok()).toBeTruthy();

    await openOrdersModule(page);
    const card = page.locator('.order-card', { hasText: orderNo });
    await expect(card).toBeVisible();
    await expect(card.locator('.order-card-head')).toContainText('已发货');
    await expect(card.locator('.status-action-pill')).toHaveCount(0);
  } finally {
    const shipments = await page.request.get(`/api/shipping/orders/${orderId}/shipments`);
    if (shipments.ok()) {
      for (const shipment of (await shipments.json()).data) await page.request.delete(`/api/shipping/shipments/${shipment.id}`);
    }
    if (proofId != null) await page.request.post(`/api/finance/proofs/${proofId}/void`, { data: { note: 'e2e 清理' } });
    await page.request.delete(`/api/orders/${orderId}`);
    await page.request.delete(`/api/customers/${customer.id}`);
  }
});
