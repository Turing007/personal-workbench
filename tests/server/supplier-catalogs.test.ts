import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { migrateDatabase } from '../../src/server/db/migrate';
import { FileStore } from '../../src/server/files/file-store';
import { authInject, setupAdmin } from './helpers/auth';

interface TestContext {
  app: FastifyInstance;
  database: DatabaseSync;
  fileStore: FileStore;
  directory: string;
}

const contexts: TestContext[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async (context) => {
    await context.app.close();
    await rm(context.directory, { recursive: true, force: true });
  }));
});

async function testApp(): Promise<TestContext> {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-supplier-catalogs-'));
  const database = new DatabaseSync(':memory:');
  migrateDatabase(database);
  const fileStore = new FileStore(join(directory, 'files'));
  const app = await createApp({ database, fileStore });
  app.addHook('onClose', async () => database.close());
  await setupAdmin(app);
  const context = { app, database, fileStore, directory };
  contexts.push(context);
  return context;
}

function multipartFile(filename: string, bytes: Buffer, mimeType: string) {
  const boundary = `----supplier-catalog-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function createCatalog(app: FastifyInstance, overrides: Record<string, unknown> = {}) {
  const response = await authInject(app, {
    method: 'POST',
    url: '/api/supplier-catalogs',
    payload: {
      supplier: '东莞某某五金厂',
      name: '2026 新品图册',
      receivedAt: '2026-10-20',
      remark: '只含电钻',
      ...overrides,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json().data as { id: number; supplier: string; name: string; receivedAt: string; remark: string; files: Array<{ id: number; relativePath: string; originalName: string; mimeType: string; size: number; url: string }> };
}

async function uploadFile(app: FastifyInstance, catalogId: number, filename: string, mimeType = 'application/pdf') {
  const part = multipartFile(filename, Buffer.from(`content-${filename}`), mimeType);
  return authInject(app, {
    method: 'POST',
    url: `/api/supplier-catalogs/${catalogId}/files`,
    payload: part.payload,
    headers: part.headers,
  });
}

describe('供应商产品图册', () => {
  it('新建、追加文件、列表、改信息、删除单个文件与整条记录', async () => {
    const { app, fileStore } = await testApp();
    const catalog = await createCatalog(app);
    expect(catalog).toMatchObject({ supplier: '东莞某某五金厂', name: '2026 新品图册', receivedAt: '2026-10-20', remark: '只含电钻' });
    expect(catalog.files).toEqual([]);

    const pdf = await uploadFile(app, catalog.id, '总册.pdf');
    expect(pdf.statusCode).toBe(201);
    const pdfData = pdf.json().data as { id: number; relativePath: string; originalName: string; mimeType: string; size: number; url: string };
    expect(pdfData.originalName).toBe('总册.pdf');
    expect(pdfData.mimeType).toBe('application/pdf');
    expect(pdfData.relativePath).toMatch(/^supplier-catalogs\/[0-9a-f-]+\.pdf$/);
    expect(pdfData.url).toBe(`/files/${pdfData.relativePath}`);
    expect(await fileStore.readFile(pdfData.relativePath)).toEqual(Buffer.from('content-总册.pdf'));

    const png = await uploadFile(app, catalog.id, '细节图.png', 'image/png');
    expect(png.statusCode).toBe(201);

    const list = (await authInject(app, { method: 'GET', url: '/api/supplier-catalogs' })).json().data.items as Array<{ id: number; files: Array<{ originalName: string }> }>;
    expect(list).toHaveLength(1);
    expect(list[0].files.map((file) => file.originalName)).toEqual(['总册.pdf', '细节图.png']);

    const updated = await authInject(app, {
      method: 'PUT',
      url: `/api/supplier-catalogs/${catalog.id}`,
      payload: { supplier: '宁波某某工具', name: '2026 春季图册', receivedAt: '2026-10-22', remark: '补充电锤' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({ supplier: '宁波某某工具', name: '2026 春季图册', receivedAt: '2026-10-22', remark: '补充电锤' });

    expect((await authInject(app, { method: 'DELETE', url: `/api/supplier-catalogs/${catalog.id}/files/${pdfData.id}` })).statusCode).toBe(200);
    await expect(fileStore.readFile(pdfData.relativePath)).rejects.toThrow();
    const afterFileDelete = (await authInject(app, { method: 'GET', url: '/api/supplier-catalogs' })).json().data.items[0];
    expect(afterFileDelete.files.map((file: { originalName: string }) => file.originalName)).toEqual(['细节图.png']);

    expect((await authInject(app, { method: 'DELETE', url: `/api/supplier-catalogs/${catalog.id}` })).statusCode).toBe(200);
    expect((await authInject(app, { method: 'GET', url: '/api/supplier-catalogs' })).json().data.items).toEqual([]);
    await expect(fileStore.readFile(png.json().data.relativePath)).rejects.toThrow();
  });

  it('校验必填与日期；拒收不支持的格式；一条最多 20 个文件', async () => {
    const { app } = await testApp();
    for (const payload of [
      { name: '图册', receivedAt: '2026-10-20' },
      { supplier: '供应商', receivedAt: '2026-10-20' },
      { supplier: '供应商', name: '图册', receivedAt: '2026-02-30' },
    ]) {
      const response = await authInject(app, { method: 'POST', url: '/api/supplier-catalogs', payload });
      expect(response.statusCode).toBe(400);
    }

    const catalog = await createCatalog(app);
    const doc = multipartFile('说明.doc', Buffer.from('doc'), 'application/msword');
    const rejected = await authInject(app, {
      method: 'POST',
      url: `/api/supplier-catalogs/${catalog.id}/files`,
      payload: doc.payload,
      headers: doc.headers,
    });
    expect(rejected.statusCode).toBe(415);
    expect(rejected.json().error.code).toBe('UNSUPPORTED_SUPPLIER_CATALOG_TYPE');

    for (let index = 0; index < 20; index += 1) {
      expect((await uploadFile(app, catalog.id, `第${index + 1}页.pdf`)).statusCode).toBe(201);
    }
    const limit = await uploadFile(app, catalog.id, '第21页.pdf');
    expect(limit.statusCode).toBe(400);
    expect(limit.json().error.code).toBe('FILE_LIMIT');

    expect((await authInject(app, { method: 'DELETE', url: `/api/supplier-catalogs/${catalog.id}` })).statusCode).toBe(200);
  });
});
