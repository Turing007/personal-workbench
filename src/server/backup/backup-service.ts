import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import archiver from 'archiver';
import unzipper from 'unzipper';
import { openDatabase } from '../db/connection.js';
import { migrateDatabase } from '../db/migrate.js';

const BACKUP_FORMAT_VERSION = 1;
const DATABASE_ENTRY = 'workbench.sqlite';
const MANIFEST_ENTRY = 'manifest.json';
const ATTACHMENTS_ENTRY_PREFIX = 'files/';

const tableNames = [
  'customers',
  'products',
  'product_packaging',
  'product_purchase_quotes',
  'product_images',
  'product_packaging_images',
  'product_attachments',
  'customer_products',
  'customer_product_attachments',
  'orders',
  'order_source_types',
  'order_number_sequences',
  'order_items',
  'order_item_requirement_attachments',
  'order_item_box_sizes',
  'carton_labels',
  'carton_label_items',
  'payment_proofs',
  'order_finance',
  'finance_receipts',
  'finance_invoices',
  'finance_invoice_files',
  'order_contracts',
  'order_detail_images',
  'print_histories',
  'print_history_labels',
  'shipments',
  'shipment_batches',
  'shipment_batch_orders',
  'settings',
  'document_number_sequences',
  'quotations',
  'quotation_items',
  'quotation_custom_fields',
  'sales_documents',
  'sales_document_items',
  'sales_receipts',
  'sales_receipt_files',
] as const;

export interface BackupManifest {
  formatVersion: number;
  createdAt: string;
  databaseFile: string;
  recordCounts: Record<string, number>;
  attachments: string[];
}

export interface BackupFile {
  fileName: string;
  filePath: string;
  manifest: BackupManifest;
}

