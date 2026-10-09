import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { EMPTY_COMPANY_PROFILE, SettingsRepository } from '../../src/server/db/settings-repository';
import { DocumentCustomerService } from '../../src/server/services/document-customer-service';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('document customer suggestions', () => {
  it('combines quotation and sales history and keeps contact details', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-customers-'));
    directories.push(directory);
    const database = openDatabase(join(directory, 'workbench.sqlite'));
    migrateDatabase(database);
    const timestamp = '2026-08-08T00:00:00.000Z';
    database.prepare(
      `INSERT INTO quotations
        (number, status, quotation_date, customer_name, contact_name, contact_phone, customer_address,
         company_snapshot_json, display_config_json, created_at, updated_at)
       VALUES (?, 'draft', ?, ?, ?, ?, ?, '{}', '{}', ?, ?)`,
    ).run('BJ20260808001', '2026-08-08', '华南五金', '张三', '13800000000', '深圳市', timestamp, timestamp);
    database.prepare(
      `INSERT INTO sales_documents
        (number, document_status, payment_status, document_date, customer_name, contact_name, contact_phone,
         address, company_snapshot_json, display_config_json, created_at, updated_at)
       VALUES (?, 'draft', 'unpaid', ?, ?, ?, ?, ?, '{}', '{}', ?, ?)`,
    ).run('XS20260808001', '2026-08-08', '华东工具', '李四', '13900000000', '上海市', timestamp, timestamp);

    const suggestions = new DocumentCustomerService(database).listSuggestions('工具');
    expect(suggestions).toEqual([{ customerName: '华东工具', contactName: '李四', contactPhone: '13900000000', address: '上海市' }]);
    database.close();
  });
});

describe('settings repository', () => {
  it('returns defaults and saves a normalized company profile', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-settings-'));
    directories.push(directory);
    const database = openDatabase(join(directory, 'workbench.sqlite'));
    migrateDatabase(database);
    const settings = new SettingsRepository(database);

    expect(settings.getCompanyProfile()).toEqual(EMPTY_COMPANY_PROFILE);
    expect(settings.saveCompanyProfile({ name: ' 示例公司 ', phone: ' 13800000000 ', defaultIssuer: '高先生' })).toEqual({
      name: '示例公司', logoRelativePath: null, phone: '13800000000', address: '', defaultIssuer: '高先生', wechatQrRelativePath: null,
    });
    expect(settings.getCompanyProfile().defaultIssuer).toBe('高先生');
    database.close();
  });
});
