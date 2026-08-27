import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { createApp } from '../../src/server/app.js';
import { openDatabase } from '../../src/server/db/connection.js';
import { migrateDatabase } from '../../src/server/db/migrate.js';
import { FileStore } from '../../src/server/files/file-store.js';
import type { FastifyInstance } from 'fastify';

const directories: string[] = [];

afterEach(async () => {
  // Windows 下 SQLite 句柄释放有延迟，重试删除避免 EBUSY。
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })));
});

async function setup(): Promise<{ database: DatabaseSync; app: FastifyInstance }> {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-sales-order-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  const fileStore = new FileStore(join(directory, 'files'));
  const app = await createApp({ database, filesDirectory: join(directory, 'files'), fileStore });
  return { database, app };
}

interface TestItem {
  name: string;
  quantity: number;
  unitPriceCents: number;
  packCount?: number | null;
}

let documentSequence = 0;

function insertSalesDocument(
  database: DatabaseSync,
  options: {
    status?: 'draft' | 'issued';
    documentDate?: string;
    consignee?: string;
    contactName?: string;
    customerName?: string;
    shippingCents?: number;
    taxRateBps?: number;
    items: TestItem[];
  },
): number {
  const timestamp = new Date().toISOString();
  const documentDate = options.documentDate ?? '2026-08-20';
  const shippingCents = options.shippingCents ?? 0;
  const taxRateBps = options.taxRateBps ?? 0;
  const subtotalCents = options.items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPriceCents), 0);
  const taxCents = Math.round((subtotalCents * taxRateBps) / 10000);
  const totalCents = subtotalCents + taxCents + shippingCents;
  documentSequence += 1;
  const result = database.prepare(`
    INSERT INTO sales_documents
      (number, document_status, document_date, customer_name, contact_name, contact_phone, address,
       recipient, shipping_cents, tax_rate_bps, subtotal_cents, tax_cents, total_cents,
       received_cents, outstanding_cents, company_snapshot_json, display_config_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, 0, ?, '{}', '{}', ?, ?)
  `).run(
    `XS-TEST-${String(documentSequence).padStart(3, '0')}`,
    options.status ?? 'issued',
    documentDate,
    options.customerName ?? '测试客户',
    options.contactName ?? '王小姐',
    options.consignee ?? '',
    shippingCents,
    taxRateBps,
    subtotalCents,
    taxCents,
    totalCents,
    totalCents,
    timestamp,
    timestamp,
  );
  const documentId = Number(result.lastInsertRowid);
  const insertItem = database.prepare(`
    INSERT INTO sales_document_items
      (sales_document_id, name, sku, specification, pack_count, quantity, unit_price_cents, amount_cents, sort_order, created_at, updated_at)
    VALUES (?, ?, '', '', ?, ?, ?, ?, ?, ?, ?)
  `);
  options.items.forEach((item, index) => {
    insertItem.run(
      documentId,
      item.name,
      item.packCount ?? null,
      item.quantity,
      item.unitPriceCents,
      Math.round(item.quantity * item.unitPriceCents),
      index,
      timestamp,
      timestamp,
    );
  });
  return documentId;
}

describe('销售单生成订单', () => {
  it('已开单销售单可生成订单：金额含税费并入运费、写入来源关联并生成财务应收', async () => {
    const { database, app } = await setup();
    const documentId = insertSalesDocument(database, {
      status: 'issued',
      consignee: '李收货',
      shippingCents: 3000,
      taxRateBps: 1000,
      items: [
        { name: '蓝牙耳机', quantity: 10, unitPriceCents: 2500, packCount: 5 },
        { name: '充电线', quantity: 5, unitPriceCents: 4000, packCount: 50 },
      ],
    });

    const response = await app.inject({ method: 'POST', url: `/api/sales-documents/${documentId}/create-order` });
    expect(response.statusCode).toBe(201);
    const order = response.json().data;
    expect(order.order_no).toMatch(/^SO/);
    expect(order.ordered_at).toBe('2026-08-20');
    expect(order.status).toBe('pending_stock');
    expect(order.recipient_name).toBe('李收货');
    expect(order.shipping_cents).toBe(7500);
    expect(order.amount_cents).toBe(52500);
    expect(order.items).toHaveLength(2);
    expect(order.items[0]).toMatchObject({ name: '蓝牙耳机', quantity: 10, unit_price_cents: 2500, pack_count: 5 });
    expect(order.remark).toContain('XS-TEST-');

    const persisted = database.prepare('SELECT source_sales_document_id FROM orders WHERE id = ?').get(order.id) as { source_sales_document_id: number };
    expect(persisted.source_sales_document_id).toBe(documentId);
    const finance = database.prepare('SELECT receivable_cents, outstanding_cents FROM order_finance WHERE order_id = ?').get(order.id) as { receivable_cents: number; outstanding_cents: number };
    expect(finance.receivable_cents).toBe(52500);
    expect(finance.outstanding_cents).toBe(52500);

    const listResponse = await app.inject({ method: 'GET', url: '/api/sales-documents' });
    const row = (listResponse.json().data.rows as Array<{ id: number; generatedOrderNo: string | null }>).find((entry) => entry.id === documentId);
    expect(row?.generatedOrderNo).toBe(order.order_no);
    await app.close();
    database.close();
  });

  it('同一销售单不能重复生成订单', async () => {
    const { database, app } = await setup();
    const documentId = insertSalesDocument(database, {
      items: [{ name: '样品', quantity: 1, unitPriceCents: 1000 }],
    });
    const first = await app.inject({ method: 'POST', url: `/api/sales-documents/${documentId}/create-order` });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: 'POST', url: `/api/sales-documents/${documentId}/create-order` });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('ORDER_ALREADY_GENERATED');
    expect(second.json().error.message).toContain(first.json().data.order_no);
    await app.close();
    database.close();
  });

  it('草稿销售单不能生成订单', async () => {
    const { database, app } = await setup();
    const documentId = insertSalesDocument(database, {
      status: 'draft',
      items: [{ name: '样品', quantity: 1, unitPriceCents: 1000 }],
    });
    const response = await app.inject({ method: 'POST', url: `/api/sales-documents/${documentId}/create-order` });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('SALES_DOCUMENT_NOT_ISSUED');
    await app.close();
    database.close();
  });

  it('数量不是正整数时拒绝生成订单', async () => {
    const { database, app } = await setup();
    const documentId = insertSalesDocument(database, {
      items: [{ name: '布料', quantity: 2.5, unitPriceCents: 1000 }],
    });
    const response = await app.inject({ method: 'POST', url: `/api/sales-documents/${documentId}/create-order` });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('ORDER_QUANTITY_INVALID');
    expect(response.json().error.message).toContain('2.5');
    await app.close();
    database.close();
  });

  it('销售单不存在时返回 404', async () => {
    const { database, app } = await setup();
    const response = await app.inject({ method: 'POST', url: '/api/sales-documents/9999/create-order' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SALES_DOCUMENT_NOT_FOUND');
    await app.close();
    database.close();
  });
});
