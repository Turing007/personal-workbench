import type { FastifyInstance } from 'fastify';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { migrateDatabase } from '../../src/server/db/migrate';
import { authInject, setupAdmin } from './helpers/auth';

const contexts: Array<{ app: FastifyInstance; database: DatabaseSync }> = [];

afterEach(() => {
  while (contexts.length) {
    const context = contexts.pop()!;
    context.database.close();
  }
});

async function testApp(): Promise<{ app: FastifyInstance; database: DatabaseSync }> {
  const database = new DatabaseSync(':memory:');
  migrateDatabase(database);
  const app = await createApp({ database });
  await setupAdmin(app);
  contexts.push({ app, database });
  return { app, database };
}

async function createProduct(app: FastifyInstance, name: string, supplier: string): Promise<number> {
  const product = await authInject(app, {
    method: 'POST',
    url: '/api/products',
    payload: {
      name,
      specification: '标准',
      sku: '',
      supplier,
      status: 'active',
      packaging: [{ name: '彩盒', innerSize: '', innerWeight: 0, outerSize: '', outerWeight: 0, packCount: 100 }],
    },
  });
  expect(product.statusCode).toBe(201);
  return Number(product.json().data.id);
}

async function createOrder(app: FastifyInstance, orderedAt: string, items: Array<Record<string, unknown>>): Promise<{ id: number; orderNo: string }> {
  const created = await authInject(app, {
    method: 'POST',
    url: '/api/orders',
    payload: {
      orderNo: '',
      orderedAt,
      channel: 'offline',
      recipientName: '张三',
      recipientInfo: '',
      amount: 0,
      trackingNo: '',
      paymentNote: '',
      remark: '',
      items,
    },
  });
  expect(created.statusCode).toBe(201);
  return { id: Number(created.json().data.id), orderNo: String(created.json().data.order_no ?? '') };
}

async function seedTwoSuppliers(app: FastifyInstance) {
  const productA = await createProduct(app, '甲款脚', '甲供');
  const productB = await createProduct(app, '乙款脚', '乙供');
  const exclusive = await createOrder(app, '2026-09-08T08:00:00.000Z', [
    { name: '甲款脚', productId: productA, sku: '', specification: '标准', quantity: 5, unitPriceCents: 1000 },
  ]);
  const shared = await createOrder(app, '2026-09-08T09:00:00.000Z', [
    { name: '甲款脚', productId: productA, sku: '', specification: '标准', quantity: 2, unitPriceCents: 1000 },
    { name: '乙款脚', productId: productB, sku: '', specification: '标准', quantity: 3, unitPriceCents: 1000 },
  ]);
  return { productA, productB, exclusive, shared };
}

