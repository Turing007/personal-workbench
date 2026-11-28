import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { openDatabase } from '../../src/server/db/connection.js';
import { migrateDatabase } from '../../src/server/db/migrate.js';
import { authInject, setupAdmin } from './helpers/auth.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function setup(): Promise<{ database: DatabaseSync; app: Awaited<ReturnType<typeof createApp>> }> {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-versions-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  const app = await createApp({ database });
  await setupAdmin(app);
  return { database, app };
}

function quotationInput(overrides: Record<string, unknown> = {}) {
  return {
    quotationDate: '2026-11-20',
    customerName: '版本客户',
    contactName: '王小姐',
    contactPhone: '13800000000',
    customerAddress: '深圳市宝安区',
    validUntil: '2026-12-20',
    remark: '首版报价',
    taxRateBps: 0,
    companySnapshot: {
      name: '个人工作台',
      logoRelativePath: null,
      phone: '0755-12345678',
      address: '深圳市',
      defaultIssuer: '高先生',
    },
    displayConfig: {
      showLogo: false,
      showCompanyPhone: true,
      showCompanyAddress: true,
      showContactPhone: true,
      showTax: true,
      showTaxIncludedTotal: true,
      columns: { image: true, name: true, specification: true, unitPrice: true, tierPrice: true, remark: true },
    },
    items: [{
      clientKey: 'line-a',
      productId: null,
      isTemporary: true,
      name: '临时产品',
      sku: 'TMP-1',
      specification: '标准',
      unitPriceCents: 1000,
      remark: '',
      sortOrder: 0,
    }],
    customFields: [{ placement: 'footer', label: '付款方式', value: '预付款', sortOrder: 0 }],
    ...overrides,
  };
}

function salesInput(overrides: Record<string, unknown> = {}) {
  return {
    documentDate: '2026-11-20',
    customerName: '版本客户',
    contactName: '王小姐',
    contactPhone: '13800000000',
    customerAddress: '深圳市宝安区',
    purchaseOrderNo: 'PO-V1',
    shippingCents: 0,
    taxRateBps: 0,
    issuer: '',
    consignee: '王小姐',
    remark: '首版销售单',
    items: [{
      clientKey: 'line-a',
      productId: null,
      isTemporary: true,
      productCode: 'TMP-1',
      name: '临时产品',
      sku: 'TMP-1',
      specification: '标准',
      quantity: 2,
      unitPriceCents: 5000,
      remark: '',
      sortOrder: 0,
    }],
    ...overrides,
  };
}

function versionsOf(app: Awaited<ReturnType<typeof createApp>>, path: string) {
  return authInject(app, { method: 'GET', url: path });
}

