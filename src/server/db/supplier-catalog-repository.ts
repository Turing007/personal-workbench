import type { DatabaseSync } from 'node:sqlite';
import { withTransaction } from './connection.js';

export interface SupplierCatalogFileRecord {
  id: number;
  catalogId: number;
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface SupplierCatalogRecord {
  id: number;
  supplier: string;
  name: string;
  /** 收到日期（YYYY-MM-DD）。 */
  receivedAt: string;
  remark: string;
  createdAt: string;
  updatedAt: string;
  files: SupplierCatalogFileRecord[];
}

function mapCatalog(row: Record<string, unknown>): SupplierCatalogRecord {
  return {
    id: Number(row.id),
    supplier: String(row.supplier ?? ''),
    name: String(row.name ?? ''),
    receivedAt: String(row.received_at ?? ''),
    remark: String(row.remark ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    files: [],
  };
}

function mapFile(row: Record<string, unknown>): SupplierCatalogFileRecord {
  return {
    id: Number(row.id),
    catalogId: Number(row.catalog_id ?? 0),
    relativePath: String(row.relative_path ?? ''),
    originalName: String(row.original_name ?? ''),
    mimeType: String(row.mime_type ?? ''),
    size: Number(row.size_bytes ?? 0),
    createdAt: String(row.created_at ?? ''),
  };
}

/** 供应商产品图册：按供应商归档供应商发来的 PDF / 图片，仅登录用户可见。 */
export class SupplierCatalogRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(): SupplierCatalogRecord[] {
    const rows = this.database
      .prepare('SELECT * FROM supplier_catalogs ORDER BY received_at DESC, id DESC')
      .all() as Array<Record<string, unknown>>;
    const files = this.database
      .prepare('SELECT * FROM supplier_catalog_files ORDER BY catalog_id, sort_order, id')
      .all() as Array<Record<string, unknown>>;
    const byCatalog = new Map<number, SupplierCatalogFileRecord[]>();
    for (const row of files) {
      const file = mapFile(row);
      const list = byCatalog.get(file.catalogId);
      if (list) list.push(file);
      else byCatalog.set(file.catalogId, [file]);
    }
    return rows.map((row) => {
      const catalog = mapCatalog(row);
      return { ...catalog, files: byCatalog.get(catalog.id) ?? [] };
    });
  }

  get(id: number): SupplierCatalogRecord | undefined {
    const row = this.database.prepare('SELECT * FROM supplier_catalogs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const catalog = mapCatalog(row);
    const files = this.database
      .prepare('SELECT * FROM supplier_catalog_files WHERE catalog_id = ? ORDER BY sort_order, id')
      .all(id) as Array<Record<string, unknown>>;
    return { ...catalog, files: files.map(mapFile) };
  }

  create(input: { supplier: string; name: string; receivedAt: string; remark: string }): number {
    const now = new Date().toISOString();
    const result = this.database
      .prepare('INSERT INTO supplier_catalogs (supplier, name, received_at, remark, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(input.supplier, input.name, input.receivedAt, input.remark, now, now);
    return Number(result.lastInsertRowid);
  }

  update(id: number, changes: { supplier?: string; name?: string; receivedAt?: string; remark?: string }): boolean {
    const current = this.database.prepare('SELECT * FROM supplier_catalogs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!current) return false;
    const supplier = changes.supplier ?? String(current.supplier ?? '');
    const name = changes.name ?? String(current.name ?? '');
    const receivedAt = changes.receivedAt ?? String(current.received_at ?? '');
    const remark = changes.remark ?? String(current.remark ?? '');
    this.database
      .prepare('UPDATE supplier_catalogs SET supplier = ?, name = ?, received_at = ?, remark = ?, updated_at = ? WHERE id = ?')
      .run(supplier, name, receivedAt, remark, new Date().toISOString(), id);
    return true;
  }

  /** 删除整条记录（文件行由外键级联删除），返回需要从磁盘删除的附件路径。 */
  delete(id: number): string[] | undefined {
    if (!this.database.prepare('SELECT 1 FROM supplier_catalogs WHERE id = ?').get(id)) return undefined;
    return withTransaction(this.database, (database) => {
      const rows = database
        .prepare('SELECT relative_path FROM supplier_catalog_files WHERE catalog_id = ?')
        .all(id) as Array<{ relative_path?: unknown }>;
      database.prepare('DELETE FROM supplier_catalogs WHERE id = ?').run(id);
      return rows.map((row) => String(row.relative_path ?? '')).filter(Boolean);
    });
  }

  countFiles(id: number): number {
    return Number(this.database.prepare('SELECT COUNT(*) AS count FROM supplier_catalog_files WHERE catalog_id = ?').get(id)?.count ?? 0);
  }

  addFile(
    catalogId: number,
    file: { relativePath: string; originalName: string; mimeType: string; size: number },
  ): SupplierCatalogFileRecord {
    return withTransaction(this.database, (database) => {
      const nextOrder = Number(
        database.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM supplier_catalog_files WHERE catalog_id = ?').get(catalogId)?.next ?? 0,
      );
      const result = database
        .prepare('INSERT INTO supplier_catalog_files (catalog_id, relative_path, original_name, mime_type, size_bytes, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(catalogId, file.relativePath, file.originalName, file.mimeType, file.size, nextOrder, new Date().toISOString());
      database.prepare('UPDATE supplier_catalogs SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), catalogId);
      const row = database.prepare('SELECT * FROM supplier_catalog_files WHERE id = ?').get(Number(result.lastInsertRowid)) as Record<string, unknown>;
      return mapFile(row);
    });
  }

  deleteFile(catalogId: number, fileId: number): string | undefined {
    const row = this.database
      .prepare('SELECT relative_path FROM supplier_catalog_files WHERE id = ? AND catalog_id = ?')
      .get(fileId, catalogId) as { relative_path?: unknown } | undefined;
    if (!row) return undefined;
    this.database.prepare('DELETE FROM supplier_catalog_files WHERE id = ? AND catalog_id = ?').run(fileId, catalogId);
    this.database.prepare('UPDATE supplier_catalogs SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), catalogId);
    return String(row.relative_path ?? '');
  }
}
