import type { DatabaseSync } from 'node:sqlite';
import type {
  StockConfirmation,
  StockConfirmationItem,
  StockConfirmationOrder,
} from '../../shared/stock.js';

type SqlRow = Record<string, unknown>;

export interface StockConfirmationInsert {
  supplier: string;
  scope: string;
  channel: string;
  confirmedAt: string;
  confirmedBy: string;
  note: string;
  itemCount: number;
  totalQuantity: number;
  detailJson: string;
  createdAt: string;
}

export interface StockConfirmationFilters {
  scope?: string;
  channel?: string;
  supplier?: string;
  limit?: number;
}

export interface StockConfirmationBadge {
  confirmedAt: string;
  confirmedBy: string;
  orderCount: number;
}

function stringValue(row: SqlRow, key: string): string {
  const value = row[key];
  return value === null || value === undefined ? '' : String(value);
}

function numberValue(row: SqlRow, key: string): number {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}

function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function parseDetail(value: unknown): { orders: StockConfirmationOrder[]; items: StockConfirmationItem[] } {
  let parsed: Record<string, unknown> = {};
  if (typeof value === 'string' && value.trim()) {
    try {
      const candidate: unknown = JSON.parse(value);
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        parsed = candidate as Record<string, unknown>;
      }
    } catch {
      parsed = {};
    }
  }
  const orders = objectArray(parsed.orders).map((order) => ({
    orderId: numberValue(order, 'orderId'),
    orderNo: stringValue(order, 'orderNo'),
    advanced: Boolean(order.advanced),
  }));
  const items = objectArray(parsed.items).map((item) => ({
    displayName: stringValue(item, 'displayName'),
    quantity: numberValue(item, 'quantity'),
    specs: objectArray(item.specs).map((spec) => ({
      specification: stringValue(spec, 'specification'),
      quantity: numberValue(spec, 'quantity'),
    })),
  }));
  return { orders, items };
}

function mapRow(row: SqlRow): StockConfirmation {
  const detail = parseDetail(row.detail_json);
  return {
    id: numberValue(row, 'id'),
    supplier: stringValue(row, 'supplier'),
    scope: stringValue(row, 'scope'),
    channel: stringValue(row, 'channel'),
    confirmedAt: stringValue(row, 'confirmed_at'),
    confirmedBy: stringValue(row, 'confirmed_by'),
    note: stringValue(row, 'note'),
    itemCount: numberValue(row, 'item_count'),
    totalQuantity: numberValue(row, 'total_quantity'),
    orders: detail.orders,
    items: detail.items,
  };
}

/** 供应商备货确认记录：只追加，用于备货表卡片提示和确认历史。 */
export class StockConfirmationRepository {
  constructor(private readonly database: DatabaseSync) {}

  insert(input: StockConfirmationInsert): number {
    const result = this.database.prepare(`
      INSERT INTO stock_confirmations
        (supplier, scope, channel, confirmed_at, confirmed_by, note,
         item_count, total_quantity, detail_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.supplier,
      input.scope,
      input.channel,
      input.confirmedAt,
      input.confirmedBy,
      input.note,
      input.itemCount,
      input.totalQuantity,
      input.detailJson,
      input.createdAt,
    );
    return Number(result.lastInsertRowid);
  }

  list(filters: StockConfirmationFilters = {}): StockConfirmation[] {
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];
    if (filters.scope) {
      clauses.push('scope = ?');
      parameters.push(filters.scope);
    }
    if (filters.channel !== undefined) {
      clauses.push('channel = ?');
      parameters.push(filters.channel);
    }
    if (filters.supplier) {
      clauses.push('supplier = ?');
      parameters.push(filters.supplier);
    }
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 50), 1), 200);
    parameters.push(limit);
    const rows = this.database.prepare(`
      SELECT * FROM stock_confirmations
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY confirmed_at DESC, id DESC
      LIMIT ?
    `).all(...parameters) as SqlRow[];
    return rows.map(mapRow);
  }

  /** 某筛选范围内每个供应商最近一次确认，用于备货表卡片提示。 */
  latestBySupplier(scope: string, channel: string): Map<string, StockConfirmationBadge> {
    const rows = this.database.prepare(`
      SELECT supplier, confirmed_at, confirmed_by, detail_json
      FROM stock_confirmations
      WHERE scope = ? AND channel = ?
      ORDER BY confirmed_at DESC, id DESC
    `).all(scope, channel) as SqlRow[];
    const result = new Map<string, StockConfirmationBadge>();
    for (const row of rows) {
      const supplier = stringValue(row, 'supplier');
      if (!supplier || result.has(supplier)) continue;
      const detail = parseDetail(row.detail_json);
      result.set(supplier, {
        confirmedAt: stringValue(row, 'confirmed_at'),
        confirmedBy: stringValue(row, 'confirmed_by'),
        orderCount: detail.orders.length,
      });
    }
    return result;
  }
}
