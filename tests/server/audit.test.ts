import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { openDatabase } from '../../src/server/db/connection.js';
import { migrateDatabase } from '../../src/server/db/migrate.js';
import { authInject, loginAs, setupAdmin } from './helpers/auth';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-audit-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  const app = await createApp({ database });
  await setupAdmin(app);
  return { database, app };
}

type TestApp = Awaited<ReturnType<typeof setup>>['app'];

function insertOrderWithReceipt(database: DatabaseSync, amountCents: number): number {
  const now = new Date().toISOString();
  const orderId = Number(database.prepare(
    `INSERT INTO orders (order_no, ordered_at, customer_name, amount, amount_cents, status, channel, created_at, updated_at)
     VALUES (?, '2026-11-20', '审计客户', ?, ?, 'pending_stock', 'offline', ?, ?)`,
  ).run(`AUDIT-${Date.now()}-${Math.random()}`, amountCents / 100, amountCents, now, now).lastInsertRowid);
  database.prepare(
    `INSERT INTO order_finance (order_id, receivable_cents, received_cents, outstanding_cents, payment_status, proof_status, invoice_status, created_at, updated_at)
     VALUES (?, ?, ?, 0, 'paid', 'none', 'not_requested', ?, ?)`,
  ).run(orderId, amountCents, amountCents, now, now);
  database.prepare(
    `INSERT INTO finance_receipts (order_id, received_at, amount_cents, payment_method, payee_name, note, created_at, updated_at)
     VALUES (?, '2026-11-20', ?, '银行转账', '', '审计测试', ?, ?)`,
  ).run(orderId, amountCents, now, now);
  return orderId;
}

async function listAudit(app: TestApp, query = '') {
  const response = await authInject(app, { method: 'GET', url: `/api/audit-logs${query}` });
  expect(response.statusCode).toBe(200);
  return response.json().data as {
    items: Array<{
      action: string;
      summary: string;
      entityType: string;
      entityId: string;
      entityLabel: string;
      username: string;
      method: string;
      statusCode: number;
      detail: Record<string, any> | null;
    }>;
    total: number;
    page: number;
    pageSize: number;
  };
}

describe('操作审计日志', () => {
  it('记录成功写操作的用户、对象与请求摘要，并支持筛选与分页', async () => {
    const { database, app } = await setup();

    const first = await authInject(app, { method: 'POST', url: '/api/customers', payload: { name: '审计客户甲' } });
    expect(first.statusCode).toBe(201);
    const firstId = Number(first.json().data.id);
    const second = await authInject(app, { method: 'POST', url: '/api/customers', payload: { name: '审计客户乙' } });
    expect(second.statusCode).toBe(201);

    // 只读请求不写日志。
    await authInject(app, { method: 'GET', url: '/api/customers' });

    const all = await listAudit(app);
    expect(all.total).toBe(2);
    expect(all.items[0]).toMatchObject({
      action: 'customer.create',
      summary: '新建客户',
      entityType: 'customer',
      username: 'admin',
      method: 'POST',
      statusCode: 201,
    });

    const searched = await listAudit(app, `?q=${encodeURIComponent('审计客户甲')}`);
    expect(searched.total).toBe(1);
    expect(searched.items[0]).toMatchObject({ entityId: String(firstId), entityLabel: '审计客户甲' });
    expect(searched.items[0].detail).toMatchObject({ body: { name: '审计客户甲' } });

    const byCategory = await listAudit(app, '?category=customer&pageSize=1&page=2');
    expect(byCategory).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(byCategory.items).toHaveLength(1);

    const byAction = await listAudit(app, '?action=customer.create');
    expect(byAction.total).toBe(2);

    const noMatch = await listAudit(app, '?q=不存在的关键词');
    expect(noMatch).toMatchObject({ total: 0, items: [] });

    await app.close();
    database.close();
  });

  it('失败的请求不写日志，密码字段自动脱敏', async () => {
    const { database, app } = await setup();

    const failed = await authInject(app, { method: 'POST', url: '/api/customers', payload: {} });
    expect(failed.statusCode).toBe(400);
    expect((await listAudit(app)).total).toBe(0);

    const created = await authInject(app, {
      method: 'POST',
      url: '/api/auth/users',
      payload: { username: 'audit-member', password: 'member-pass-123', displayName: '审计成员', role: 'member' },
    });
    expect(created.statusCode).toBe(201);

    const logs = await listAudit(app, '?action=user.create');
    expect(logs.total).toBe(1);
    expect(logs.items[0]).toMatchObject({ action: 'user.create', summary: '新建账号', entityType: 'user', entityLabel: '审计成员' });
    expect(logs.items[0].detail).toMatchObject({ body: { username: 'audit-member', password: '***' } });
    expect(JSON.stringify(logs.items[0].detail)).not.toContain('member-pass-123');

    await app.close();
    database.close();
  });

  it('退款等财务操作记录到订单对象', async () => {
    const { database, app } = await setup();
    const orderId = insertOrderWithReceipt(database, 12000);

    const refund = await authInject(app, {
      method: 'POST',
      url: `/api/finance/orders/${orderId}/refunds`,
      payload: { refundedAt: '2026-11-21', amountCents: 2000, reason: '退还超收' },
    });
    expect(refund.statusCode).toBe(201);

    const logs = await listAudit(app, '?action=finance.refund_create');
    expect(logs.total).toBe(1);
    expect(logs.items[0]).toMatchObject({
      summary: '登记退款',
      entityType: 'order',
      entityId: String(orderId),
      username: 'admin',
      method: 'POST',
      statusCode: 201,
    });
    expect(logs.items[0].detail).toMatchObject({ body: { amountCents: 2000, reason: '退还超收' } });

    await app.close();
    database.close();
  });

  it('仅管理员可查询日志，分页与时间参数做校验', async () => {
    const { database, app } = await setup();
    const created = await authInject(app, {
      method: 'POST',
      url: '/api/auth/users',
      payload: { username: 'audit-viewer', password: 'viewer-pass-123', role: 'member' },
    });
    expect(created.statusCode).toBe(201);

    await loginAs(app, 'audit-viewer', 'viewer-pass-123');
    const forbidden = await authInject(app, { method: 'GET', url: '/api/audit-logs' });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe('AUTH_FORBIDDEN');

    await loginAs(app, 'admin', 'test-password-123');
    const badPage = await authInject(app, { method: 'GET', url: '/api/audit-logs?page=0' });
    expect(badPage.statusCode).toBe(400);
    const badCategory = await authInject(app, { method: 'GET', url: '/api/audit-logs?category=nope' });
    expect(badCategory.statusCode).toBe(400);
    const badRange = await authInject(app, { method: 'GET', url: '/api/audit-logs?from=2026-11-02&to=2026-11-01' });
    expect(badRange.statusCode).toBe(400);
    const badAction = await authInject(app, { method: 'GET', url: '/api/audit-logs?action=Bad%20Action' });
    expect(badAction.statusCode).toBe(400);

    await app.close();
    database.close();
  });
});