describe('供应商备货确认记录', () => {
  it('确认供应商会记录操作人、时间、产品与订单，并只推进只涉及该供应商的订单', async () => {
    const { app, database } = await testApp();
    const { exclusive, shared } = await seedTwoSuppliers(app);

    const preparation = await authInject(app, { method: 'GET', url: '/api/stock/preparation?date=2026-09-08' });
    expect(preparation.statusCode).toBe(200);
    const groups = preparation.json().data.groups as Array<Record<string, any>>;
    const supplierA = groups.find((group) => group.title === '甲供');
    const supplierB = groups.find((group) => group.title === '乙供');
    expect(supplierA?.items[0]).toMatchObject({ quantity: 7 });
    expect(supplierA?.items[0].orderIds).toEqual([exclusive.id, shared.id]);
    expect(supplierB?.items[0].orderIds).toEqual([shared.id]);

    const confirmed = await authInject(app, {
      method: 'POST',
      url: '/api/stock/confirmations',
      payload: { date: '2026-09-08', supplier: '甲供', note: '电话确认周五到货' },
    });
    expect(confirmed.statusCode).toBe(201);
    const result = confirmed.json().data;
    expect(result.advancedOrderIds).toEqual([exclusive.id]);
    expect(result.pendingOrderIds).toEqual([shared.id]);
    expect(result.failedOrderIds).toEqual([]);
    expect(result.confirmation).toMatchObject({
      supplier: '甲供',
      scope: '2026-09-08',
      channel: '',
      confirmedBy: 'admin',
      note: '电话确认周五到货',
      itemCount: 1,
      totalQuantity: 7,
    });
    expect(result.confirmation.orders).toEqual([
      { orderId: exclusive.id, orderNo: exclusive.orderNo, advanced: true },
      { orderId: shared.id, orderNo: shared.orderNo, advanced: false },
    ]);
    expect(result.confirmation.items[0]).toMatchObject({
      displayName: '甲款脚',
      quantity: 7,
      specs: [{ specification: '标准', quantity: 7 }],
    });

    expect(database.prepare('SELECT status FROM orders WHERE id = ?').get(exclusive.id)?.status).toBe('stock_reported');
    expect(database.prepare('SELECT status FROM orders WHERE id = ?').get(shared.id)?.status).toBe('pending_stock');

    const after = await authInject(app, { method: 'GET', url: '/api/stock/preparation?date=2026-09-08' });
    const afterGroups = after.json().data.groups as Array<Record<string, any>>;
    const afterA = afterGroups.find((group) => group.title === '甲供');
    expect(afterA).toMatchObject({ lastConfirmedBy: 'admin', lastConfirmedOrderCount: 2 });
    expect(typeof afterA?.lastConfirmedAt).toBe('string');

    // 乙供的订单同时涉及甲供，因此只留记录、不推进。
    const second = await authInject(app, {
      method: 'POST',
      url: '/api/stock/confirmations',
      payload: { date: '2026-09-08', supplier: '乙供' },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().data.advancedOrderIds).toEqual([]);
    expect(second.json().data.pendingOrderIds).toEqual([shared.id]);
    expect(database.prepare('SELECT status FROM orders WHERE id = ?').get(shared.id)?.status).toBe('pending_stock');

    const history = await authInject(app, { method: 'GET', url: '/api/stock/confirmations?date=2026-09-08' });
    expect(history.statusCode).toBe(200);
    expect(history.json().data.map((row: Record<string, unknown>) => row.supplier)).toEqual(['乙供', '甲供']);

    const otherDay = await authInject(app, { method: 'GET', url: '/api/stock/confirmations?date=2026-09-09' });
    expect(otherDay.json().data).toEqual([]);

    const audit = await authInject(app, { method: 'GET', url: '/api/audit-logs?action=stock.confirm_supplier' });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().data.total).toBe(2);
    expect(audit.json().data.items[0]).toMatchObject({
      action: 'stock.confirm_supplier',
      summary: '确认供应商备货',
      entityType: 'stock_confirmation',
      username: 'admin',
    });
  });

  it('未知供应商、空供应商与非法参数会被拒绝', async () => {
    const { app } = await testApp();
    await seedTwoSuppliers(app);

    const unknown = await authInject(app, {
      method: 'POST',
      url: '/api/stock/confirmations',
      payload: { date: '2026-09-08', supplier: '不存在的供应商' },
    });
    expect(unknown.statusCode).toBe(409);
    expect(unknown.json().error.code).toBe('SUPPLIER_GROUP_NOT_FOUND');

    const missing = await authInject(app, {
      method: 'POST',
      url: '/api/stock/confirmations',
      payload: { date: '2026-09-08', supplier: '  ' },
    });
    expect(missing.statusCode).toBe(400);

    const badDate = await authInject(app, {
      method: 'POST',
      url: '/api/stock/confirmations',
      payload: { date: '2026/09/08', supplier: '甲供' },
    });
    expect(badDate.statusCode).toBe(400);

    const badChannel = await authInject(app, {
      method: 'POST',
      url: '/api/stock/confirmations',
      payload: { date: '2026-09-08', supplier: '甲供', channel: 'retail' },
    });
    expect(badChannel.statusCode).toBe(400);

    const badLimit = await authInject(app, { method: 'GET', url: '/api/stock/confirmations?limit=abc' });
    expect(badLimit.statusCode).toBe(400);
  });

  it('按渠道确认的记录不会混入全部渠道', async () => {
    const { app } = await testApp();
    await seedTwoSuppliers(app);

    const confirmed = await authInject(app, {
      method: 'POST',
      url: '/api/stock/confirmations',
      payload: { date: '2026-09-08', channel: 'offline', supplier: '甲供' },
    });
    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.json().data.confirmation.channel).toBe('offline');

    const allChannels = await authInject(app, { method: 'GET', url: '/api/stock/confirmations?date=2026-09-08' });
    expect(allChannels.json().data).toHaveLength(1);
    const offline = await authInject(app, { method: 'GET', url: '/api/stock/confirmations?date=2026-09-08&channel=offline' });
    expect(offline.json().data).toHaveLength(1);
    const online = await authInject(app, { method: 'GET', url: '/api/stock/confirmations?date=2026-09-08&channel=online' });
    expect(online.json().data).toHaveLength(0);

    const preparation = await authInject(app, { method: 'GET', url: '/api/stock/preparation?date=2026-09-08&channel=offline' });
    const group = (preparation.json().data.groups as Array<Record<string, any>>).find((entry) => entry.title === '甲供');
    expect(group?.lastConfirmedBy).toBe('admin');
    const onlinePreparation = await authInject(app, { method: 'GET', url: '/api/stock/preparation?date=2026-09-08&channel=online' });
    expect(onlinePreparation.json().data.groups).toEqual([]);
  });
});
