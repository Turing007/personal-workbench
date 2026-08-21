import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import archiver from 'archiver';
import { afterEach, describe, expect, it } from 'vitest';
import { BackupError, BackupService } from '../../src/server/backup/backup-service';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';

const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-backup-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function makeZip(entries: Array<{ name: string; content: string | Buffer }>): Promise<Buffer> {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk));

  const finished = new Promise<void>((resolve, reject) => {
    output.on('end', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });

  archive.pipe(output);
  entries.forEach((entry) => archive.append(entry.content, { name: entry.name }));
  await archive.finalize();
  await finished;
  return Buffer.concat(chunks);
}

function insertProduct(database: DatabaseSync, name: string): number {
  const timestamp = new Date().toISOString();
  const result = database
    .prepare(
      `INSERT INTO products
        (name, sku, specification, category, purchase_price, supplier, colors_json, battery_plugs_json, accessories, remark, created_at, updated_at)
       VALUES (?, ?, ?, '', NULL, '', '[]', '[]', '', '', ?, ?)`,
    )
    .run(name, `${name}-SKU`, '标准', timestamp, timestamp);
  return Number(result.lastInsertRowid);
}

function createService(dataDirectory: string, database: DatabaseSync): BackupService {
  return new BackupService({
    database,
    databasePath: join(dataDirectory, 'workbench.sqlite'),
    dataDirectory,
    backupsDirectory: join(dataDirectory, 'backups'),
  });
}

