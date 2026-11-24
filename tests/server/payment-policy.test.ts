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
import { registerReconciliationRoutes } from '../../src/server/routes/reconciliation';

const directories: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeContext() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-payment-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  const repositories = new DatabaseRepositories(database);
  const customers = new CustomerRepository(database);
  const app = Fastify();
  const orderOptions = {
    repositories,
    customerRepository: customers,
    customerProductRepository: new CustomerProductRepository(database),
  };
  await registerOrderRoutes(app, orderOptions);
  await registerShippingRoutes(app, { repositories });
  await registerReconciliationRoutes(app, {
    repositories,
    settingsRepository: { getCompanyProfile: () => ({ name: '杭州维高工具', phone: '', address: '', logoRelativePath: '', defaultIssuer: '', wechatQrRelativePath: null }) },
  });
  apps.push(app);
  return { database, repositories, customers, app };
}

function orderPayload(orderNo: string, amountCents = 100000) {
  return {
    orderNo,
    orderedAt: '2026-11-20T08:00:00.000Z',
    recipientName: '张三',
    recipientInfo: '深圳市宝安区',
    items: [{ name: '测试产品', sku: 'VT-0001', specification: '标准', packagingName: '彩盒', packCount: 10, quantity: 10, unitPriceCents: amountCents / 10 }],
  };
}

/** 登记一笔已审核收款：直接写收款记录并同步财务快照（与水单审核后的入账口径一致）。 */
function receive(database: ReturnType<typeof openDatabase>, orderId: number, amountCents: number, receivedAt = '2026-11-21'): void {
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO finance_receipts (order_id, received_at, amount_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(orderId, receivedAt, amountCents, now, now);
  const receivable = Number(database.prepare('SELECT receivable_cents FROM order_finance WHERE order_id = ?').get(orderId)?.receivable_cents ?? 0);
  const received = Number(database.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM finance_receipts WHERE order_id = ?').get(orderId)?.total ?? 0);
  const status = received >= receivable ? 'paid' : received > 0 ? 'partial' : 'unpaid';
  database.prepare('UPDATE order_finance SET received_cents = ?, outstanding_cents = ?, payment_status = ?, updated_at = ? WHERE order_id = ?')
    .run(received, Math.max(0, receivable - received), status, now, orderId);
}

describe('先款后货', () => {
  it('收齐定金前只能存草稿，收全款前不能备货', async () => {
    const { database, customers, app } = await makeContext();
    const customer = customers.create({ name: '先款客户', contactName: '', contactPhone: '', shippingInfo: '', invoiceTitle: '', taxNo: '', paymentPolicy: 'prepay', depositPercent: 30 });
    const created = await app.inject({ method: 'POST', url: '/api/orders', payload: { ...orderPayload('SO-PREPAY-1'), customerId: customer.id, paymentPolicy: 'prepay', depositPercent: 30 } });
    expect(created.statusCode).toBe(201);
    const orderId = Number(created.json().data.id);
    // 先款后货订单创建即草稿，不进入待备货
    expect(database.prepare('SELECT status, payment_policy, deposit_percent FROM orders WHERE id = ?').get(orderId)).toEqual({ status: 'draft', payment_policy: 'prepay', deposit_percent: 30 });

    const blockedPublish = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/publish` });
    expect(blockedPublish.statusCode).toBe(400);
    expect(blockedPublish.json().error.message).toContain('定金');

    receive(database, orderId, 30000);
    const published = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/publish` });
    expect(published.statusCode).toBe(200);

    const blockedStock = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/status`, payload: { to: 'stock_reported' } });
    expect(blockedStock.statusCode).toBe(400);
    expect(blockedStock.json().error.message).toContain('收齐全款');

    receive(database, orderId, 70000);
    const stocked = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/status`, payload: { to: 'stock_reported' } });
    expect(stocked.statusCode).toBe(200);
    database.close();
  });
});

