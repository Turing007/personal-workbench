import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { DatabaseRepositories } from '../../src/server/db/repositories';
import { CustomerRepository } from '../../src/server/db/customer-repository';
import { CustomerProductRepository } from '../../src/server/db/customer-product-repository';
import { registerOrderRoutes } from '../../src/server/routes/orders';
import { registerShippingRoutes } from '../../src/server/routes/shipping';
import { renderShippingListHtml } from '../../src/server/documents/shipping-list-template';

const directories: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeContext() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-shipping-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  const repositories = new DatabaseRepositories(database);
  const app = Fastify();
  const orderOptions = {
    repositories,
    customerRepository: new CustomerRepository(database),
    customerProductRepository: new CustomerProductRepository(database),
  };
  await registerOrderRoutes(app, orderOptions);
  const pdfCalls: string[] = [];
  await registerShippingRoutes(app, {
    repositories,
    settingsRepository: {
      getCompanyProfile: () => ({ name: '杭州维高工具', phone: '0571-88888888', address: '杭州市余杭区', logoRelativePath: 'company-logos/logo.png', defaultIssuer: '', wechatQrRelativePath: null }),
    },
    fileStore: { readFile: async () => Buffer.from('LOGO') },
    pdfRenderer: {
      render: async (html: string) => {
        pdfCalls.push(html);
        return Buffer.from('MOCK-PDF');
      },
    },
  });
  apps.push(app);
  return { database, repositories, app, pdfCalls };
}

function markPaid(database: ReturnType<typeof openDatabase>, orderId: number): void {
  const amountCents = Number(database.prepare('SELECT amount_cents FROM orders WHERE id = ?').get(orderId)?.amount_cents ?? 0);
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO finance_receipts (order_id, received_at, amount_cents, created_at, updated_at)
     VALUES (?, '2026-08-10', ?, ?, ?)`,
  ).run(orderId, amountCents, now, now);
  database.prepare(
    `UPDATE order_finance SET received_cents = ?, outstanding_cents = 0, payment_status = 'paid', updated_at = ? WHERE order_id = ?`,
  ).run(amountCents, now, orderId);
}

function orderPayload(orderNo: string) {
  return {
    orderNo,
    orderedAt: '2026-08-10T08:00:00.000Z',
    recipientName: '张三',
    recipientInfo: '深圳市宝安区',
    items: [{ name: '测试产品', sku: 'VT-0001', specification: '标准规格', packagingName: '彩盒包装', packCount: 10, quantity: 10, unitPriceCents: 1000 }],
  };
}

async function createShipPendingOrder(app: FastifyInstance, orderNo: string): Promise<number> {
  const created = await app.inject({ method: 'POST', url: '/api/orders', payload: orderPayload(orderNo) });
  expect(created.statusCode).toBe(201);
  const orderId = Number(created.json().data.id);
  for (const to of ['stock_reported', 'pending_packing', 'ship_pending']) {
    const advanced = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/status`, payload: { to } });
    expect(advanced.statusCode).toBe(200);
  }
  return orderId;
}

