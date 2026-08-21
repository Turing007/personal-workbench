import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { QuotationService } from '../../src/server/services/quotation-service';
import { renderQuotationHtml } from '../../src/server/documents/quotation-template';
import { registerQuotationRoutes, type QuotationRouteOptions } from '../../src/server/routes/quotations';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function quotationInput(overrides: Record<string, unknown> = {}) {
  return {
    quotationDate: '2026-08-09',
    customerName: '华南五金',
    contactName: '张三',
    contactPhone: '13800000000',
    customerAddress: '深圳市宝安区',
    validUntil: '2026-08-31',
    remark: '七天内有效',
    taxRateBps: 1300,
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
      columns: { image: true, name: true, sku: true, specification: true, quantity: true, unitPrice: true, amount: true, remark: true },
    },
    items: [{
      clientKey: 'line-a',
      productId: null,
      isTemporary: true,
      name: '临时产品',
      sku: 'TMP-1',
      specification: '标准',
      quantity: 2,
      unitPriceCents: 1_000,
      remark: '',
      sortOrder: 0,
    }],
    customFields: [{ placement: 'footer', label: '付款方式', value: '预付款', sortOrder: 0 }],
    ...overrides,
  };
}

async function createContext(overrides: Partial<QuotationRouteOptions> = {}) {
  let database = overrides.service?.database;
  if (!database) {
    const directory = await mkdtemp(join(tmpdir(), 'workbench-quotation-route-'));
    directories.push(directory);
    database = openDatabase(join(directory, 'workbench.sqlite'));
    migrateDatabase(database);
  }
  const service = overrides.service ?? new QuotationService({ database });
  const app = Fastify();
  await app.register(multipart, { limits: { files: 20, fileSize: 10 * 1024 * 1024 } });
  await registerQuotationRoutes(app, { service, ...overrides });
  return { app, database, service };
}

