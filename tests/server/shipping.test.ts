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
  await registerShippingRoutes(app, { repositories });
  apps.push(app);
  return { database, repositories, app };
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
});