describe('发货确认事务', () => {
  it('建批次、写单号、确认发货一次完成', async () => {
    const { database, app } = await makeContext();
    const orderId = await createShipPendingOrder(app, 'SO-SHIP-1');
    markPaid(database, orderId);

    const confirmed = await app.inject({
      method: 'POST',
      url: '/api/shipping/confirm',
      payload: { orders: [{ orderId, trackingNo: 'SF10001' }] },
    });
    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.json().data.status).toBe('confirmed');
    expect(database.prepare('SELECT status, tracking_no FROM orders WHERE id = ?').get(orderId)).toEqual({ status: 'shipped', tracking_no: 'SF10001' });
    expect(database.prepare('SELECT COUNT(*) AS n FROM shipment_batches WHERE status = ?').get('confirmed')).toEqual({ n: 1 });
    expect(database.prepare('SELECT COUNT(*) AS n FROM shipment_batches WHERE status = ?').get('draft')).toEqual({ n: 0 });
    expect(database.prepare('SELECT COUNT(*) AS n FROM shipments WHERE order_id = ?').get(orderId)).toEqual({ n: 1 });
    database.close();
  });

  it('任一订单不满足发货条件时整批回滚，不留草稿批次', async () => {
    const { database, app } = await makeContext();
    const readyOrderId = await createShipPendingOrder(app, 'SO-SHIP-2');
    markPaid(database, readyOrderId);
    const created = await app.inject({ method: 'POST', url: '/api/orders', payload: orderPayload('SO-SHIP-3') });
    const pendingOrderId = Number(created.json().data.id);

    const failed = await app.inject({
      method: 'POST',
      url: '/api/shipping/confirm',
      payload: { orders: [{ orderId: readyOrderId, trackingNo: 'SF10002' }, { orderId: pendingOrderId, trackingNo: 'SF10003' }] },
    });
    expect(failed.statusCode).toBe(400);
    expect(database.prepare('SELECT status FROM orders WHERE id = ?').get(readyOrderId)).toEqual({ status: 'ship_pending' });
    expect(database.prepare('SELECT COUNT(*) AS n FROM shipment_batches').get()).toEqual({ n: 0 });
    expect(database.prepare('SELECT COUNT(*) AS n FROM shipments').get()).toEqual({ n: 0 });
    database.close();
  });

  it('未确认收到货款时不能确认发货，也不产生批次', async () => {
    const { database, app } = await makeContext();
    const orderId = await createShipPendingOrder(app, 'SO-SHIP-4');

    const failed = await app.inject({
      method: 'POST',
      url: '/api/shipping/confirm',
      payload: { orders: [{ orderId, trackingNo: 'SF10004' }] },
    });
    expect(failed.statusCode).toBe(400);
    expect(failed.json().error.message).toContain('未确认收到货款');
    expect(database.prepare('SELECT status FROM orders WHERE id = ?').get(orderId)).toEqual({ status: 'ship_pending' });
    expect(database.prepare('SELECT COUNT(*) AS n FROM shipment_batches').get()).toEqual({ n: 0 });
    expect(database.prepare('SELECT COUNT(*) AS n FROM shipments').get()).toEqual({ n: 0 });
    database.close();
  });

  it('全部货款审核入账后才允许发货', async () => {
    const { database, app } = await makeContext();
    const orderId = await createShipPendingOrder(app, 'SO-SHIP-5');
    markPaid(database, orderId);

    const confirmed = await app.inject({
      method: 'POST',
      url: '/api/shipping/confirm',
      payload: { orders: [{ orderId, trackingNo: 'SF10005' }] },
    });
    expect(confirmed.statusCode).toBe(201);
    expect(database.prepare('SELECT status FROM orders WHERE id = ?').get(orderId)).toEqual({ status: 'shipped' });
    database.close();
  });

  it('按产品数量部分发货、生成清单、全部发完后自动完成，并可按次撤销', async () => {
    const { database, app, pdfCalls } = await makeContext();
    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        ...orderPayload('SO-PARTIAL-1'),
        items: [
          { name: '圆砂机', sku: 'ANGLE-1', specification: '20V', packagingName: '彩盒', packCount: 10, quantity: 10, unitPriceCents: 1000 },
          { name: '水枪', sku: 'GUN-1', specification: 'MT', packagingName: '彩盒', packCount: 5, quantity: 5, unitPriceCents: 800 },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const orderId = Number(created.json().data.id);
    for (const to of ['stock_reported', 'pending_packing', 'ship_pending', 'shipping']) {
      const advanced = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/status`, payload: { to } });
      expect(advanced.statusCode).toBe(200);
    }
    markPaid(database, orderId);
    const detail = await app.inject({ method: 'GET', url: `/api/orders/${orderId}/detail` });
    const [angle, gun] = detail.json().data.items as Array<{ id: number }>;

    const first = await app.inject({
      method: 'POST',
      url: '/api/shipping/partial',
      payload: { orders: [{ orderId, trackingNo: 'SF-PART-1', items: [{ orderItemId: angle.id, quantity: 4 }] }] },
    });
    expect(first.statusCode).toBe(201);
    const firstShipment = first.json().data.shipments[0];
    expect(firstShipment.items[0]).toMatchObject({ quantity: 4, boxes: 1, remainingAfter: 6 });
    expect(database.prepare('SELECT status, tracking_no FROM orders WHERE id = ?').get(orderId)).toEqual({ status: 'shipping', tracking_no: 'SF-PART-1' });
    expect(database.prepare('SELECT shipped_quantity FROM order_items WHERE id = ?').get(angle.id)).toEqual({ shipped_quantity: 4 });

    const over = await app.inject({
      method: 'POST',
      url: '/api/shipping/partial',
      payload: { orders: [{ orderId, trackingNo: 'SF-OVER', items: [{ orderItemId: angle.id, quantity: 7 }] }] },
    });
    expect(over.statusCode).toBe(400);
    expect(over.json().error.message).toContain('最多还能发 6');

    const pdf = await app.inject({ method: 'GET', url: `/api/shipping/shipments/${firstShipment.id}/pdf` });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdfCalls.at(-1)).toContain('发货清单');
    expect(pdfCalls.at(-1)).toContain('圆砂机');
    expect(pdfCalls.at(-1)).toContain('剩余数量');

    const final = await app.inject({
      method: 'POST',
      url: '/api/shipping/partial',
      payload: {
        orders: [{
          orderId,
          trackingNo: 'SF-PART-2',
          items: [{ orderItemId: angle.id, quantity: 6 }, { orderItemId: gun.id, quantity: 5 }],
        }],
      },
    });
    expect(final.statusCode).toBe(201);
    const finalShipment = final.json().data.shipments[0];
    expect(database.prepare('SELECT status FROM orders WHERE id = ?').get(orderId)).toEqual({ status: 'shipped' });
    expect(database.prepare('SELECT shipped_quantity FROM order_items WHERE id = ?').get(angle.id)).toEqual({ shipped_quantity: 10 });
    expect(database.prepare('SELECT shipped_quantity FROM order_items WHERE id = ?').get(gun.id)).toEqual({ shipped_quantity: 5 });

    const history = await app.inject({ method: 'GET', url: `/api/shipping/orders/${orderId}/shipments` });
    expect(history.statusCode).toBe(200);
    expect(history.json().data).toHaveLength(2);

    const removed = await app.inject({ method: 'DELETE', url: `/api/shipping/shipments/${finalShipment.id}` });
    expect(removed.statusCode).toBe(200);
    expect(database.prepare('SELECT status FROM orders WHERE id = ?').get(orderId)).toEqual({ status: 'shipping' });
    expect(database.prepare('SELECT shipped_quantity FROM order_items WHERE id = ?').get(angle.id)).toEqual({ shipped_quantity: 4 });
    expect(database.prepare('SELECT shipped_quantity FROM order_items WHERE id = ?').get(gun.id)).toEqual({ shipped_quantity: 0 });

    const blockedEdit = await app.inject({
      method: 'PUT',
      url: `/api/orders/${orderId}`,
      payload: {
        ...orderPayload('SO-PARTIAL-1'),
        items: [
          { name: '圆砂机', sku: 'ANGLE-1', specification: '20V', packagingName: '彩盒', packCount: 10, quantity: 9, unitPriceCents: 1000 },
          { name: '水枪', sku: 'GUN-1', specification: 'MT', packagingName: '彩盒', packCount: 5, quantity: 5, unitPriceCents: 800 },
        ],
      },
    });
    expect(blockedEdit.statusCode).toBe(400);
    expect(blockedEdit.json().error.message).toContain('不能修改');

    const current = (await app.inject({ method: 'GET', url: `/api/orders/${orderId}/detail` })).json().data;
    const allowedEdit = await app.inject({
      method: 'PUT',
      url: `/api/orders/${orderId}`,
      payload: {
        orderNo: current.order_no,
        orderedAt: current.ordered_at,
        customerId: current.customer_id,
        recipientName: current.recipient_name,
        recipientInfo: current.recipient_info,
        channel: current.channel,
        settlementType: current.settlement_type,
        companyId: current.company_id,
        shippingCents: current.shipping_cents,
        remark: '发货后只改备注',
        items: current.items.map((item: Record<string, unknown>) => ({
          customerProductId: item.customer_product_id,
          productId: item.product_id,
          name: item.name,
          sku: item.sku,
          specification: item.specification,
          packCount: item.pack_count,
          quantity: item.quantity,
          unitPriceCents: item.unit_price_cents,
          freightPerBoxCents: item.freight_per_box_cents,
          packaging: (item.packaging as Array<Record<string, unknown>>).map((pack) => ({ name: pack.name, packCount: pack.packCount })),
          remark: item.remark,
          labelRequirement: item.label_requirement,
          machineCostCents: item.machine_cost_cents,
          batteryCostCents: item.battery_cost_cents,
          chargerCostCents: item.charger_cost_cents,
          packagingCostCents: item.packaging_cost_cents,
          accessoryCostCents: item.accessory_cost_cents,
          otherCostCents: item.other_cost_cents,
          costConfirmed: Boolean(item.cost_confirmed),
        })),
      },
    });
    expect(allowedEdit.statusCode).toBe(200);
    expect(allowedEdit.json().data.remark).toBe('发货后只改备注');
    expect(database.prepare('SELECT id, shipped_quantity FROM order_items WHERE id = ?').get(angle.id)).toEqual({ id: angle.id, shipped_quantity: 4 });
    database.close();
  });

  it('发货清单按北京时间显示发货日期和打印时间', () => {
    const html = renderShippingListHtml([{
      id: 1,
      shipmentNo: 'SO-1-FH1',
      orderId: 1,
      orderNo: 'SO-1',
      batchId: null,
      batchNo: '',
      trackingNo: 'SF1',
      shippedAt: '2026-08-10T01:30:00.000Z',
      totalBoxes: 1,
      customerName: '客户',
      recipientName: '张三',
      recipientInfo: '深圳市宝安区',
      remark: '',
      companyName: '',
      items: [],
    }], { generatedAt: '2026-08-10T18:05:00.000Z' });
    expect(html).toContain('2026-08-10 09:30');
    expect(html).toContain('2026-08-11 02:05');
  });

  it('发货前按当前填写的本次数量打印发货清单，不写发货记录、不改已发数量', async () => {
    const { database, app, pdfCalls } = await makeContext();
    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        ...orderPayload('SO-LIST-1'),
        items: [
          { name: '圆砂机', sku: 'ANGLE-LIST', specification: '20V', packagingName: '彩盒', packCount: 10, quantity: 10, unitPriceCents: 1000 },
          { name: '水枪', sku: 'GUN-LIST', specification: 'MT', packagingName: '彩盒', packCount: 5, quantity: 5, unitPriceCents: 800 },
        ],
      },
    });
    const orderId = Number(created.json().data.id);
    for (const to of ['stock_reported', 'pending_packing', 'ship_pending']) {
      const advanced = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/status`, payload: { to } });
      expect(advanced.statusCode).toBe(200);
    }
    const detail = await app.inject({ method: 'GET', url: `/api/orders/${orderId}/detail` });
    const [angle, gun] = detail.json().data.items as Array<{ id: number }>;
    const print = (items: Array<{ orderItemId: number; quantity: number }>, trackingNo = 'SF-LIST-1', id: number | string = orderId) =>
      app.inject({ method: 'POST', url: `/api/shipping/orders/${id}/list-preview`, payload: { trackingNo, items } });

    const notShipping = await print([{ orderItemId: angle.id, quantity: 10 }]);
    expect(notShipping.statusCode).toBe(400);
    expect(notShipping.json().error.message).toContain('发货中');

    const advanced = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/status`, payload: { to: 'shipping' } });
    expect(advanced.statusCode).toBe(200);

    const missing = await app.inject({ method: 'POST', url: `/api/shipping/orders/${orderId}/list-preview`, payload: { trackingNo: '' } });
    expect(missing.statusCode).toBe(400);
    const nothing = await print([{ orderItemId: angle.id, quantity: 0 }, { orderItemId: gun.id, quantity: 0 }]);
    expect(nothing.statusCode).toBe(400);
    expect(nothing.json().error.message).toContain('没有选择发货产品');
    const over = await print([{ orderItemId: angle.id, quantity: 11 }]);
    expect(over.statusCode).toBe(400);
    expect(over.json().error.message).toContain('最多还能发 10');
    const foreignItem = await print([{ orderItemId: angle.id + 1000, quantity: 1 }]);
    expect(foreignItem.statusCode).toBe(400);
    expect(foreignItem.json().error.message).toContain('不存在产品行');
    const unknownOrder = await print([{ orderItemId: angle.id, quantity: 1 }], 'SF-X', 999999);
    expect(unknownOrder.statusCode).toBe(404);
    expect(pdfCalls).toHaveLength(0);

    const preview = await print([{ orderItemId: angle.id, quantity: 4 }, { orderItemId: gun.id, quantity: 0 }]);
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toContain('application/pdf');
    expect(preview.headers['content-disposition']).toContain(`${encodeURIComponent('SO-LIST-1-发货清单.pdf')}`);
    expect(pdfCalls).toHaveLength(1);
    expect(pdfCalls[0]).toContain('圆砂机');
    expect(pdfCalls[0]).not.toContain('水枪');
    expect(pdfCalls[0]).toContain('SF-LIST-1');
    expect(pdfCalls[0]).toContain('本次合计数量：<strong>4</strong>');
    expect(pdfCalls[0]).toContain('本次合计箱数：<strong>1</strong>');
    // 抬头：设置里的公司名 + 公司 logo（内联 data URL）
    expect(pdfCalls[0]).toContain('杭州维高工具');
    expect(pdfCalls[0]).toContain('data:image/png;base64,');

    expect(database.prepare('SELECT status, tracking_no FROM orders WHERE id = ?').get(orderId)).toEqual({ status: 'shipping', tracking_no: '' });
    expect(database.prepare('SELECT COUNT(*) AS n FROM shipments WHERE order_id = ?').get(orderId)).toEqual({ n: 0 });
    expect(database.prepare('SELECT shipped_quantity FROM order_items WHERE id = ?').get(angle.id)).toEqual({ shipped_quantity: 0 });
    database.close();
  });

  it('同地址合并发货：多单同一单号、同一批次，分别生成发货记录', async () => {
    const { database, app } = await makeContext();
    const firstOrderId = await createShipPendingOrder(app, 'SO-MERGE-1');
    const secondOrderId = await createShipPendingOrder(app, 'SO-MERGE-2');
    for (const orderId of [firstOrderId, secondOrderId]) {
      const advanced = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/status`, payload: { to: 'shipping' } });
      expect(advanced.statusCode).toBe(200);
      markPaid(database, orderId);
    }
    const firstDetail = await app.inject({ method: 'GET', url: `/api/orders/${firstOrderId}/detail` });
    const secondDetail = await app.inject({ method: 'GET', url: `/api/orders/${secondOrderId}/detail` });
    const firstItem = firstDetail.json().data.items[0] as { id: number; quantity: number };
    const secondItem = secondDetail.json().data.items[0] as { id: number; quantity: number };

    const confirmed = await app.inject({
      method: 'POST',
      url: '/api/shipping/partial',
      payload: {
        orders: [
          { orderId: firstOrderId, trackingNo: 'SF-MERGE-1', items: [{ orderItemId: firstItem.id, quantity: firstItem.quantity }] },
          { orderId: secondOrderId, trackingNo: 'SF-MERGE-1', items: [{ orderItemId: secondItem.id, quantity: secondItem.quantity }] },
        ],
      },
    });
    expect(confirmed.statusCode).toBe(201);
    const result = confirmed.json().data as { batchId: number; shipments: Array<{ orderId: number; trackingNo: string }> };
    expect(result.shipments).toHaveLength(2);
    expect(result.shipments.every((shipment) => shipment.trackingNo === 'SF-MERGE-1')).toBe(true);
    expect(database.prepare('SELECT batch_id, tracking_no FROM shipments WHERE order_id IN (?, ?) ORDER BY order_id').all(firstOrderId, secondOrderId))
      .toEqual([
        { batch_id: result.batchId, tracking_no: 'SF-MERGE-1' },
        { batch_id: result.batchId, tracking_no: 'SF-MERGE-1' },
      ]);
    expect(database.prepare('SELECT status FROM orders WHERE id IN (?, ?) ORDER BY id').all(firstOrderId, secondOrderId))
      .toEqual([{ status: 'shipped' }, { status: 'shipped' }]);
    database.close();
  });
});