export class BackupError extends Error {
  constructor(public readonly code: 'INVALID_BACKUP' | 'BACKUP_FAILED' | 'RESTORE_FAILED', message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

interface BackupServiceOptions {
  database: DatabaseSync;
  databasePath: string;
  dataDirectory: string;
  backupsDirectory: string;
}

function assertSafeRelativePath(value: string, allowDirectory = false): string {
  const normalized = value.replaceAll('\\', '/');
  const directory = normalized.endsWith('/');
  const pathValue = directory ? normalized.slice(0, -1) : normalized;
  if (!pathValue || normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    throw new BackupError('INVALID_BACKUP', '备份包含不安全的文件路径');
  }
  const parts = pathValue.split('/');
  if (parts.includes('..') || parts.some((part) => !part || part === '.')) {
    throw new BackupError('INVALID_BACKUP', '备份包含不安全的文件路径');
  }
  if (directory && !allowDirectory) {
    throw new BackupError('INVALID_BACKUP', '备份清单包含目录路径');
  }
  return directory ? `${pathValue}/` : pathValue;
}

function assertWithin(root: string, target: string): void {
  const rootPath = resolve(root);
  const targetPath = resolve(target);
  const rootRelative = relative(rootPath, targetPath);
  if (isAbsolute(rootRelative) || rootRelative === '..' || rootRelative.startsWith(`..${sep}`)) {
    throw new BackupError('INVALID_BACKUP', '备份文件超出允许目录');
  }
}

function backupTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function createArchive(filePath: string, databaseSnapshot: string, filesDirectory: string, manifest: BackupManifest): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const archive = archiver('zip', { zlib: { level: 9 } });

    const writeStream = createWriteStream(filePath);
    const rejectOnce = (error: unknown) => rejectPromise(error instanceof Error ? error : new Error(String(error)));
    writeStream.on('close', () => resolvePromise());
    writeStream.on('error', rejectOnce);
    archive.on('error', rejectOnce);
    archive.pipe(writeStream);
    archive.append(JSON.stringify(manifest, null, 2), { name: MANIFEST_ENTRY });
    archive.file(databaseSnapshot, { name: DATABASE_ENTRY });
    archive.directory(filesDirectory, 'files');
    void archive.finalize().catch(rejectOnce);
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export class BackupService {
  private readonly database: DatabaseSync;
  private readonly databasePath: string;
  private readonly dataDirectory: string;
  private readonly backupsDirectory: string;

  constructor(options: BackupServiceOptions) {
    this.database = options.database;
    this.databasePath = resolve(options.databasePath);
    this.dataDirectory = resolve(options.dataDirectory);
    this.backupsDirectory = resolve(options.backupsDirectory);
  }

  async createBackup(fileNamePrefix = '个人工作台备份-', targetDirectory?: string): Promise<BackupFile> {
    const backupsDirectory = targetDirectory ? resolve(targetDirectory) : this.backupsDirectory;
    await mkdir(backupsDirectory, { recursive: true });
    const filesDirectory = join(this.dataDirectory, 'files');
    await mkdir(filesDirectory, { recursive: true });
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'personal-workbench-backup-'));
    const snapshotPath = join(temporaryDirectory, DATABASE_ENTRY);
    const createdAt = new Date().toISOString();
    const fileName = `${fileNamePrefix}${backupTimestamp(new Date(createdAt))}.zip`;
    const filePath = join(backupsDirectory, fileName);

    try {
      this.database.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      await copyFile(this.databasePath, snapshotPath);
      const recordCounts: Record<string, number> = {};
      for (const table of tableNames) {
        recordCounts[table] = Number(this.database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get()?.count ?? 0);
      }
      const attachments = await this.listAttachmentPaths(filesDirectory);
      const manifest: BackupManifest = {
        formatVersion: BACKUP_FORMAT_VERSION,
        createdAt,
        databaseFile: DATABASE_ENTRY,
        recordCounts,
        attachments,
      };
      await createArchive(filePath, snapshotPath, filesDirectory, manifest);
      return { fileName, filePath, manifest };
    } catch (error) {
      await rm(filePath, { force: true });
      throw new BackupError('BACKUP_FAILED', error instanceof Error ? error.message : '创建备份失败');
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async previewBackup(buffer: Buffer): Promise<BackupManifest> {
    const temporaryDirectory = await this.extractBackup(buffer);
    try {
      return await this.readManifest(temporaryDirectory);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async restoreBackup(buffer: Buffer): Promise<{ restoredAt: string; safetyBackup: BackupFile }> {
    const temporaryDirectory = await this.extractBackup(buffer);
    const extractedFiles = join(temporaryDirectory, 'files');
    const currentFiles = join(this.dataDirectory, 'files');
    const previousFiles = join(this.dataDirectory, `.files-before-restore-${randomUUID()}`);
    const restoredDatabase = join(temporaryDirectory, DATABASE_ENTRY);
    let filesMoved = false;

    try {
      const manifest = await this.readManifest(temporaryDirectory);
      if (!await pathExists(restoredDatabase)) throw new BackupError('INVALID_BACKUP', '备份中缺少数据库文件');
      // 旧备份可能缺少后续版本新增的客户字段等列，恢复前先迁移快照库，保证与当前主库列结构一致。
      // 清单记录数缺项也被允许（见 validateDatabase），因此旧备份仍可恢复。
      const restoredConnection = openDatabase(restoredDatabase);
      try { migrateDatabase(restoredConnection); } finally { restoredConnection.close(); }
      await this.validateDatabase(restoredDatabase, manifest);
      await this.validateAttachmentManifest(extractedFiles, manifest);
      const safetyBackup = await this.createBackup();
      await mkdir(extractedFiles, { recursive: true });
      await mkdir(this.dataDirectory, { recursive: true });

      if (await pathExists(currentFiles)) await rename(currentFiles, previousFiles);
      await rename(extractedFiles, currentFiles);
      filesMoved = true;

      await this.replaceDatabaseContents(restoredDatabase);
      // The database transaction has committed. From this point on, cleanup
      // must not throw and make the database/files pair look inconsistent.
      filesMoved = false;
      await rm(previousFiles, { recursive: true, force: true }).catch(() => undefined);
      return { restoredAt: new Date().toISOString(), safetyBackup };
    } catch (error) {
      if (filesMoved) {
        await rm(currentFiles, { recursive: true, force: true });
        if (await pathExists(previousFiles)) await rename(previousFiles, currentFiles);
      }
      if (error instanceof BackupError) throw error;
      throw new BackupError('RESTORE_FAILED', error instanceof Error ? error.message : '恢复备份失败');
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
      await rm(previousFiles, { recursive: true, force: true });
    }
  }

  async readBackupStream(filePath: string): Promise<NodeJS.ReadableStream> {
    assertWithin(this.backupsDirectory, filePath);
    return createReadStream(filePath);
  }

  private async listAttachmentPaths(filesDirectory: string): Promise<string[]> {
    if (!await pathExists(filesDirectory)) return [];

    const paths: string[] = [];
    const visit = async (directory: string, prefix: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const absolutePath = join(directory, entry.name);
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await visit(absolutePath, relativePath);
        } else if (entry.isFile()) {
          paths.push(`${ATTACHMENTS_ENTRY_PREFIX}${relativePath.replaceAll(sep, '/')}`);
        }
      }
    };

    await visit(filesDirectory, '');
    return paths.sort();
  }

  private async extractBackup(buffer: Buffer): Promise<string> {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'personal-workbench-restore-'));
    try {
      const archive = await unzipper.Open.buffer(buffer);
      const seenEntries = new Set<string>();
      for (const entry of archive.files) {
        const normalizedPath = entry.path.replaceAll('\\', '/');
        const isDirectory = normalizedPath.endsWith('/');
        const safePath = assertSafeRelativePath(normalizedPath, isDirectory);
        if (isDirectory) continue;
        if (seenEntries.has(safePath)) throw new BackupError('INVALID_BACKUP', `备份包含重复文件：${safePath}`);
        seenEntries.add(safePath);
        if (safePath !== MANIFEST_ENTRY && safePath !== DATABASE_ENTRY && !safePath.startsWith(ATTACHMENTS_ENTRY_PREFIX)) {
          throw new BackupError('INVALID_BACKUP', `备份包含不支持的文件：${safePath}`);
        }
        const target = join(temporaryDirectory, ...safePath.split('/'));
        assertWithin(temporaryDirectory, target);
        await mkdir(dirname(target), { recursive: true });
        await import('node:fs/promises').then(async ({ writeFile }) => writeFile(target, await entry.buffer()));
      }
      return temporaryDirectory;
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      if (error instanceof BackupError) throw error;
      throw new BackupError('INVALID_BACKUP', '备份文件无法读取');
    }
  }

