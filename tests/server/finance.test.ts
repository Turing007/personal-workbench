import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { openDatabase } from '../../src/server/db/connection.js';
import { migrateDatabase } from '../../src/server/db/migrate.js';
import { FileStore } from '../../src/server/files/file-store.js';
import { authInject, setupAdmin } from './helpers/auth';
import { FinanceRepository } from '../../src/server/db/finance-repository.js';
import { FinanceService } from '../../src/server/services/finance-service.js';
import type { DatabaseSync } from 'node:sqlite';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-finance-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  const fileStore = new FileStore(join(directory, 'files'));
  const app = await createApp({ database, filesDirectory: join(directory, 'files'), fileStore });
  await setupAdmin(app);
  const companyId = Number(database.prepare(
    `INSERT INTO companies (short_name, full_name, created_at, updated_at)
     VALUES ('测试公司', '测试公司全称', '2026-08-20', '2026-08-20')`,
  ).run().lastInsertRowid);
  return { database, app, fileStore, companyId };
}

function insertOrder(database: DatabaseSync, amountCents = 10000, companyId: number | null = null, channel = 'offline', orderedAt = '2026-08-20'): number {
  const result = database.prepare(`
    INSERT INTO orders (order_no, ordered_at, recipient_name, amount, amount_cents, shipping_cents, company_id, status, channel, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, 'pending_stock', ?, ?, ?)
  `).run(`FIN-${Date.now()}-${Math.random()}`, orderedAt, '客户', amountCents / 100, amountCents, companyId, channel, new Date().toISOString(), new Date().toISOString());
  const orderId = Number(result.lastInsertRowid);
  database.prepare(`INSERT INTO order_finance (order_id, receivable_cents, outstanding_cents, payment_status, proof_status, invoice_status, created_at, updated_at) VALUES (?, ?, ?, 'unpaid', 'none', 'not_requested', ?, ?)`).run(orderId, amountCents, amountCents, new Date().toISOString(), new Date().toISOString());
  return orderId;
}

type TestApp = Awaited<ReturnType<typeof setup>>['app'];

/** 上传并审核一张水单，返回水单 id；用于让订单产生真实收款记录。 */
async function uploadAndApprove(app: TestApp, orderId: number, amountCents: number, transactionNo: string, paymentDate = '2026-08-20'): Promise<number> {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('proof')], { type: 'image/png' }), 'proof.png');
  form.append('paymentDate', paymentDate);
  form.append('amountCents', String(amountCents));
  form.append('paymentMethod', '银行转账');
  form.append('transactionNo', transactionNo);
  const uploaded = await authInject(app, { method: 'POST', url: `/api/finance/orders/${orderId}/proofs`, payload: form as unknown as BodyInit, headers: Object.fromEntries(form.entries()) });
  expect(uploaded.statusCode).toBe(201);
  const proofId = Number(uploaded.json().data.id);
  const approved = await authInject(app, { method: 'POST', url: `/api/finance/proofs/${proofId}/approve`, payload: {} });
  expect(approved.statusCode).toBe(200);
  return proofId;
}