describe('账期与额度', () => {
  it('账期订单未收款可发货；超出账期额度时拒绝发货；对账数字同源', async () => {
    const { database, customers, app } = await makeContext();
    const customer = customers.create({ name: '账期客户', contactName: '', contactPhone: '', shippingInfo: '', invoiceTitle: '', taxNo: '', paymentPolicy: 'credit', creditDays: 30, creditLimitCents: 200000 });
    const first = await app.inject({ method: 'POST', url: '/api/orders', payload: { ...orderPayload('SO-CREDIT-1', 150000), customerId: customer.id, paymentPolicy: 'credit', creditDays: 30 } });
    expect(first.statusCode).toBe(201);
    const firstId = Number(first.json().data.id);
    const second = await app.inject({ method: 'POST', url: '/api/orders', payload: { ...orderPayload('SO-CREDIT-2', 100000), customerId: customer.id, paymentPolicy: 'credit', creditDays: 30 } });
    const secondId = Number(second.json().data.id);

    const advanceToShipping = async (orderId: number) => {
      for (const to of ['stock_reported', 'pending_packing', 'ship_pending', 'shipping']) {
        expect((await app.inject({ method: 'POST', url: `/api/orders/${orderId}/status`, payload: { to } })).statusCode).toBe(200);
      }
    };
    await advanceToShipping(firstId);
    const firstDetail = (await app.inject({ method: 'GET', url: `/api/orders/${firstId}/detail` })).json().data;
    const secondDetail = (await app.inject({ method: 'GET', url: `/api/orders/${secondId}/detail` })).json().data;

    const shipped = await app.inject({
      method: 'POST',
      url: '/api/shipping/partial',
      payload: { orders: [{ orderId: firstId, trackingNo: 'SF-CREDIT-1', items: [{ orderItemId: firstDetail.items[0].id, quantity: 10 }] }] },
    });
    expect(shipped.statusCode, JSON.stringify(shipped.json())).toBe(201);
    expect(database.prepare('SELECT status FROM orders WHERE id = ?').get(firstId)).toEqual({ status: 'shipped' });

    await advanceToShipping(secondId);
    const overLimit = await app.inject({
      method: 'POST',
      url: '/api/shipping/partial',
      payload: { orders: [{ orderId: secondId, trackingNo: 'SF-CREDIT-2', items: [{ orderItemId: secondDetail.items[0].id, quantity: 10 }] }] },
    });
    expect(overLimit.statusCode).toBe(400);
    expect(overLimit.json().error.message).toContain('账期额度不足');

    const reconciled = await app.inject({ method: 'GET', url: '/api/finance/reconciliation' });
    expect(reconciled.statusCode).toBe(200);
    const item = reconciled.json().data.items.find((entry: { customerId: number }) => entry.customerId === customer.id);
    expect(item).toMatchObject({ outstandingCents: 150000, overdueCents: 0, orderCount: 1, creditLimitCents: 200000 });

    const statement = await app.inject({ method: 'GET', url: `/api/finance/reconciliation/${customer.id}?from=2026-11-01&to=2026-12-31` });
    expect(statement.statusCode).toBe(200);
    expect(statement.json().data).toMatchObject({ customerName: '账期客户', periodReceivableCents: 150000, periodReceiptCents: 0, closingCents: 150000 });
    expect(statement.json().data.orders).toHaveLength(1);

    // 收款后额度释放，第二单可以发货
    receive(database, firstId, 150000);
    const shippedAgain = await app.inject({
      method: 'POST',
      url: '/api/shipping/partial',
      payload: { orders: [{ orderId: secondId, trackingNo: 'SF-CREDIT-2', items: [{ orderItemId: secondDetail.items[0].id, quantity: 10 }] }] },
    });
    expect(shippedAgain.statusCode).toBe(201);

    const pdf = await app.inject({ method: 'GET', url: `/api/finance/reconciliation/${customer.id}/pdf?from=2026-11-01&to=2026-12-31` });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    database.close();
  });
});