function insertDocumentFixtures(database: DatabaseSync): void {
  database
    .prepare("INSERT INTO document_number_sequences (document_type, sequence_date, last_value) VALUES ('quotation', '2026-08-08', 1)")
    .run();
  const quotationId = Number(database
    .prepare("INSERT INTO quotations (number, status, quotation_date, company_snapshot_json, display_config_json, created_at, updated_at) VALUES ('BJ20260808001', 'draft', '2026-08-08', '{}', '{}', '2026-08-08', '2026-08-08')")
    .run().lastInsertRowid);
  database.prepare("INSERT INTO quotation_items (quotation_id, name, quantity, created_at, updated_at) VALUES (?, '报价产品', 2, '2026-08-08', '2026-08-08')").run(quotationId);
  database.prepare("INSERT INTO quotation_custom_fields (quotation_id, placement, label, value) VALUES (?, 'footer', '付款', '预付款')").run(quotationId);
  const salesId = Number(database
    .prepare("INSERT INTO sales_documents (number, source_quotation_id, document_status, document_date, company_snapshot_json, display_config_json, created_at, updated_at) VALUES ('XS20260808001', ?, 'draft', '2026-08-08', '{}', '{}', '2026-08-08', '2026-08-08')")
    .run(quotationId).lastInsertRowid);
  database.prepare("INSERT INTO sales_document_items (sales_document_id, name, quantity, created_at, updated_at) VALUES (?, '销售产品', 1, '2026-08-08', '2026-08-08')").run(salesId);
  const receiptId = Number(database
    .prepare("INSERT INTO sales_receipts (sales_document_id, received_at, amount_cents, payment_method, note, created_at, updated_at) VALUES (?, '2026-08-08', 100, '微信', '预付款', '2026-08-08', '2026-08-08')")
    .run(salesId).lastInsertRowid);
  database.prepare("INSERT INTO sales_receipt_files (receipt_id, relative_path, original_name, mime_type, size_bytes, created_at) VALUES (?, 'sales-receipt-proofs/receipt.png', 'receipt.png', 'image/png', 1, '2026-08-08')").run(receiptId);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('backup and restore', () => {
  it('creates a manifest, database snapshot, and attachment files, then restores them', async () => {
    const dataDirectory = await makeTemporaryDirectory();
    const database = openDatabase(join(dataDirectory, 'workbench.sqlite'));
    migrateDatabase(database);
    const productId = insertProduct(database, '原始产品');
    insertDocumentFixtures(database);
    database
      .prepare(
        `INSERT INTO product_images
          (product_id, relative_path, original_name, mime_type, size_bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(productId, 'product-images/original.png', '原始产品.png', 'image/png', 3, new Date().toISOString());

    const productDirectory = join(dataDirectory, 'files', 'product-images');
    const paymentDirectory = join(dataDirectory, 'files', 'payment-proofs');
    await mkdir(productDirectory, { recursive: true });
    await mkdir(paymentDirectory, { recursive: true });
    await writeFile(join(productDirectory, 'original.png'), Buffer.from('old'));
    await writeFile(join(paymentDirectory, 'payment.png'), Buffer.from('paid'));

    const service = createService(dataDirectory, database);
    const backup = await service.createBackup();
    const buffer = await readFile(backup.filePath);
    const manifest = await service.previewBackup(buffer);

    expect(manifest.formatVersion).toBe(1);
    expect(manifest.databaseFile).toBe('workbench.sqlite');
    expect(manifest.recordCounts.products).toBe(1);
    expect(manifest.recordCounts.product_images).toBe(1);
    expect(manifest.recordCounts.document_number_sequences).toBe(1);
    expect(manifest.recordCounts.quotations).toBe(1);
    expect(manifest.recordCounts.quotation_items).toBe(1);
    expect(manifest.recordCounts.quotation_custom_fields).toBe(1);
    expect(manifest.recordCounts.sales_documents).toBe(1);
    expect(manifest.recordCounts.sales_document_items).toBe(1);
    expect(manifest.recordCounts.sales_receipts).toBe(1);
    expect(manifest.recordCounts.sales_receipt_files).toBe(1);
    expect(manifest.attachments).toEqual([
      'files/payment-proofs/payment.png',
      'files/product-images/original.png',
    ]);

    insertProduct(database, '后来产品');
    await writeFile(join(productDirectory, 'original.png'), Buffer.from('changed'));
    await writeFile(join(productDirectory, 'later.png'), Buffer.from('later'));

    const result = await service.restoreBackup(buffer);
    expect(result.safetyBackup.fileName).toMatch(/^个人工作台备份-[0-9TZ]+\.zip$/);
    expect(database.prepare('SELECT COUNT(*) AS count FROM products').get()?.count).toBe(1);
    expect(database.prepare('SELECT name FROM products').get()?.name).toBe('原始产品');
    expect(database.prepare('SELECT COUNT(*) AS count FROM quotations').get()?.count).toBe(1);
    expect(database.prepare('SELECT COUNT(*) AS count FROM sales_documents').get()?.count).toBe(1);
    expect(database.prepare('SELECT COUNT(*) AS count FROM sales_receipt_files').get()?.count).toBe(1);
    await expect(readFile(join(productDirectory, 'original.png'))).resolves.toEqual(Buffer.from('old'));
    await expect(readFile(join(paymentDirectory, 'payment.png'))).resolves.toEqual(Buffer.from('paid'));
    await expect(readFile(join(productDirectory, 'later.png'))).rejects.toThrow();
    database.close();
    await new Promise((resolve) => setTimeout(resolve, 25));
  });

  it('rejects traversal paths and invalid manifests before touching current data', async () => {
    const dataDirectory = await makeTemporaryDirectory();
    const database = openDatabase(join(dataDirectory, 'workbench.sqlite'));
    migrateDatabase(database);
    insertProduct(database, '当前产品');
    const filesDirectory = join(dataDirectory, 'files', 'product-images');
    await mkdir(filesDirectory, { recursive: true });
    await writeFile(join(filesDirectory, 'current.png'), Buffer.from('current'));

    const service = createService(dataDirectory, database);
    const traversalZip = await makeZip([{ name: '../outside.txt', content: 'nope' }]);
    await expect(service.previewBackup(traversalZip)).rejects.toMatchObject<BackupError>({ code: 'INVALID_BACKUP' });
    await expect(service.restoreBackup(traversalZip)).rejects.toMatchObject<BackupError>({ code: 'INVALID_BACKUP' });

    const invalidManifestZip = await makeZip([
      {
        name: 'manifest.json',
        content: JSON.stringify({
          formatVersion: 1,
          createdAt: new Date().toISOString(),
          databaseFile: 'workbench.sqlite',
          recordCounts: {},
          attachments: ['files/../outside.txt'],
        }),
      },
    ]);
    await expect(service.previewBackup(invalidManifestZip)).rejects.toMatchObject<BackupError>({ code: 'INVALID_BACKUP' });

    expect(database.prepare('SELECT COUNT(*) AS count FROM products').get()?.count).toBe(1);
    await expect(readFile(join(filesDirectory, 'current.png'))).resolves.toEqual(Buffer.from('current'));
    database.close();
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
});
