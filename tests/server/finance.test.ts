import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { openDatabase } from '../../src/server/db/connection.js';
import { migrateDatabase } from '../../src/server/db/migrate.js';
import { FileStore } from '../../src/server/files/file-store.js';
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
    const uploaded = await app.inject({ method: 'POST', url: `/api/finance/orders/${orderId}/proofs`, payload: form as unknown as BodyInit, headers: Object.fromEntries(form.entries()) });
    expect(uploaded.statusCode).toBe(201);
    const proofId = uploaded.json().data.id;
    const approved = await app.inject({ method: 'POST', url: `/api/finance/proofs/${proofId}/approve`, payload: {} });
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
});