function multipartBody(payload: unknown, files: Array<{ field: string; filename: string; mime: string; content: string }> = []) {
  const boundary = `----quotation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  const append = (value: string | Buffer) => chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
  append(`--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(payload)}\r\n`);
  files.forEach((file) => {
    append(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.mime}\r\n\r\n`);
    append(file.content);
    append('\r\n');
  });
  append(`--${boundary}--\r\n`);
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('quotation routes', () => {
  it('supports JSON CRUD, list filters, status updates, and confirmed deletion', async () => {
    const { app, database } = await createContext();
    const created = await app.inject({ method: 'POST', url: '/api/quotations', payload: quotationInput() });
    expect(created.statusCode).toBe(201);
    const quotation = created.json().data;
    expect(quotation).toMatchObject({ number: 'BJ20260809001', status: 'draft', totalCents: 2260 });

    const listed = await app.inject({ method: 'GET', url: '/api/quotations?status=draft&q=华南&page=1&pageSize=10' });
    expect(listed.json().data).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect((await app.inject({ method: 'GET', url: `/api/quotations/${quotation.id}` })).json().data.customerName).toBe('华南五金');

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/quotations/${quotation.id}`,
      payload: quotationInput({ customerName: '修改客户', taxRateBps: 0 }),
    });
    expect(updated.json().data).toMatchObject({ customerName: '修改客户', totalCents: 2000 });
    expect((await app.inject({ method: 'PATCH', url: `/api/quotations/${quotation.id}/status`, payload: { status: 'won' } })).json().data.status).toBe('won');

    const confirmation = await app.inject({ method: 'DELETE', url: `/api/quotations/${quotation.id}` });
    expect(confirmation.statusCode).toBe(409);
    expect(confirmation.json().error.code).toBe('CONFIRMATION_REQUIRED');
    expect((await app.inject({ method: 'DELETE', url: `/api/quotations/${quotation.id}`, payload: { confirmed: true } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/quotations/${quotation.id}` })).statusCode).toBe(404);
    await app.close();
    database.close();
  });

  it('accepts multiple multipart item images using client keys', async () => {
    const prepared = vi.fn(async (_kind, inputs) => ({
      assets: inputs.map((input: { key: string; upload?: { originalName: string; mimeType: string } }) => ({
        key: input.key,
        relativePath: `quotation-assets/${input.key}.png`,
        originalName: input.upload?.originalName ?? 'image.png',
        mimeType: input.upload?.mimeType ?? 'image/png',
        size: 3,
      })),
      stagedFiles: [],
      state: 'prepared' as const,
    }));
    const directory = await mkdtemp(join(tmpdir(), 'workbench-quotation-multipart-'));
    directories.push(directory);
    const database = openDatabase(join(directory, 'workbench.sqlite'));
    migrateDatabase(database);
    const service = new QuotationService({
      database,
      assetManager: {
        prepareItemImages: prepared,
        async commit(batch) { batch.state = 'committed'; return batch.assets; },
        async rollback(batch) { batch.state = 'rolled-back'; },
      },
    });
    const { app } = await createContext({ service });
    const input = quotationInput({
      items: [
        { ...quotationInput().items[0], clientKey: 'first', name: '产品一' },
        { ...quotationInput().items[0], clientKey: 'second', name: '产品二', sortOrder: 1 },
      ],
    });
    const body = multipartBody(input, [
      { field: 'itemImage.first', filename: 'first.png', mime: 'image/png', content: 'one' },
      { field: 'itemImage.second', filename: 'second.webp', mime: 'image/webp', content: 'two' },
    ]);
    const response = await app.inject({ method: 'POST', url: '/api/quotations', ...body });
    expect(response.statusCode).toBe(201);
    expect(response.json().data.items.map((item: { imageRelativePath: string }) => item.imageRelativePath)).toEqual([
      'quotation-assets/first.png',
      'quotation-assets/second.png',
    ]);
    expect(prepared).toHaveBeenCalledOnce();
    expect(prepared.mock.calls[0]?.[1]).toHaveLength(2);
    await app.close();
    database.close();
  });

  it('rejects unknown multipart fields and orphan image keys', async () => {
    const { app, database } = await createContext();
    const unknown = multipartBody(quotationInput(), [{ field: 'file', filename: 'x.png', mime: 'image/png', content: 'x' }]);
    expect((await app.inject({ method: 'POST', url: '/api/quotations', ...unknown })).json().error.code).toBe('VALIDATION_ERROR');
    const orphan = multipartBody(quotationInput(), [{ field: 'itemImage.missing', filename: 'x.png', mime: 'image/png', content: 'x' }]);
    expect((await app.inject({ method: 'POST', url: '/api/quotations', ...orphan })).json().error.field).toBe('itemImage.missing');
    await app.close();
    database.close();
  });

  it('renders escaped HTML with conditional columns and historical image snapshots', async () => {
    const readFile = vi.fn(async () => Buffer.from('historical-image'));
    const html = await renderQuotationHtml({
      id: 1,
      number: 'BJ<script>',
      status: 'draft',
      quotationDate: '2026-08-09',
      customerName: '<img src=x onerror=alert(1)>',
      contactName: '张三',
      contactPhone: '13800000000',
      customerAddress: '深圳',
      validUntil: '',
      remark: '<b>备注</b>',
      taxRateBps: 1300,
      subtotalCents: 1000,
      taxCents: 130,
      totalCents: 1130,
      subtotal: 10,
      tax: 1.3,
      total: 11.3,
      companySnapshot: { name: '示例公司', logoRelativePath: null, phone: '', address: '', defaultIssuer: '' },
      displayConfig: {
        showLogo: false,
        showCompanyPhone: false,
        showCompanyAddress: false,
        showContactPhone: false,
        showTax: false,
        showTaxIncludedTotal: false,
        columns: { image: true, name: true, sku: false, specification: false, quantity: true, unitPrice: false, amount: true, remark: false },
      },
      items: [{ id: 10, quotationId: 1, productId: null, isTemporary: true, name: '<产品>', sku: 'HIDDEN-SKU', specification: 'HIDDEN-SPEC', imageRelativePath: 'quotation-assets/history.webp', quantity: 1, unitPriceCents: 1000, amountCents: 1000, remark: 'HIDDEN-REMARK', sortOrder: 0 }],
      customFields: [],
      createdAt: '2026-08-09',
      updatedAt: '2026-08-09',
    }, { readFile });
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;产品&gt;');
    expect(html).not.toContain('HIDDEN-SKU');
    expect(html).not.toContain('联系电话');
    expect(html).not.toContain('价税合计');
    expect(html).toContain('data:image/webp;base64,');
    expect(readFile).toHaveBeenCalledWith('quotation-assets/history.webp');
  });

  it('downloads PDF without changing status and copies only won quotations', async () => {
    const render = vi.fn(async (html: string) => {
      expect(html).toContain('报价单');
      return Buffer.from('%PDF-quotation');
    });
    const copyQuotationToSales = vi.fn(async (id: number) => ({ id: id + 100, number: 'XS20260809001' }));
    const { app, database, service } = await createContext({ pdfRenderer: { render }, copyQuotationToSales });
    const quotation = (await app.inject({ method: 'POST', url: '/api/quotations', payload: quotationInput() })).json().data;
    const rejected = await app.inject({ method: 'POST', url: `/api/quotations/${quotation.id}/copy-to-sales` });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.code).toBe('QUOTATION_NOT_WON');

    const pdf = await app.inject({ method: 'GET', url: `/api/quotations/${quotation.id}/pdf` });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toBe(`attachment; filename="${quotation.number}.pdf"`);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect(service.get(quotation.id)?.status).toBe('draft');

    service.updateStatus(quotation.id, 'won');
    const copied = await app.inject({ method: 'POST', url: `/api/quotations/${quotation.id}/copy-to-sales` });
    expect(copied.statusCode).toBe(201);
    expect(copied.json().data.number).toBe('XS20260809001');
    expect(copyQuotationToSales).toHaveBeenCalledWith(quotation.id);
    await app.close();
    database.close();
  });

  it('reports PDF failures without changing quotation status', async () => {
    const { app, database, service } = await createContext({
      pdfRenderer: { render: vi.fn(async () => { throw new Error('renderer failed'); }) },
    });
    const quotation = (await app.inject({ method: 'POST', url: '/api/quotations', payload: quotationInput() })).json().data;
    const response = await app.inject({ method: 'GET', url: `/api/quotations/${quotation.id}/pdf` });
    expect(response.statusCode).toBe(500);
    expect(service.get(quotation.id)?.status).toBe('draft');
    await app.close();
    database.close();
  });
});