describe('单据版本', () => {
  it('报价单创建、编辑、改状态各追加一个版本，历史快照不被后续编辑覆盖', async () => {
    const { database, app } = await setup();

    const created = await authInject(app, { method: 'POST', url: '/api/quotations', payload: quotationInput() });
    expect(created.statusCode).toBe(201);
    const quotationId = Number(created.json().data.id);

    const updated = await authInject(app, {
      method: 'PUT',
      url: `/api/quotations/${quotationId}`,
      payload: quotationInput({
        remark: '第二版报价',
        items: [{
          clientKey: 'line-a',
          productId: null,
          isTemporary: true,
          name: '临时产品',
          sku: 'TMP-1',
          specification: '标准',
          unitPriceCents: 1200,
          remark: '',
          sortOrder: 0,
        }],
      }),
    });
    expect(updated.statusCode).toBe(200);

    const status = await authInject(app, {
      method: 'PATCH',
      url: `/api/quotations/${quotationId}/status`,
      payload: { status: 'sent' },
    });
    expect(status.statusCode).toBe(200);

    const list = await versionsOf(app, `/api/quotations/${quotationId}/versions`);
    expect(list.statusCode).toBe(200);
    const versions = list.json().data as Array<Record<string, unknown>>;
    expect(versions.map((version) => version.versionNo)).toEqual([3, 2, 1]);
    expect(versions.map((version) => version.action)).toEqual(['status', 'update', 'create']);
    expect(versions.every((version) => version.createdBy === 'admin')).toBe(true);
    expect(versions[0]).toMatchObject({ documentType: 'quotation', documentStatus: 'sent' });
    expect(versions[0]!.documentNumber).toBe(created.json().data.number);

    const first = await versionsOf(app, `/api/quotations/${quotationId}/versions/1`);
    expect(first.statusCode).toBe(200);
    const firstDetail = first.json().data;
    expect(firstDetail.documentStatus).toBe('draft');
    expect(firstDetail.snapshot.remark).toBe('首版报价');
    expect(firstDetail.snapshot.items[0].unitPriceCents).toBe(1000);
    expect(firstDetail.totalCents).toBe(1000);

    const second = await versionsOf(app, `/api/quotations/${quotationId}/versions/2`);
    expect(second.json().data.snapshot.remark).toBe('第二版报价');
    expect(second.json().data.snapshot.items[0].unitPriceCents).toBe(1200);
    expect(second.json().data.totalCents).toBe(1200);

    expect(database.prepare('SELECT COUNT(*) AS count FROM document_versions WHERE document_type = ? AND document_id = ?').get('quotation', quotationId)?.count).toBe(3);

    await app.close();
    database.close();
  });

  it('销售单创建与编辑记录版本，状态变更记录开单状态', async () => {
    const { database, app } = await setup();

    const created = await authInject(app, { method: 'POST', url: '/api/sales-documents', payload: salesInput() });
    expect(created.statusCode).toBe(201);
    const documentId = Number(created.json().data.id);

    const updated = await authInject(app, {
      method: 'PUT',
      url: `/api/sales-documents/${documentId}`,
      payload: salesInput({
        remark: '第二版销售单',
        items: [{
          clientKey: 'line-a',
          productId: null,
          isTemporary: true,
          productCode: 'TMP-1',
          name: '临时产品',
          sku: 'TMP-1',
          specification: '标准',
          quantity: 3,
          unitPriceCents: 5000,
          remark: '',
          sortOrder: 0,
        }],
      }),
    });
    expect(updated.statusCode).toBe(200);

    const status = await authInject(app, {
      method: 'PATCH',
      url: `/api/sales-documents/${documentId}/status`,
      payload: { status: 'issued' },
    });
    expect(status.statusCode).toBe(200);

    const list = await versionsOf(app, `/api/sales-documents/${documentId}/versions`);
    expect(list.statusCode).toBe(200);
    const versions = list.json().data as Array<Record<string, unknown>>;
    expect(versions.map((version) => version.action)).toEqual(['status', 'update', 'create']);
    expect(versions[0]).toMatchObject({ documentType: 'sales_document', documentStatus: 'issued', totalCents: 15000 });

    const first = await versionsOf(app, `/api/sales-documents/${documentId}/versions/1`);
    expect(first.json().data).toMatchObject({
      documentStatus: 'draft',
      totalCents: 10000,
      snapshot: { remark: '首版销售单' },
    });
    expect(first.json().data.snapshot.items[0].quantity).toBe(2);

    await app.close();
    database.close();
  });

  it('报价单复制为销售单会记录销售单 V1，重复提交相同状态不会追加版本', async () => {
    const { database, app } = await setup();

    const quotation = await authInject(app, { method: 'POST', url: '/api/quotations', payload: quotationInput() });
    const quotationId = Number(quotation.json().data.id);
    const won = await authInject(app, {
      method: 'PATCH',
      url: `/api/quotations/${quotationId}/status`,
      payload: { status: 'won' },
    });
    expect(won.statusCode).toBe(200);
    const repeated = await authInject(app, {
      method: 'PATCH',
      url: `/api/quotations/${quotationId}/status`,
      payload: { status: 'won' },
    });
    expect(repeated.statusCode).toBe(200);
    const quotationVersions = await versionsOf(app, `/api/quotations/${quotationId}/versions`);
    expect(quotationVersions.json().data.map((version: Record<string, unknown>) => version.action)).toEqual(['status', 'create']);

    const copied = await authInject(app, { method: 'POST', url: `/api/quotations/${quotationId}/copy-to-sales` });
    expect(copied.statusCode).toBe(201);
    const documentId = Number(copied.json().data.id);
    const salesVersions = await versionsOf(app, `/api/sales-documents/${documentId}/versions`);
    expect(salesVersions.json().data).toHaveLength(1);
    expect(salesVersions.json().data[0]).toMatchObject({
      action: 'create',
      documentStatus: 'draft',
      createdBy: 'admin',
    });
    const salesVersion = await versionsOf(app, `/api/sales-documents/${documentId}/versions/1`);
    expect(salesVersion.json().data.snapshot).toMatchObject({ sourceQuotationId: quotationId });

    await app.close();
    database.close();
  });

  it('版本写入失败会连同单据一起回滚，重试不会留下重复单据', async () => {
    const { database, app } = await setup();
    database.exec(`
      CREATE TRIGGER fail_version_insert BEFORE INSERT ON document_versions
      BEGIN SELECT RAISE(ABORT, 'version insert failed'); END;
    `);

    const failed = await authInject(app, { method: 'POST', url: '/api/quotations', payload: quotationInput() });
    expect(failed.statusCode).toBe(500);
    expect(database.prepare('SELECT COUNT(*) AS count FROM quotations').get()?.count).toBe(0);

    const failedSales = await authInject(app, { method: 'POST', url: '/api/sales-documents', payload: salesInput() });
    expect(failedSales.statusCode).toBe(500);
    expect(database.prepare('SELECT COUNT(*) AS count FROM sales_documents').get()?.count).toBe(0);

    database.exec('DROP TRIGGER fail_version_insert');
    const retried = await authInject(app, { method: 'POST', url: '/api/quotations', payload: quotationInput() });
    expect(retried.statusCode).toBe(201);
    const quotationId = Number(retried.json().data.id);
    expect(database.prepare('SELECT COUNT(*) AS count FROM quotations').get()?.count).toBe(1);
    const versions = await versionsOf(app, `/api/quotations/${quotationId}/versions`);
    expect(versions.json().data.map((version: Record<string, unknown>) => version.action)).toEqual(['create']);

    await app.close();
    database.close();
  });

  it('删除单据时一并清除其版本快照，不再留下读不到的孤儿记录', async () => {
    const { database, app } = await setup();

    const sales = await authInject(app, { method: 'POST', url: '/api/sales-documents', payload: salesInput() });
    const salesId = Number(sales.json().data.id);
    const salesVersions = database.prepare(
      'SELECT COUNT(*) AS count FROM document_versions WHERE document_type = ? AND document_id = ?',
    ).get('sales_document', salesId)?.count;
    expect(salesVersions).toBe(1);
    const deletedSales = await authInject(app, { method: 'DELETE', url: `/api/sales-documents/${salesId}` });
    expect(deletedSales.statusCode).toBe(200);
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM document_versions WHERE document_type = ? AND document_id = ?',
    ).get('sales_document', salesId)?.count).toBe(0);

    const quotation = await authInject(app, { method: 'POST', url: '/api/quotations', payload: quotationInput() });
    const quotationId = Number(quotation.json().data.id);
    const deletedQuotation = await authInject(app, { method: 'DELETE', url: `/api/quotations/${quotationId}` });
    expect(deletedQuotation.statusCode).toBe(200);
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM document_versions WHERE document_type = ? AND document_id = ?',
    ).get('quotation', quotationId)?.count).toBe(0);

    await app.close();
    database.close();
  });

  it('版本接口对不存在的单据、版本号和非法参数返回明确错误', async () => {
    const { database, app } = await setup();
    const created = await authInject(app, { method: 'POST', url: '/api/sales-documents', payload: salesInput() });
    const documentId = Number(created.json().data.id);

    const missingDocument = await versionsOf(app, '/api/sales-documents/9999/versions');
    expect(missingDocument.statusCode).toBe(404);

    const missingVersion = await versionsOf(app, `/api/sales-documents/${documentId}/versions/99`);
    expect(missingVersion.statusCode).toBe(404);
    expect(missingVersion.json().error.code).toBe('VERSION_NOT_FOUND');

    const badVersion = await versionsOf(app, `/api/sales-documents/${documentId}/versions/0`);
    expect(badVersion.statusCode).toBe(400);
    expect(badVersion.json().error.code).toBe('INVALID_ID');

    const missingQuotation = await versionsOf(app, '/api/quotations/9999/versions');
    expect(missingQuotation.statusCode).toBe(404);

    await app.close();
    database.close();
  });
});