  private async readManifest(directory: string): Promise<BackupManifest> {
    try {
      const parsed = JSON.parse(await readFile(join(directory, MANIFEST_ENTRY), 'utf8')) as Partial<BackupManifest>;
      if (
        parsed.formatVersion !== BACKUP_FORMAT_VERSION
        || parsed.databaseFile !== DATABASE_ENTRY
        || !Array.isArray(parsed.attachments)
        || !parsed.recordCounts
        || typeof parsed.recordCounts !== 'object'
        || Array.isArray(parsed.recordCounts)
        || typeof parsed.createdAt !== 'string'
        || Number.isNaN(Date.parse(parsed.createdAt))
      ) {
        throw new Error('备份版本或清单格式不支持');
      }
      const recordCounts = Object.fromEntries(
        Object.entries(parsed.recordCounts).map(([table, count]) => {
          if (!Number.isInteger(count) || Number(count) < 0) throw new Error('备份记录数量无效');
          return [table, Number(count)];
        }),
      );
      const attachments = parsed.attachments.map((item) => assertSafeRelativePath(String(item)));
      if (new Set(attachments).size !== attachments.length || attachments.some((item) => !item.startsWith(ATTACHMENTS_ENTRY_PREFIX))) {
        throw new Error('备份附件清单无效');
      }
      return {
        formatVersion: parsed.formatVersion,
        createdAt: parsed.createdAt,
        databaseFile: parsed.databaseFile,
        recordCounts,
        attachments,
      };
    } catch (error) {
      if (error instanceof BackupError) throw error;
      throw new BackupError('INVALID_BACKUP', '备份缺少有效的 manifest.json');
    }
  }

  private async validateDatabase(databasePath: string, manifest: BackupManifest): Promise<void> {
    const database = openDatabase(databasePath);
    try {
      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all()
        .map((row) => String(row.name));
      for (const table of tableNames) {
        if (!tables.includes(table)) throw new BackupError('INVALID_BACKUP', `备份数据库缺少表：${table}`);
      }
      for (const table of tableNames) {
        const expectedCount = manifest.recordCounts[table];
        // 兼容旧备份：清单可能缺少后来新增表（如 customers）的记录数，此时跳过计数校验。
        if (expectedCount === undefined) continue;
        const actualCount = Number(database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get()?.count ?? 0);
        if (actualCount !== expectedCount) throw new BackupError('INVALID_BACKUP', `备份记录数量校验失败：${table}`);
      }
    } finally {
      database.close();
    }
  }

  private async validateAttachmentManifest(filesDirectory: string, manifest: BackupManifest): Promise<void> {
    const actualAttachments = await this.listAttachmentPaths(filesDirectory);
    const expectedAttachments = [...manifest.attachments].sort();
    if (actualAttachments.length !== expectedAttachments.length || actualAttachments.some((path, index) => path !== expectedAttachments[index])) {
      throw new BackupError('INVALID_BACKUP', '备份附件清单与实际文件不一致');
    }
  }

  private async replaceDatabaseContents(restoredDatabase: string): Promise<void> {
    const attach = this.database.prepare('ATTACH DATABASE ? AS restored_backup');
    attach.run(restoredDatabase);
    try {
      this.database.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;');
      try {
        for (const table of tableNames) {
          this.database.exec(`DELETE FROM main."${table}";`);
          this.database.exec(`INSERT INTO main."${table}" SELECT * FROM restored_backup."${table}";`);
        }
        this.database.exec('COMMIT;');
      } catch (error) {
        try { this.database.exec('ROLLBACK;'); } catch { /* keep original failure */ }
        throw error;
      } finally {
        this.database.exec('PRAGMA foreign_keys = ON;');
      }
    } finally {
      this.database.exec('DETACH DATABASE restored_backup;');
    }
  }
}
