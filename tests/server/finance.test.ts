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
  return { database, app, fileStore };
}

function insertOrder(database: DatabaseSync, amountCents = 10000): number {
  const result = database.prepare(`
    INSERT INTO orders (order_no, ordered_at, recipient_name, amount, amount_cents, shipping_cents, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, 'pending_stock', ?, ?)
  `).run(`FIN-${Date.now()}-${Math.random()}`, '2026-08-20', '客户', amountCents / 100, amountCents, new Date().toISOString(), new Date().toISOString());
  const orderId = Number(result.lastInsertRowid);
  database.prepare(`INSERT INTO order_finance (order_id, receivable_cents, outstanding_cents, payment_status, proof_status, invoice_status, created_at, updated_at) VALUES (?, ?, ?, 'unpaid', 'none', 'not_requested', ?, ?)`).run(orderId, amountCents, amountCents, new Date().toISOString(), new Date().toISOString());
  return orderId;
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

  it('状态聚合、发票金额校验和发票文件上传可用', async () => {
    const { database, fileStore } = await setup();
    const orderId = insertOrder(database, 10000);
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
    const { database, app } = await setup();
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
    const { database } = await setup();
    const customerId = Number(database.prepare(
      `INSERT INTO customers
        (name, contact_name, contact_phone, shipping_info, invoice_title, tax_no, created_at, updated_at)
       VALUES ('开票公司', '财务', '13800000000', '', '开票公司', '91330200MA2XYZ0C1F', '2026-09-04', '2026-09-04')`,
    ).run().lastInsertRowid);
    const orderId = insertOrder(database, 10000);
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
    const { app, database } = await setup();
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
});
