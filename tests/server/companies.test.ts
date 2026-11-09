import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { openDatabase } from '../../src/server/db/connection.js';
import { migrateDatabase } from '../../src/server/db/migrate.js';
import { FileStore } from '../../src/server/files/file-store.js';
import { authInject, setupAdmin } from './helpers/auth';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-companies-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  const fileStore = new FileStore(join(directory, 'files'));
  const app = await createApp({ database, filesDirectory: join(directory, 'files'), fileStore });
  await setupAdmin(app);
  return { database, app, fileStore };
}

async function createCompany(app: Awaited<ReturnType<typeof setup>>['app'], shortName: string) {
  const response = await authInject(app, {
    method: 'POST',
    url: '/api/finance/companies',
    payload: { shortName, fullName: `${shortName}全称`, taxNo: `TAX-${shortName}` },
  });
  expect(response.statusCode).toBe(200);
  return response.json().data;
}

async function createOrder(app: Awaited<ReturnType<typeof setup>>['app'], companyId?: number | null, settlementType = 'corporate') {
  return authInject(app, {
    method: 'POST',
    url: '/api/orders',
    payload: {
      orderNo: '',
      orderedAt: '2026-08-22T08:00:00.000Z',
      recipientName: '张三',
      recipientInfo: '深圳市宝安区',
      settlementType,
      ...(companyId == null ? {} : { companyId }),
      items: [{ name: '测试产品', sku: 'VT-0001', specification: '标准规格', packagingName: '彩盒包装', packCount: 10, quantity: 10, unitPriceCents: 1000 }],
    },
  });
}

async function uploadProof(app: Awaited<ReturnType<typeof setup>>['app'], orderId: number, amountCents: number, paymentDate: string) {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('proof')], { type: 'image/png' }), 'proof.png');
  form.append('paymentDate', paymentDate);
  form.append('amountCents', String(amountCents));
  form.append('paymentMethod', '银行转账');
  form.append('transactionNo', `TX-${orderId}-${Date.now()}`);
  const uploaded = await authInject(app, { method: 'POST', url: `/api/finance/orders/${orderId}/proofs`, payload: form as unknown as BodyInit, headers: Object.fromEntries(form.entries()) });
  expect(uploaded.statusCode).toBe(201);
  return uploaded.json().data;
}

