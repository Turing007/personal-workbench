import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { SettingsRepository } from '../../src/server/db/settings-repository';
import { FileStore } from '../../src/server/files/file-store';
import { registerDocumentCustomerRoutes } from '../../src/server/routes/document-customers';
import { registerSettingsRoutes } from '../../src/server/routes/settings';
import { DocumentCustomerService } from '../../src/server/services/document-customer-service';
import { SettingsService } from '../../src/server/services/settings-service';

const temporaryDirectories: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-settings-routes-'));
  temporaryDirectories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  const fileStore = new FileStore(join(directory, 'files'));
  const settings = new SettingsRepository(database);
  const app = Fastify();
  apps.push(app);
  app.addHook('onClose', async () => database.close());
  await app.register(multipart, { limits: { files: 1, fileSize: 10 * 1024 * 1024 } });
  await registerSettingsRoutes(app, { service: new SettingsService(settings, fileStore) });
  await registerDocumentCustomerRoutes(app, { service: new DocumentCustomerService(database) });
  return { app, database, fileStore, settings };
}

function multipartImage(filename: string, mimeType: string, bytes: Buffer) {
  const boundary = `----workbench-${Date.now()}`;
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

describe('company profile routes', () => {
  it('returns defaults and saves normalized company fields without accepting a logo path', async () => {
    const { app } = await createFixture();

    const initial = await app.inject({ method: 'GET', url: '/api/settings/company-profile' });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().data).toEqual({
      name: '',
      logoRelativePath: null,
      phone: '',
      address: '',
      defaultIssuer: '',
    });

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/settings/company-profile',
      payload: {
        name: ' 示例公司 ',
        phone: ' 13800000000 ',
        address: ' 深圳市 ',
        defaultIssuer: ' 高先生 ',
        logoRelativePath: 'quotation-assets/history.png',
      },
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toEqual({
      name: '示例公司',
      logoRelativePath: null,
      phone: '13800000000',
      address: '深圳市',
      defaultIssuer: '高先生',
    });
  });

  it('replaces and deletes the current logo while preserving historical document snapshots', async () => {
    const { app, fileStore } = await createFixture();
    const firstUpload = multipartImage('first.png', 'image/png', Buffer.from('first-logo'));
    const first = await app.inject({
      method: 'POST',
      url: '/api/settings/company-profile/logo',
      ...firstUpload,
    });
    expect(first.statusCode).toBe(201);
    const firstPath = String(first.json().data.logoRelativePath);
    expect(firstPath).toMatch(/^company-logos\/[0-9a-f-]+\.png$/);

    const historical = await fileStore.copyImage(firstPath, 'quotation-asset', 'history.png', 'image/png');
    const secondUpload = multipartImage('second.webp', 'image/webp', Buffer.from('second-logo'));
    const second = await app.inject({
      method: 'POST',
      url: '/api/settings/company-profile/logo',
      ...secondUpload,
    });
    expect(second.statusCode).toBe(201);
    const secondPath = String(second.json().data.logoRelativePath);
    expect(secondPath).toMatch(/^company-logos\/[0-9a-f-]+\.webp$/);
    await expect(fileStore.readFile(firstPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fileStore.readFile(historical.relativePath)).resolves.toEqual(Buffer.from('first-logo'));

    const deleted = await app.inject({ method: 'DELETE', url: '/api/settings/company-profile/logo' });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().data.logoRelativePath).toBeNull();
    await expect(fileStore.readFile(secondPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fileStore.readFile(historical.relativePath)).resolves.toEqual(Buffer.from('first-logo'));
  });

  it('rejects non-image logo uploads and keeps the current profile unchanged', async () => {
    const { app } = await createFixture();
    const upload = multipartImage('notes.txt', 'text/plain', Buffer.from('not-an-image'));
    const response = await app.inject({
      method: 'POST',
      url: '/api/settings/company-profile/logo',
      ...upload,
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_IMAGE_TYPE' },
    });
    const profile = await app.inject({ method: 'GET', url: '/api/settings/company-profile' });
    expect(profile.json().data.logoRelativePath).toBeNull();
  });
});

describe('document customer suggestion route', () => {
  it('filters historical quotation and sales customers and limits the response to twenty items', async () => {
    const { app, database } = await createFixture();
    const timestamp = '2026-08-09T00:00:00.000Z';
    database.prepare(
      `INSERT INTO quotations
        (number, status, quotation_date, customer_name, contact_name, contact_phone, customer_address,
         company_snapshot_json, display_config_json, created_at, updated_at)
       VALUES (?, 'draft', ?, ?, ?, ?, ?, '{}', '{}', ?, ?)`,
    ).run('BJ20260809001', '2026-08-09', '华南五金', '张三', '13800000000', '深圳市', timestamp, timestamp);
    database.prepare(
      `INSERT INTO sales_documents
        (number, document_status, payment_status, document_date, customer_name, contact_name, contact_phone,
         address, company_snapshot_json, display_config_json, created_at, updated_at)
       VALUES (?, 'draft', 'unpaid', ?, ?, ?, ?, ?, '{}', '{}', ?, ?)`,
    ).run('XS20260809001', '2026-08-09', '华东工具', '李四', '13900000000', '上海市', timestamp, timestamp);

    const response = await app.inject({
      method: 'GET',
      url: '/api/document-customers/suggestions?q=%E5%B7%A5%E5%85%B7',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      items: [{ customerName: '华东工具', contactName: '李四', contactPhone: '13900000000', address: '上海市' }],
    });
  });
});
