import type { DatabaseSync } from 'node:sqlite';
import { withTransaction } from './connection.js';

export interface CatalogRecord {
  id: number;
  token: string;
  name: string;
  enabled: boolean;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogSummaryRecord extends CatalogRecord {
  itemCount: number;
}

function mapCatalog(row: Record<string, unknown> | undefined): CatalogRecord | undefined {
  if (!row) return undefined;
  return {
    id: Number(row.id),
    token: String(row.token),
    name: String(row.name),
    enabled: Number(row.enabled ?? 1) === 1,
    viewCount: Number(row.view_count ?? 0),
    lastViewedAt: row.last_viewed_at == null ? null : String(row.last_viewed_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/** 产品图册（在线链接版）：一本 = 名称 + 随机 token + 有序选品。 */
export class CatalogRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(): CatalogSummaryRecord[] {
    const rows = this.database
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM catalog_items i WHERE i.catalog_id = c.id) AS item_count
         FROM catalogs c ORDER BY c.id DESC`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.flatMap((row) => {
      const catalog = mapCatalog(row);
      return catalog ? [{ ...catalog, itemCount: Number(row.item_count ?? 0) }] : [];
    });
  }

  get(id: number): CatalogRecord | undefined {
    return mapCatalog(this.database.prepare('SELECT * FROM catalogs WHERE id = ?').get(id) as Record<string, unknown> | undefined);
  }

  getByToken(token: string): CatalogRecord | undefined {
    return mapCatalog(this.database.prepare('SELECT * FROM catalogs WHERE token = ?').get(token) as Record<string, unknown> | undefined);
  }

  create(input: { token: string; name: string; productIds: number[] }): number {
    const now = new Date().toISOString();
    return withTransaction(this.database, (database) => {
      const result = database
        .prepare('INSERT INTO catalogs (token, name, enabled, view_count, created_at, updated_at) VALUES (?, ?, 1, 0, ?, ?)')
        .run(input.token, input.name, now, now);
      const id = Number(result.lastInsertRowid);
      const insertItem = database.prepare('INSERT OR IGNORE INTO catalog_items (catalog_id, product_id, sort_order) VALUES (?, ?, ?)');
      input.productIds.forEach((productId, index) => insertItem.run(id, productId, index));
      return id;
    });
  }

  update(id: number, changes: { name?: string; enabled?: boolean; productIds?: number[] }): void {
    const now = new Date().toISOString();
    withTransaction(this.database, (database) => {
      const current = database.prepare('SELECT * FROM catalogs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (!current) return;
      const name = changes.name ?? String(current.name);
      const enabled = changes.enabled === undefined ? Number(current.enabled ?? 1) === 1 : changes.enabled;
      database
        .prepare('UPDATE catalogs SET name = ?, enabled = ?, updated_at = ? WHERE id = ?')
        .run(name, enabled ? 1 : 0, now, id);
      if (changes.productIds !== undefined) {
        database.prepare('DELETE FROM catalog_items WHERE catalog_id = ?').run(id);
        const insertItem = database.prepare('INSERT OR IGNORE INTO catalog_items (catalog_id, product_id, sort_order) VALUES (?, ?, ?)');
        changes.productIds.forEach((productId, index) => insertItem.run(id, productId, index));
      }
    });
  }

  delete(id: number): void {
    this.database.prepare('DELETE FROM catalogs WHERE id = ?').run(id);
  }

  listItemProductIds(id: number): number[] {
    const rows = this.database
      .prepare('SELECT product_id FROM catalog_items WHERE catalog_id = ? ORDER BY sort_order, product_id')
      .all(id) as Array<{ product_id: number }>;
    return rows.map((row) => Number(row.product_id));
  }

  recordView(id: number): void {
    this.database
      .prepare('UPDATE catalogs SET view_count = view_count + 1, last_viewed_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }
}