describe('公司档案与水单收款', () => {
  it('公司档案可新增、改名、停用；被订单引用时不能删除', async () => {
    const { app, database } = await setup();
    const company = await createCompany(app, '宁波公司');
    expect(company).toMatchObject({ shortName: '宁波公司', isActive: true });

    const duplicate = await authInject(app, {
      method: 'POST',
      url: '/api/finance/companies',
      payload: { shortName: ' 宁波公司 ' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('COMPANY_NAME_EXISTS');

    const order = await createOrder(app, company.id);
    expect(order.statusCode).toBe(201);

    const removeUsed = await authInject(app, { method: 'DELETE', url: `/api/finance/companies/${company.id}` });
    expect(removeUsed.statusCode).toBe(409);
    expect(removeUsed.json().error.code).toBe('COMPANY_IN_USE');

    const disabled = await authInject(app, {
      method: 'PUT',
      url: `/api/finance/companies/${company.id}`,
      payload: { shortName: '宁波公司', fullName: '宁波公司全称', isActive: false },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().data.isActive).toBe(false);

    const activeList = await authInject(app, { method: 'GET', url: '/api/finance/companies' });
    expect(activeList.json().data.items).toEqual([]);
    const allList = await authInject(app, { method: 'GET', url: '/api/finance/companies?includeInactive=1' });
    expect(allList.json().data.items).toHaveLength(1);

    const unused = await createCompany(app, '杭州公司');
    const removeUnused = await authInject(app, { method: 'DELETE', url: `/api/finance/companies/${unused.id}` });
    expect(removeUnused.statusCode).toBe(200);
    await app.close();
    database.close();
  });

  it('服务端允许旧客户端不选公司，填了公司则必须存在；订单详情带公司名', async () => {
    const { app, database } = await setup();
    const company = await createCompany(app, '深圳公司');

    // 兼容旧手机端/历史接口：公司必选只在网页端做，服务端允许空公司。
    const legacy = await createOrder(app, null, 'corporate');
    expect(legacy.statusCode).toBe(201);
    expect(legacy.json().data.company_id ?? null).toBeNull();

    const personal = await createOrder(app, null, 'personal');
    expect(personal.statusCode).toBe(201);
    expect(personal.json().data.company_id ?? null).toBeNull();

    const invalid = await createOrder(app, 999999, 'corporate');
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.message).toContain('收款/开票公司不存在');

    const corporate = await createOrder(app, company.id, 'corporate');
    expect(corporate.statusCode).toBe(201);
    const orderId = Number(corporate.json().data.id);
    const detail = await authInject(app, { method: 'GET', url: `/api/orders/${orderId}/detail` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data).toMatchObject({ company_id: company.id, company_name: '深圳公司' });
    await app.close();
    database.close();
  });

  it('旧客户端编辑订单不传公司时保留原公司', async () => {
    const { app, database } = await setup();
    const company = await createCompany(app, '保留公司');
    const order = await createOrder(app, company.id);
    const orderId = Number(order.json().data.id);
    const orderNo = String(order.json().data.order_no);
    const updated = await authInject(app, {
      method: 'PUT',
      url: `/api/orders/${orderId}`,
      payload: {
        orderNo,
        orderedAt: '2026-08-22T08:00:00.000Z',
        recipientName: '张三',
        recipientInfo: '深圳市宝安区',
        items: [{ name: '测试产品', sku: 'VT-0001', specification: '标准规格', packagingName: '彩盒包装', packCount: 10, quantity: 10, unitPriceCents: 1000 }],
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(database.prepare('SELECT company_id FROM orders WHERE id = ?').get(orderId)?.company_id).toBe(company.id);
    await app.close();
    database.close();
  });

  it('按订单号定位、按公司筛选统计，并展示水单公司', async () => {
    const { app, database } = await setup();
    const company = await createCompany(app, '宁波公司');
    const order = await createOrder(app, company.id);
    const orderId = Number(order.json().data.id);
    const orderNo = String(order.json().data.order_no);
    const customerId = Number(database.prepare(
      `INSERT INTO customers (name, created_at, updated_at)
       VALUES ('宁波海川采购部', '2026-08-20', '2026-08-20')`,
    ).run().lastInsertRowid);
    database.prepare('UPDATE orders SET customer_id = ?, customer_name = ? WHERE id = ?').run(customerId, '宁波海川采购部', orderId);

    const lookup = await authInject(app, { method: 'GET', url: `/api/finance/orders/lookup?orderNo=${encodeURIComponent(orderNo)}` });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().data.items[0]).toMatchObject({ orderId, orderNo, customerName: '宁波海川采购部', recipientName: '张三', amountCents: 10000, companyId: company.id, companyName: '宁波公司' });

    const byCustomer = await authInject(app, { method: 'GET', url: `/api/finance/orders/lookup?orderNo=${encodeURIComponent('海川采购')}` });
    expect(byCustomer.json().data.items).toEqual(expect.arrayContaining([expect.objectContaining({ orderId, orderNo })]));
    const byRecipient = await authInject(app, { method: 'GET', url: `/api/finance/orders/lookup?orderNo=${encodeURIComponent('张三')}` });
    expect(byRecipient.json().data.items).toEqual(expect.arrayContaining([expect.objectContaining({ orderId, orderNo })]));
    const byAmount = await authInject(app, { method: 'GET', url: `/api/finance/orders/lookup?orderNo=${encodeURIComponent('100.00')}` });
    expect(byAmount.json().data.items).toEqual(expect.arrayContaining([expect.objectContaining({ orderId, orderNo, amountCents: 10000 })]));
    const byCurrencyAmount = await authInject(app, { method: 'GET', url: `/api/finance/orders/lookup?orderNo=${encodeURIComponent('¥100.00')}` });
    expect(byCurrencyAmount.json().data.items).toEqual(expect.arrayContaining([expect.objectContaining({ orderId, orderNo, amountCents: 10000 })]));

    const proof = await uploadProof(app, orderId, 4000, '2026-08-23');
    const pendingStats = await authInject(app, { method: 'GET', url: '/api/finance/companies/stats?month=2026-08' });
    const pendingRow = pendingStats.json().data.items.find((row: { companyId: number | null }) => row.companyId === company.id);
    expect(pendingRow).toMatchObject({ pendingCents: 4000, pendingCount: 1, receivedCents: 0 });

    const proofList = await authInject(app, { method: 'GET', url: '/api/finance/proofs?month=2026-08' });
    expect(proofList.json().data.items[0]).toMatchObject({ id: proof.id, orderNo, companyName: '宁波公司', amountCents: 4000 });

    const approved = await authInject(app, { method: 'POST', url: `/api/finance/proofs/${proof.id}/approve`, payload: {} });
    expect(approved.statusCode).toBe(200);
    const receivedStats = await authInject(app, { method: 'GET', url: '/api/finance/companies/stats?month=2026-08' });
    const receivedRow = receivedStats.json().data.items.find((row: { companyId: number | null }) => row.companyId === company.id);
    expect(receivedRow).toMatchObject({ receivedCents: 4000, receivedCount: 1, pendingCents: 0 });

    const filtered = await authInject(app, { method: 'GET', url: `/api/finance/orders?companyId=${company.id}` });
    expect(filtered.json().data.rows).toEqual([expect.objectContaining({ orderId, companyId: company.id, companyName: '宁波公司' })]);

    const breakdown = await authInject(app, { method: 'GET', url: '/api/finance/receipts/by-company?month=2026-08' });
    expect(breakdown.json().data.items).toEqual([{ companyId: company.id, companyName: '宁波公司', receiptCount: 1, amountCents: 4000 }]);
    await app.close();
    database.close();
  });

  it('未分配公司的历史订单会归入“未分配公司”统计', async () => {
    const { app, database } = await setup();
    const order = await createOrder(app, null, 'personal');
    const orderId = Number(order.json().data.id);
    await uploadProof(app, orderId, 2500, '2026-08-24');
    const stats = await authInject(app, { method: 'GET', url: '/api/finance/companies/stats?month=2026-08' });
    expect(stats.json().data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ companyId: null, companyName: '未分配公司', pendingCents: 2500, pendingCount: 1 }),
    ]));
    const filtered = await authInject(app, { method: 'GET', url: '/api/finance/orders?companyId=unassigned' });
    expect(filtered.json().data.rows).toEqual([expect.objectContaining({ orderId, companyId: null, companyName: '' })]);
    await app.close();
    database.close();
  });

  it('开票必须有关联公司；已有入账水单或有效发票后禁止改公司', async () => {
    const { app, database } = await setup();
    const first = await createCompany(app, '宁波公司');
    const second = await createCompany(app, '杭州公司');
    const order = await createOrder(app, first.id);
    const orderId = Number(order.json().data.id);
    const orderNo = String(order.json().data.order_no);

    // 没有收款/发票时允许改公司。
    const changeBefore = await authInject(app, {
      method: 'PUT',
      url: `/api/orders/${orderId}`,
      payload: {
        orderNo, orderedAt: '2026-08-22T08:00:00.000Z', recipientName: '张三', recipientInfo: '深圳市宝安区', settlementType: 'corporate', companyId: second.id,
        items: [{ name: '测试产品', sku: 'VT-0001', specification: '标准规格', packagingName: '彩盒包装', packCount: 10, quantity: 10, unitPriceCents: 1000 }],
      },
    });
    expect(changeBefore.statusCode).toBe(200);

    const invoice = await authInject(app, {
      method: 'POST',
      url: `/api/finance/orders/${orderId}/invoices`,
      payload: { invoiceType: '电子普通发票', title: '测试公司', taxNo: '9133', amountCents: 5000 },
    });
    expect(invoice.statusCode).toBe(201);

    const changeAfter = await authInject(app, {
      method: 'PUT',
      url: `/api/orders/${orderId}`,
      payload: {
        orderNo, orderedAt: '2026-08-22T08:00:00.000Z', recipientName: '张三', recipientInfo: '深圳市宝安区', settlementType: 'corporate', companyId: first.id,
        items: [{ name: '测试产品', sku: 'VT-0001', specification: '标准规格', packagingName: '彩盒包装', packCount: 10, quantity: 10, unitPriceCents: 1000 }],
      },
    });
    expect(changeAfter.statusCode).toBe(400);
    expect(changeAfter.json().error.message).toContain('不能修改收款/开票公司');

    // 历史对公订单未分配公司时，不允许创建开票申请。
    const legacyOrderId = Number(database.prepare(
      `INSERT INTO orders (order_no, ordered_at, recipient_name, amount, amount_cents, settlement_type, company_id, status, created_at, updated_at)
       VALUES ('LEGACY-CO-001', '2026-08-22', '张三', 100, 10000, 'corporate', NULL, 'pending_stock', '2026-08-22', '2026-08-22')`,
    ).run().lastInsertRowid);
    database.prepare("INSERT INTO order_finance (order_id, receivable_cents, outstanding_cents, payment_status, proof_status, invoice_status, created_at, updated_at) VALUES (?, 10000, 10000, 'unpaid', 'none', 'not_requested', '2026-08-22', '2026-08-22')").run(legacyOrderId);
    const legacyInvoice = await authInject(app, {
      method: 'POST',
      url: `/api/finance/orders/${legacyOrderId}/invoices`,
      payload: { invoiceType: '电子普通发票', title: '旧客户', taxNo: '9133', amountCents: 5000 },
    });
    expect(legacyInvoice.statusCode).toBe(400);
    expect(legacyInvoice.json().error.code).toBe('COMPANY_REQUIRED');
    await app.close();
    database.close();
  });

  it('公司档案可维护可开票类目，新增/修改后随列表返回', async () => {
    const { app, database } = await setup();
    const created = await authInject(app, {
      method: 'POST',
      url: '/api/finance/companies',
      payload: {
        shortName: '类目公司',
        fullName: '类目公司全称',
        taxNo: 'TAX-CATEGORY',
        invoiceCategories: ['电动工具', ' 电池 ', '电动工具', ''],
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().data.invoiceCategories).toEqual(['电动工具', '电池']);
    const companyId = Number(created.json().data.id);
    const stored = database.prepare('SELECT invoice_categories FROM companies WHERE id = ?').get(companyId);
    expect(JSON.parse(String(stored?.invoice_categories))).toEqual(['电动工具', '电池']);

    const updated = await authInject(app, {
      method: 'PUT',
      url: `/api/finance/companies/${companyId}`,
      payload: { shortName: '类目公司', invoiceCategories: '配件、充电器' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.invoiceCategories).toEqual(['配件', '充电器']);

    const list = await authInject(app, { method: 'GET', url: '/api/finance/companies?includeInactive=1' });
    expect(list.json().data.items.find((item: { id: number }) => item.id === companyId))
      .toMatchObject({ shortName: '类目公司', invoiceCategories: ['配件', '充电器'] });
    await app.close();
    database.close();
  });
});
