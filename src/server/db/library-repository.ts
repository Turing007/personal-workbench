import type { DatabaseSync } from 'node:sqlite';
import { LIBRARY_CATEGORIES, type LibraryCategory, type LibrarySort } from '../../shared/library.js';

export interface LibraryFileRecord {
  id: number;
  title: string;
  category: LibraryCategory;
  customerId: number | null;
  customerName: string;
  tags: string[];
  note: string;
  originalName: string;
  relativePath: string;
  mimeType: string;
  size: number;
  contentHash: string;
  createdBy: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryListOptions {
  q?: string;
  category?: LibraryCategory;
  customerId?: number;
  sort?: LibrarySort;
  page?: number;
  pageSize?: number;
  trash?: boolean;
}

export interface LibraryListResult {
  items: LibraryFileRecord[];
  total: number;
  page: number;
  pageSize: number;
}

function parseTags(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function mapRow(row: Record<string, unknown>): LibraryFileRecord {
  const category = String(row.category ?? 'other') as LibraryCategory;
  return {
    id: Number(row.id),
    title: String(row.title ?? ''),
    category: (LIBRARY_CATEGORIES as readonly string[]).includes(category) ? category : 'other',
    customerId: row.customer_id == null ? null : Number(row.customer_id),
    customerName: String(row.customer_name ?? ''),
    tags: parseTags(row.tags),
    note: String(row.note ?? ''),
    originalName: String(row.original_name ?? ''),
    relativePath: String(row.relative_path ?? ''),
    mimeType: String(row.mime_type ?? ''),
    size: Number(row.size_bytes ?? 0),
    contentHash: String(row.content_hash ?? ''),
    createdBy: String(row.created_by ?? ''),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

const SELECT_WITH_CUSTOMER = `SELECT f.*, COALESCE(c.name, '') AS customer_name
  FROM library_files f
  LEFT JOIN customers c ON c.id = f.customer_id`;

/** 资料库文件：独立存放，不跟客户产品/订单附件混在一起。 */
export class LibraryRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(options: LibraryListOptions = {}): LibraryListResult {
    const where: string[] = [options.trash ? 'f.deleted_at IS NOT NULL' : 'f.deleted_at IS NULL'];
    const params: Array<string | number> = [];
    if (options.category) {
      where.push('f.category = ?');
      params.push(options.category);
    }
    if (options.customerId != null) {
      where.push('f.customer_id = ?');
      params.push(options.customerId);
    }
    const q = options.q?.trim();
    if (q) {
      const like = `%${q}%`;
      where.push('(f.title LIKE ? OR f.original_name LIKE ? OR f.note LIKE ? OR f.tags LIKE ? OR c.name LIKE ?)');
      params.push(like, like, like, like, like);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const total = Number(
      this.database
        .prepare(`SELECT COUNT(*) AS count FROM library_files f LEFT JOIN customers c ON c.id = f.customer_id ${whereSql}`)
        .get(...params)?.count ?? 0,
    );
    const sort = options.sort === 'name'
      ? 'f.title COLLATE NOCASE ASC, f.id DESC'
      : options.sort === 'size'
        ? 'f.size_bytes DESC, f.id DESC'
        : options.trash
          ? 'f.deleted_at DESC, f.id DESC'
          : 'f.updated_at DESC, f.id DESC';
    const page = Math.max(1, Math.trunc(options.page ?? 1));
    const pageSize = Math.min(500, Math.max(1, Math.trunc(options.pageSize ?? 200)));
    const rows = this.database
      .prepare(`${SELECT_WITH_CUSTOMER} ${whereSql} ORDER BY ${sort} LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>;
    return { items: rows.map(mapRow), total, page, pageSize };
  }

  get(id: number): LibraryFileRecord | undefined {
    const row = this.database
      .prepare(`${SELECT_WITH_CUSTOMER} WHERE f.id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapRow(row) : undefined;
  }

  findDuplicate(hash: string): { id: number; title: string } | undefined {
    if (!hash) return undefined;
    const row = this.database
      .prepare('SELECT id, title FROM library_files WHERE content_hash = ? AND deleted_at IS NULL ORDER BY id LIMIT 1')
      .get(hash) as { id?: unknown; title?: unknown } | undefined;
    return row ? { id: Number(row.id), title: String(row.title ?? '') } : undefined;
  }

  customerExists(customerId: number): boolean {
    return Boolean(this.database.prepare('SELECT 1 FROM customers WHERE id = ?').get(customerId));
  }

  create(input: {
    title: string;
    category: LibraryCategory;
    customerId: number | null;
    tags: string[];
    note: string;
    originalName: string;
    relativePath: string;
    mimeType: string;
    size: number;
    contentHash: string;
    createdBy: string;
  }): number {
    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        `INSERT INTO library_files
           (title, category, customer_id, tags, note, original_name, relative_path, mime_type, size_bytes, content_hash, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.title,
        input.category,
        input.customerId,
        JSON.stringify(input.tags),
        input.note,
        input.originalName,
        input.relativePath,
        input.mimeType,
        input.size,
        input.contentHash,
        input.createdBy,
        now,
        now,
      );
    return Number(result.lastInsertRowid);
  }

  update(id: number, changes: {
    title?: string;
    category?: LibraryCategory;
    customerId?: number | null;
    tags?: string[];
    note?: string;
  }): boolean {
    const current = this.get(id);
    if (!current) return false;
    const title = changes.title ?? current.title;
    const category = changes.category ?? current.category;
    const customerId = changes.customerId === undefined ? current.customerId : changes.customerId;
    const tags = changes.tags ?? current.tags;
    const note = changes.note ?? current.note;
    this.database
      .prepare('UPDATE library_files SET title = ?, category = ?, customer_id = ?, tags = ?, note = ?, updated_at = ? WHERE id = ?')
      .run(title, category, customerId, JSON.stringify(tags), note, new Date().toISOString(), id);
    return true;
  }

  softDelete(id: number): boolean {
    const now = new Date().toISOString();
    const result = this.database
      .prepare('UPDATE library_files SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(now, now, id);
    return Number(result.changes) > 0;
  }

  restore(id: number): boolean {
    const result = this.database
      .prepare('UPDATE library_files SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL')
      .run(new Date().toISOString(), id);
    return Number(result.changes) > 0;
  }

  /** 彻底删除一行，返回需要从磁盘删除的相对路径。 */
  purge(id: number): string | undefined {
    const row = this.database
      .prepare('SELECT relative_path FROM library_files WHERE id = ? AND deleted_at IS NOT NULL')
      .get(id) as { relative_path?: unknown } | undefined;
    if (!row) return undefined;
    this.database.prepare('DELETE FROM library_files WHERE id = ?').run(id);
    return String(row.relative_path ?? '');
  }

  /** 清理超过 30 天的回收站记录，返回文件路径交给 route 删盘。 */
  purgeExpired(days = 30): string[] {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.database
      .prepare('SELECT id, relative_path FROM library_files WHERE deleted_at IS NOT NULL AND deleted_at < ?')
      .all(cutoff) as Array<{ id?: unknown; relative_path?: unknown }>;
    if (!rows.length) return [];
    const deleteRow = this.database.prepare('DELETE FROM library_files WHERE id = ?');
    const paths: string[] = [];
    for (const row of rows) {
      deleteRow.run(Number(row.id));
      const path = String(row.relative_path ?? '');
      if (path) paths.push(path);
    }
    return paths;
  }
}