describe('财务模块', () => {
  it('审核水单后生成收款并更新订单财务状态', async () => {
    const { database, app } = await setup();
    const orderId = insertOrder(database, 10000);
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('proof')], { type: 'image/png' }), 'proof.png');
    form.append('paymentDate', '2026-08-20');
    form.append('amountCents', '10000');
    form.append('paymentMethod', '银行转账');
    form.append('transactionNo', 'TX-001');
    const uploaded = await authInject(app, { method: 'POST', url: `/api/finance/orders/${orderId}/proofs`, payload: form as unknown as BodyInit, headers: Object.fromEntries(form.entries()) });
    expect(uploaded.statusCode).toBe(201);
    const proofId = uploaded.json().data.id;
    const approved = await authInject(app, { method: 'POST', url: `/api/finance/proofs/${proofId}/approve`, payload: {} });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().data.finance).toMatchObject({ receivedCents: 10000, outstandingCents: 0, paymentStatus: 'paid' });
    expect(database.prepare('SELECT COUNT(*) AS count FROM finance_receipts WHERE payment_proof_id = ?').get(proofId)?.count).toBe(1);
    await app.close();
    database.close();
  });

  it('超收订单可登记退款并按净额重算，退款可修改和删除', async () => {
    const { database, app } = await setup();
    const orderId = insertOrder(database, 10000);
    await uploadAndApprove(app, orderId, 12000, 'TX-REFUND-1');

    const overpaidDetail = await authInject(app, { method: 'GET', url: `/api/finance/orders/${orderId}` });
    expect(overpaidDetail.statusCode).toBe(200);
    expect(overpaidDetail.json().data.finance).toMatchObject({
      receivedCents: 12000,
      outstandingCents: -2000,
      refundedCents: 0,
      overpaidCents: 2000,
      paymentStatus: 'overpaid',
    });
    expect(overpaidDetail.json().data.refunds).toEqual([]);

    const created = await authInject(app, {
      method: 'POST',
      url: `/api/finance/orders/${orderId}/refunds`,
      payload: { refundedAt: '2026-08-21', amountCents: 2000, paymentMethod: '银行转账', reason: '退还超收', note: '客户多付' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ orderId, refundedAt: '2026-08-21', amountCents: 2000, paymentMethod: '银行转账', reason: '退还超收', note: '客户多付' });
    const refundId = Number(created.json().data.id);
    expect(created.json().data.createdBy).toBeTruthy();

    const settled = await authInject(app, { method: 'GET', url: `/api/finance/orders/${orderId}` });
    expect(settled.json().data.finance).toMatchObject({
      receivedCents: 10000,
      outstandingCents: 0,
      refundedCents: 2000,
      overpaidCents: 0,
      paymentStatus: 'paid',
    });
    expect(settled.json().data.refunds).toHaveLength(1);

    const list = await authInject(app, { method: 'GET', url: '/api/finance/orders' });
    const row = (list.json().data.rows as Array<Record<string, unknown>>).find((item) => item.orderId === orderId);
    expect(row).toMatchObject({ receivedCents: 10000, outstandingCents: 0, refundedCents: 2000, overpaidCents: 0, paymentStatus: 'paid' });
    expect(list.json().data.stats).toMatchObject({ receivedCents: 10000, refundedCents: 2000, overpaidCents: 0 });

    const updated = await authInject(app, {
      method: 'PUT',
      url: `/api/finance/refunds/${refundId}`,
      payload: { refundedAt: '2026-08-21', amountCents: 1500, paymentMethod: '微信', reason: '部分退还' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({ amountCents: 1500, paymentMethod: '微信', reason: '部分退还' });
    const afterUpdate = await authInject(app, { method: 'GET', url: `/api/finance/orders/${orderId}` });
    expect(afterUpdate.json().data.finance).toMatchObject({ receivedCents: 10500, outstandingCents: -500, refundedCents: 1500, overpaidCents: 500, paymentStatus: 'overpaid' });

    const deleted = await authInject(app, { method: 'DELETE', url: `/api/finance/refunds/${refundId}` });
    expect(deleted.statusCode).toBe(200);
    const afterDelete = await authInject(app, { method: 'GET', url: `/api/finance/orders/${orderId}` });
    expect(afterDelete.json().data.finance).toMatchObject({ receivedCents: 12000, outstandingCents: -2000, refundedCents: 0, overpaidCents: 2000, paymentStatus: 'overpaid' });
    expect(afterDelete.json().data.refunds).toEqual([]);
    await app.close();
    database.close();
  });

  it('退款金额不能超过已收，已退款的水单不能直接作废', async () => {
    const { database, app } = await setup();
    const orderId = insertOrder(database, 10000);
    const proofId = await uploadAndApprove(app, orderId, 12000, 'TX-REFUND-2');

    const tooMuch = await authInject(app, {
      method: 'POST',
      url: `/api/finance/orders/${orderId}/refunds`,
      payload: { refundedAt: '2026-08-21', amountCents: 12001 },
    });
    expect(tooMuch.statusCode).toBe(409);
    expect(tooMuch.json().error.code).toBe('REFUND_EXCEEDS_RECEIVED');

    const refund = await authInject(app, {
      method: 'POST',
      url: `/api/finance/orders/${orderId}/refunds`,
      payload: { refundedAt: '2026-08-21', amountCents: 2000 },
    });
    expect(refund.statusCode).toBe(201);

    const blockedVoid = await authInject(app, { method: 'POST', url: `/api/finance/proofs/${proofId}/void`, payload: { note: '测试作废' } });
    expect(blockedVoid.statusCode).toBe(409);
    expect(blockedVoid.json().error.code).toBe('REFUND_PREVENTS_VOID');

    const removed = await authInject(app, { method: 'DELETE', url: `/api/finance/refunds/${refund.json().data.id}` });
    expect(removed.statusCode).toBe(200);
    const voided = await authInject(app, { method: 'POST', url: `/api/finance/proofs/${proofId}/void`, payload: { note: '测试作废' } });
    expect(voided.statusCode).toBe(200);
    expect(voided.json().data.finance).toMatchObject({ receivedCents: 0, outstandingCents: 10000, refundedCents: 0, paymentStatus: 'unpaid' });
    await app.close();
    database.close();
  });

  it('退款参数校验与不存在的订单/退款记录', async () => {
    const { database, app } = await setup();
    const orderId = insertOrder(database, 10000);
    await uploadAndApprove(app, orderId, 10000, 'TX-REFUND-3');

    const zero = await authInject(app, { method: 'POST', url: `/api/finance/orders/${orderId}/refunds`, payload: { refundedAt: '2026-08-21', amountCents: 0 } });
    expect(zero.statusCode).toBe(400);
    expect(zero.json().error.code).toBe('VALIDATION_ERROR');

    const missingDate = await authInject(app, { method: 'POST', url: `/api/finance/orders/${orderId}/refunds`, payload: { amountCents: 100 } });
    expect(missingDate.statusCode).toBe(400);
    expect(missingDate.json().error.code).toBe('VALIDATION_ERROR');

    const missingOrder = await authInject(app, { method: 'POST', url: '/api/finance/orders/9999/refunds', payload: { refundedAt: '2026-08-21', amountCents: 100 } });
    expect(missingOrder.statusCode).toBe(404);
    expect(missingOrder.json().error.code).toBe('FINANCE_ORDER_NOT_FOUND');

    const missingRefund = await authInject(app, { method: 'DELETE', url: '/api/finance/refunds/9999' });
    expect(missingRefund.statusCode).toBe(404);
    expect(missingRefund.json().error.code).toBe('REFUND_NOT_FOUND');
    await app.close();
    database.close();
  });

  it('退款按公司净额汇总，并计入账期对账单的负数收款', async () => {
    const { database, app, companyId } = await setup();
    const customerId = Number(database.prepare(
      `INSERT INTO customers (name, payment_policy, created_at, updated_at) VALUES ('账期客户', 'credit', '2026-08-20', '2026-08-20')`,
    ).run().lastInsertRowid);
    const orderId = insertOrder(database, 10000, companyId);
    database.prepare("UPDATE orders SET customer_id = ?, payment_policy = 'credit', status = 'shipping' WHERE id = ?").run(customerId, orderId);
    database.prepare("INSERT INTO shipments (order_id, tracking_no, shipped_at, total_boxes, recipient_info, remark) VALUES (?, 'SF-REFUND-1', '2026-08-20', 1, '', '')").run(orderId);
    await uploadAndApprove(app, orderId, 10000, 'TX-REFUND-4');

    const refund = await authInject(app, { method: 'POST', url: `/api/finance/orders/${orderId}/refunds`, payload: { refundedAt: '2026-08-21', amountCents: 2000, reason: '售后退款' } });
    expect(refund.statusCode).toBe(201);

    const byCompany = await authInject(app, { method: 'GET', url: '/api/finance/receipts/by-company' });
    expect(byCompany.statusCode).toBe(200);
    expect((byCompany.json().data.items as Array<Record<string, unknown>>).find((item) => item.companyId === companyId)).toMatchObject({ amountCents: 8000, receiptCount: 1 });

    const companyStats = await authInject(app, { method: 'GET', url: '/api/finance/companies/stats?month=2026-08' });
    expect(companyStats.statusCode).toBe(200);
    expect((companyStats.json().data.items as Array<Record<string, unknown>>).find((item) => item.companyId === companyId)).toMatchObject({ receivedCents: 8000, receivedCount: 1 });

    const statement = await authInject(app, { method: 'GET', url: `/api/finance/reconciliation/${customerId}?from=2026-08-01&to=2026-08-31` });
    expect(statement.statusCode).toBe(200);
    expect(statement.json().data.periodReceiptCents).toBe(8000);
    expect(statement.json().data.closingCents).toBe(2000);
    expect(statement.json().data.receipts).toEqual([
      expect.objectContaining({ orderId, amountCents: 10000, kind: 'receipt' }),
      expect.objectContaining({ orderId, amountCents: -2000, kind: 'refund', note: expect.stringContaining('售后退款') }),
    ]);
    await app.close();
    database.close();
  });

  it('存在待审水单时锁定客户与结算方式', async () => {
    const { database, app, companyId } = await setup();
    const orderId = insertOrder(database, 10000, companyId);
    const orderNo = String((database.prepare('SELECT order_no FROM orders WHERE id = ?').get(orderId) as { order_no: string }).order_no);
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('proof')], { type: 'image/png' }), 'proof.png');
    form.append('paymentDate', '2026-08-20');
    form.append('amountCents', '1000');
    form.append('paymentMethod', '银行转账');
    form.append('transactionNo', 'TX-LOCK-1');
    const uploaded = await authInject(app, {
      method: 'POST',
      url: `/api/finance/orders/${orderId}/proofs`,
      payload: form as unknown as BodyInit,
      headers: Object.fromEntries(form.entries()),
    });
    expect(uploaded.statusCode).toBe(201);

    const update = await authInject(app, {
      method: 'PUT',
      url: `/api/orders/${orderId}`,
      payload: {
        orderNo,
        orderedAt: '2026-08-20T08:00:00.000Z',
        recipientName: '客户',
        recipientInfo: '',
        settlementType: 'personal',
        companyId,
        items: [{ name: '测试产品', sku: '', specification: '标准规格', packCount: 10, quantity: 10, unitPriceCents: 1000 }],
      },
    });
    expect(update.statusCode).toBe(400);
    expect(update.json().error.message).toContain('待审水单');
    await app.close();
    database.close();
  });

  it('已开票的发票不能退回待开票', async () => {
    const { database, fileStore, companyId } = await setup();
    const orderId = insertOrder(database, 10000, companyId);
    const service = new FinanceService({ database, fileStore, repository: new FinanceRepository(database) });
    const invoice = service.createInvoice(orderId, {
      invoiceType: '电子普通发票',
      title: '测试公司',
      taxNo: '9133',
      amountCents: 10000,
      taxRateBps: 1300,
      taxCents: 1300,
    });
    expect(service.submitInvoice(invoice.id).status).toBe('pending_issue');
    expect(service.issueInvoice(invoice.id, { invoiceNo: 'INV-001' }).status).toBe('issued');
    expect(() => service.submitInvoice(invoice.id)).toThrow('只有未完成或待开票记录才能提交开票申请');
    database.close();
  });

  it('状态聚合、发票金额校验和发票文件上传可用', async () => {
    const { database, fileStore, companyId } = await setup();
    const orderId = insertOrder(database, 10000, companyId);
    const service = new FinanceService({ database, fileStore, repository: new FinanceRepository(database) });
    const invoice = service.createInvoice(orderId, { invoiceType: '电子普通发票', title: '测试公司', taxNo: '9133', amountCents: 10000, taxRateBps: 1300, taxCents: 1300 });
    expect(invoice.status).toBe('incomplete');
    expect(() => service.createInvoice(orderId, { invoiceType: '电子普通发票', title: '测试公司', taxNo: '9133', amountCents: 1 })).toThrow('有效发票金额不能超过订单应收金额');
    const file = await service.uploadInvoiceFile(invoice.id, Readable.from([Buffer.from('%PDF')]), 'invoice.pdf', 'application/pdf');
    expect(file.relativePath).toMatch(/^finance-invoices\//);
    await fileStore.deleteFile(file.relativePath);
    database.close();
  });

  it('修改订单金额后财务应收、未收与付款状态同步更新', async () => {
    const { database, app, companyId } = await setup();
    const created = await authInject(app, {
      method: 'POST',
      url: '/api/orders',
      payload: {
        orderNo: '',
        orderedAt: '2026-08-22T08:00:00.000Z',
        recipientName: '张三',
        recipientInfo: '深圳市宝安区',
        amount: 100,
        trackingNo: '',
        paymentNote: '',
        remark: '',
        companyId,
        items: [{ name: '测试产品', sku: 'VT-0001', specification: '标准规格', packagingName: '彩盒包装', packCount: 10, quantity: 10, unitPriceCents: 1000 }],
      },
    });
    expect(created.statusCode).toBe(201);
    const orderId = Number(created.json().data.id);
    const orderNo = String(created.json().data.order_no);

    const initialList = await authInject(app, { method: 'GET', url: '/api/finance/orders' });
    expect(initialList.json().data.rows).toEqual([
      expect.objectContaining({ orderId, receivableCents: 10000, receivedCents: 0, outstandingCents: 10000, paymentStatus: 'unpaid' }),
    ]);

    const form = new FormData();
    form.append('file', new Blob([Buffer.from('proof')], { type: 'image/png' }), 'proof.png');
    form.append('paymentDate', '2026-08-22');
    form.append('amountCents', '4000');
    form.append('paymentMethod', '银行转账');
    form.append('transactionNo', `TX-${orderId}`);
    const uploaded = await authInject(app, { method: 'POST', url: `/api/finance/orders/${orderId}/proofs`, payload: form as unknown as BodyInit, headers: Object.fromEntries(form.entries()) });
    expect(uploaded.statusCode).toBe(201);
    const approved = await authInject(app, { method: 'POST', url: `/api/finance/proofs/${uploaded.json().data.id}/approve`, payload: {} });
    expect(approved.statusCode).toBe(200);

    const updated = await authInject(app, {
      method: 'PUT',
      url: `/api/orders/${orderId}`,
      payload: {
        orderNo,
        orderedAt: '2026-08-22T08:00:00.000Z',
        recipientName: '张三',
        recipientInfo: '深圳市宝安区',
        amount: 200,
        trackingNo: '',
        paymentNote: '',
        remark: '',
        companyId,
        items: [{ name: '测试产品', sku: 'VT-0001', specification: '标准规格', packagingName: '彩盒包装', packCount: 10, quantity: 20, unitPriceCents: 1000 }],
      },
    });
    expect(updated.statusCode).toBe(200);

    const list = await authInject(app, { method: 'GET', url: '/api/finance/orders' });
    expect(list.json().data.rows).toEqual([
      expect.objectContaining({ orderId, receivableCents: 20000, receivedCents: 4000, outstandingCents: 16000, paymentStatus: 'partial' }),
    ]);
    const stats = list.json().data.stats;
    expect(stats).toMatchObject({ receivableCents: 20000, receivedCents: 4000, outstandingCents: 16000 });

    const detail = await authInject(app, { method: 'GET', url: `/api/orders/${orderId}/detail` });
    expect(detail.json().data.financeSummary).toMatchObject({ receivableCents: 20000, outstandingCents: 16000, paymentStatus: 'partial' });
    await app.close();
    database.close();
  });

  it('审核水单可填写收款人并按收款人汇总已收金额', async () => {
    const { database, app } = await setup();
    const uploadAndApprove = async (amountCents: number, payeeName?: string) => {
      const orderId = insertOrder(database, amountCents);
      const form = new FormData();
      form.append('file', new Blob([Buffer.from('proof')], { type: 'image/png' }), 'proof.png');
      form.append('paymentDate', '2026-08-25');
      form.append('amountCents', String(amountCents));
      form.append('paymentMethod', '银行转账');
      form.append('transactionNo', `TX-${orderId}`);
      const uploaded = await authInject(app, { method: 'POST', url: `/api/finance/orders/${orderId}/proofs`, payload: form as unknown as BodyInit, headers: Object.fromEntries(form.entries()) });
      expect(uploaded.statusCode).toBe(201);
      const proofId = uploaded.json().data.id;
      const approved = await authInject(app, { method: 'POST', url: `/api/finance/proofs/${proofId}/approve`, payload: payeeName === undefined ? {} : { payeeName } });
      expect(approved.statusCode).toBe(200);
      return proofId;
    };

    const firstProof = await uploadAndApprove(10000, '对公户');
    const secondProof = await uploadAndApprove(4000);

    expect(database.prepare('SELECT payee_name FROM finance_receipts WHERE payment_proof_id = ?').get(firstProof)?.payee_name).toBe('对公户');
    expect(database.prepare('SELECT payee_name FROM finance_receipts WHERE payment_proof_id = ?').get(secondProof)?.payee_name).toBe('');

    const breakdown = await authInject(app, { method: 'GET', url: '/api/finance/receipts/by-payee' });
    expect(breakdown.statusCode).toBe(200);
    expect(breakdown.json().data.items).toEqual([
      { payeeName: '对公户', receiptCount: 1, amountCents: 10000 },
      { payeeName: '未指定', receiptCount: 1, amountCents: 4000 },
    ]);

    // 订单 ordered_at 为 2026-08-20：按月份过滤时命中 8 月、9 月为空。
    const monthBreakdown = await authInject(app, { method: 'GET', url: '/api/finance/receipts/by-payee?month=2026-08' });
    expect(monthBreakdown.statusCode).toBe(200);
    expect(monthBreakdown.json().data.items).toEqual(breakdown.json().data.items);
    const otherMonth = await authInject(app, { method: 'GET', url: '/api/finance/receipts/by-payee?month=2026-09' });
    expect(otherMonth.statusCode).toBe(200);
    expect(otherMonth.json().data.items).toEqual([]);

    const overview = await authInject(app, { method: 'GET', url: '/api/finance/orders' });
    expect(overview.json().data.stats).toMatchObject({ receivedCents: 14000 });
    await app.close();
    database.close();
  });

  it('发票创建后保存客户开票快照，客户档案后续修改不回写已开发票', async () => {
    const { database, companyId } = await setup();
    const customerId = Number(database.prepare(
      `INSERT INTO customers
        (name, contact_name, contact_phone, shipping_info, invoice_title, tax_no, created_at, updated_at)
       VALUES ('开票公司', '财务', '13800000000', '', '开票公司', '91330200MA2XYZ0C1F', '2026-09-04', '2026-09-04')`,
    ).run().lastInsertRowid);
    const orderId = insertOrder(database, 10000, companyId);
    database.prepare('UPDATE orders SET customer_id = ? WHERE id = ?').run(customerId, orderId);

    const service = new FinanceService({ database, repository: new FinanceRepository(database) });
    const invoice = service.createInvoice(orderId, { invoiceType: '电子普通发票', title: '开票公司', taxNo: '91330200MA2XYZ0C1F', amountCents: 10000 });
    expect(invoice).toMatchObject({ title: '开票公司', taxNo: '91330200MA2XYZ0C1F' });

    database.prepare("UPDATE customers SET invoice_title = '新抬头', tax_no = '99999999' WHERE id = ?").run(customerId);
    const persisted = service.get(orderId)!.invoices.find((item) => item.id === invoice.id);
    expect(persisted).toMatchObject({ title: '开票公司', taxNo: '91330200MA2XYZ0C1F' });

    database.close();
  });

  it('财务列表返回结算方式，对私订单不计入待处理发票统计', async () => {
    const { app, database, companyId } = await setup();
    const createOrder = async (settlementType?: string) => {
      const created = await authInject(app, {
        method: 'POST',
        url: '/api/orders',
        payload: {
          orderNo: '',
          orderedAt: '2026-08-22T08:00:00.000Z',
          recipientName: '张三',
          recipientInfo: '深圳市宝安区',
          amount: 100,
          trackingNo: '',
          paymentNote: '',
          remark: '',
          ...(settlementType ? { settlementType } : {}),
          companyId,
          items: [{ name: '测试产品', sku: 'VT-0001', specification: '标准规格', packagingName: '彩盒包装', packCount: 10, quantity: 10, unitPriceCents: 1000 }],
        },
      });
      expect(created.statusCode).toBe(201);
      return Number(created.json().data.id);
    };
    const createInvoice = async (orderId: number) => {
      const response = await authInject(app, {
        method: 'POST',
        url: `/api/finance/orders/${orderId}/invoices`,
        payload: { invoiceType: '电子普通发票', title: '测试公司', taxNo: '9133', amountCents: 5000 },
      });
      expect(response.statusCode).toBe(201);
    };

    const corporateOrderId = await createOrder();
    const personalOrderId = await createOrder('personal');
    await createInvoice(corporateOrderId);
    await createInvoice(personalOrderId);

    const list = await authInject(app, { method: 'GET', url: '/api/finance/orders' });
    expect(list.statusCode).toBe(200);
    const rows = list.json().data.rows as Array<Record<string, unknown>>;
    const corporateRow = rows.find((row) => row.orderId === corporateOrderId);
    const personalRow = rows.find((row) => row.orderId === personalOrderId);
    expect(corporateRow).toMatchObject({ settlementType: 'corporate', invoiceStatus: 'incomplete' });
    expect(personalRow).toMatchObject({ settlementType: 'personal', invoiceStatus: 'incomplete' });
    // 两笔发票都是 incomplete，但只有对公订单计入待处理发票。
    expect(list.json().data.stats).toMatchObject({ pendingInvoiceCount: 1 });

    await app.close();
    database.close();
  });

  it('财务列表、统计与水单按渠道过滤', async () => {
    const { database, app } = await setup();
    const onlineId = insertOrder(database, 10000, null, 'online');
    const offlineId = insertOrder(database, 20000, null, 'offline');
    const now = new Date().toISOString();
    database.prepare(
      `INSERT INTO finance_receipts (order_id, received_at, amount_cents, created_at, updated_at)
       VALUES (?, '2026-08-20', 10000, ?, ?)`,
    ).run(onlineId, now, now);
    database.prepare(
      `UPDATE order_finance SET received_cents = 10000, outstanding_cents = 0, payment_status = 'paid', updated_at = ? WHERE order_id = ?`,
    ).run(now, onlineId);
    database.prepare(
      `INSERT INTO payment_proofs (order_id, relative_path, original_name, mime_type, size_bytes, created_at)
       VALUES (?, 'payment-profiles/fin-online.png', '线上水单.png', 'image/png', 5, ?)`,
    ).run(onlineId, now);
    database.prepare(
      `INSERT INTO payment_proofs (order_id, relative_path, original_name, mime_type, size_bytes, created_at)
       VALUES (?, 'payment-profiles/fin-offline.png', '线下水单.png', 'image/png', 5, ?)`,
    ).run(offlineId, now);

    const online = await authInject(app, { method: 'GET', url: '/api/finance/orders?channel=online&pageSize=100' });
    const onlineRows = online.json().data.rows as Array<{ orderId: number }>;
    expect(onlineRows.map((row) => row.orderId)).toContain(onlineId);
    expect(onlineRows.map((row) => row.orderId)).not.toContain(offlineId);
    expect(online.json().data.stats).toMatchObject({ receivableCents: 10000, receivedCents: 10000 });

    const offline = await authInject(app, { method: 'GET', url: '/api/finance/orders?channel=offline&pageSize=100' });
    const offlineRows = offline.json().data.rows as Array<{ orderId: number }>;
    expect(offlineRows.map((row) => row.orderId)).toContain(offlineId);
    expect(offlineRows.map((row) => row.orderId)).not.toContain(onlineId);
    expect(offline.json().data.stats).toMatchObject({ receivableCents: 20000, receivedCents: 0 });

    const proofs = await authInject(app, { method: 'GET', url: '/api/finance/proofs?channel=online' });
    expect((proofs.json().data.items as Array<{ orderId: number }>).map((row) => row.orderId)).toEqual([onlineId]);

    const onlineStats = await authInject(app, { method: 'GET', url: '/api/finance/companies/stats?month=2026-08&channel=online' });
    const onlineUnassigned = (onlineStats.json().data.items as Array<{ companyId: number | null; receivedCents: number }>).find((row) => row.companyId == null);
    expect(onlineUnassigned?.receivedCents).toBe(10000);
    const offlineStats = await authInject(app, { method: 'GET', url: '/api/finance/companies/stats?month=2026-08&channel=offline' });
    const offlineUnassigned = (offlineStats.json().data.items as Array<{ companyId: number | null; receivedCents: number }>).find((row) => row.companyId == null);
    expect(offlineUnassigned?.receivedCents).toBe(0);

    await app.close();
    database.close();
  });

  it('财务与水单列表支持多选公司、状态和未分配公司', async () => {
    const { database, companyId } = await setup();
    const otherCompanyId = Number(database.prepare(
      `INSERT INTO companies (short_name, full_name, created_at, updated_at)
       VALUES ('第二公司', '第二公司全称', '2026-08-20', '2026-08-20')`,
    ).run().lastInsertRowid);
    const orderA = insertOrder(database, 10000, companyId);
    const orderB = insertOrder(database, 20000, otherCompanyId);
    const orderC = insertOrder(database, 30000, null);
    database.prepare("UPDATE order_finance SET payment_status = 'paid', received_cents = 10000, outstanding_cents = 0 WHERE order_id = ?").run(orderA);
    database.prepare("UPDATE order_finance SET payment_status = 'partial', received_cents = 5000, outstanding_cents = 15000 WHERE order_id = ?").run(orderB);
    const insertProof = (orderId: number, status: string) => database.prepare(
      `INSERT INTO payment_proofs (order_id, relative_path, original_name, mime_type, size_bytes, payment_date, amount_cents, status, created_at)
       VALUES (?, ?, ?, 'image/png', 1, '2026-08-20', 5000, ?, '2026-08-20T08:00:00.000Z')`,
    ).run(orderId, `proof-${orderId}-${status}.png`, `proof-${orderId}.png`, status);
    insertProof(orderA, 'approved');
    insertProof(orderB, 'pending');
    insertProof(orderC, 'pending');

    const service = new FinanceService({ database, repository: new FinanceRepository(database) });
    const orderIds = (filters: Parameters<FinanceService['list']>[0]) => service.list(filters).rows.map((row) => row.orderId).sort((a, b) => a - b);

    expect(orderIds({ companyIds: [companyId, otherCompanyId] })).toEqual([orderA, orderB].sort((a, b) => a - b));
    expect(orderIds({ includeUnassignedCompany: true })).toContain(orderC);
    expect(orderIds({ paymentStatuses: ['paid', 'partial'] })).toEqual([orderA, orderB].sort((a, b) => a - b));

    expect(service.listProofs({ statuses: ['approved'] }).map((proof) => proof.orderId)).toEqual([orderA]);
    expect(service.listProofs({ statuses: ['approved', 'pending'] })).toHaveLength(3);
    expect(service.listProofs({ companyIds: [companyId], includeUnassignedCompany: true }).map((proof) => proof.orderId).sort((a, b) => a - b)).toEqual([orderA, orderC].sort((a, b) => a - b));
    expect(service.listProofs({ limit: 2 })).toHaveLength(2);

    database.close();
  });
});

describe('财务列表按日期筛选', () => {
  it('按订单日期筛出当天订单，日期和月份分别生效', async () => {
    const { database, app } = await setup();
    const day20 = insertOrder(database, 10000, null, 'offline', '2026-08-20');
    const day21 = insertOrder(database, 20000, null, 'offline', '2026-08-21');
    const orderIds = async (query: string) => {
      const response = await authInject(app, { method: 'GET', url: `/api/finance/orders?${query}` });
      expect(response.statusCode).toBe(200);
      return (response.json().data.rows as Array<{ orderId: number }>).map((row) => row.orderId).sort((a, b) => a - b);
    };
    expect(await orderIds('date=2026-08-20')).toEqual([day20]);
    expect(await orderIds('date=2026-08-21')).toEqual([day21]);
    expect(await orderIds('date=2026-09-01')).toEqual([]);
    expect(await orderIds('month=2026-08')).toEqual([day20, day21].sort((a, b) => a - b));
    database.close();
  });
});
