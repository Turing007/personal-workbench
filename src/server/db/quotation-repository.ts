import type { DatabaseSync } from 'node:sqlite';
import type {
  CompanySnapshot,
  QuotationCustomField,
  QuotationDisplayConfig,
  QuotationItem,
  QuotationPriceTier,
  QuotationStatus,
  QuotationSummary,
} from '../../shared/documents.js';

export interface QuotationPersistenceItem {
  productId: number | null;
  customerProductId: number | null;
  isTemporary: boolean;
  name: string;
  sku: string;
  specification: string;
  parameters: string;
  packCount: number | null;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  priceTiers: QuotationPriceTier[];
  remark: string;
  imageRelativePath: string | null;
  imageOriginalName: string;
  sortOrder: number;
}

export interface QuotationPersistenceCustomField {
  placement: 'header' | 'footer';
  label: string;
  value: string;
  sortOrder: number;
}

export interface QuotationPersistenceInput {
  number: string;
  status: QuotationStatus;
  quotationDate: string;
  customerId: number | null;
  customerName: string;
  contactName: string;
  contactPhone: string;
  customerAddress: string;
  validUntil: string;
  remark: string;
  taxRateBps: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  companySnapshot: CompanySnapshot;
  displayConfig: QuotationDisplayConfig;
  items: readonly QuotationPersistenceItem[];
  customFields: readonly QuotationPersistenceCustomField[];
  customerProductsSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuotationListFilters {
  status?: QuotationStatus;
  query?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface QuotationListResult {
  rows: QuotationSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface QuotationRepositoryDetail extends QuotationSummary {
  customerAddress: string;
  validUntil: string;
  remark: string;
  taxRateBps: number;
  subtotalCents: number;
  taxCents: number;
  companySnapshot: CompanySnapshot;
  displayConfig: QuotationDisplayConfig;
  customerProductsSyncedAt: string | null;
  items: QuotationItem[];
  customFields: QuotationCustomField[];
  createdAt: string;
}

type SqlRow = Record<string, unknown>;

function rowValue(row: SqlRow, key: string, fallback = ''): string {
  return row[key] == null ? fallback : String(row[key]);
}

function numberValue(row: SqlRow, key: string, fallback = 0): number {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : fallback;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function lastInsertId(result: { lastInsertRowid: number | bigint }): number {
  return Number(result.lastInsertRowid);
}

function mapSummary(row: SqlRow): QuotationSummary {
  return {
    id: numberValue(row, 'id'),
    number: rowValue(row, 'number'),
    status: rowValue(row, 'status') as QuotationStatus,
    quotationDate: rowValue(row, 'quotation_date'),
    customerId: row.customer_id == null ? null : numberValue(row, 'customer_id'),
    customerName: rowValue(row, 'customer_name'),
    contactName: rowValue(row, 'contact_name'),
    contactPhone: rowValue(row, 'contact_phone'),
    totalCents: numberValue(row, 'total_cents'),
    updatedAt: rowValue(row, 'updated_at'),
  };
}

function parsePriceTiers(value: unknown): QuotationPriceTier[] {
  const parsed = parseJson<unknown>(value, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((tier): tier is QuotationPriceTier => {
    if (tier == null || typeof tier !== 'object') return false;
    const record = tier as Record<string, unknown>;
    return (
      Number.isFinite(Number(record.minQuantity)) &&
      (record.maxQuantity == null || Number.isFinite(Number(record.maxQuantity))) &&
      Number.isSafeInteger(Number(record.unitPriceCents)) &&
      Number(record.unitPriceCents) >= 0
    );
  }).map((tier) => ({
    minQuantity: Number(tier.minQuantity),
    maxQuantity: tier.maxQuantity == null ? null : Number(tier.maxQuantity),
    unitPriceCents: Number(tier.unitPriceCents),
  }));
}

function mapItem(row: SqlRow): QuotationItem {
  return {
    id: numberValue(row, 'id'),
    quotationId: numberValue(row, 'quotation_id'),
    productId: row.product_id == null ? null : numberValue(row, 'product_id'),
    customerProductId: row.customer_product_id == null ? null : numberValue(row, 'customer_product_id'),
    isTemporary: Boolean(numberValue(row, 'is_temporary')),
    name: rowValue(row, 'name'),
    sku: rowValue(row, 'sku'),
    specification: rowValue(row, 'specification'),
    parameters: rowValue(row, 'parameters'),
    packCount: row.pack_count == null ? null : numberValue(row, 'pack_count'),
    imageRelativePath: row.image_relative_path == null ? null : rowValue(row, 'image_relative_path'),
    quantity: numberValue(row, 'quantity'),
    unitPriceCents: numberValue(row, 'unit_price_cents'),
    amountCents: numberValue(row, 'amount_cents'),
    priceTiers: parsePriceTiers(row.tiered_prices_json),
    remark: rowValue(row, 'remark'),
    sortOrder: numberValue(row, 'sort_order'),
  };
}

function mapCustomField(row: SqlRow): QuotationCustomField {
  return {
    id: numberValue(row, 'id'),
    quotationId: numberValue(row, 'quotation_id'),
    placement: rowValue(row, 'placement') as 'header' | 'footer',
    label: rowValue(row, 'label'),
    value: rowValue(row, 'value'),
    sortOrder: numberValue(row, 'sort_order'),
  };
}

export class QuotationRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(filters: QuotationListFilters = {}): QuotationListResult {
    const page = Math.max(1, Math.trunc(filters.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Math.trunc(filters.pageSize ?? 50)));
    const values: Array<string | number> = [];
    const conditions: string[] = [];
    if (filters.status) {
      conditions.push('q.status = ?');
      values.push(filters.status);
    }
    const query = (filters.query ?? filters.q)?.trim();
    if (query) {
      const like = `%${query}%`;
      conditions.push(`(
        q.number LIKE ? OR q.customer_name LIKE ? OR q.contact_name LIKE ? OR q.contact_phone LIKE ? OR
        q.customer_address LIKE ? OR EXISTS (
          SELECT 1 FROM quotation_items qi WHERE qi.quotation_id = q.id AND
          (qi.name LIKE ? OR qi.sku LIKE ? OR qi.specification LIKE ?)
        )
      )`);
      values.push(like, like, like, like, like, like, like, like);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = Number(this.database.prepare(`SELECT COUNT(*) AS count FROM quotations q ${where}`).get(...values)?.count ?? 0);
    const rows = this.database
      .prepare(
        `SELECT q.id, q.number, q.status, q.quotation_date, q.customer_id, q.customer_name, q.contact_name,
          q.contact_phone, q.total_cents, q.updated_at
         FROM quotations q ${where}
         ORDER BY q.updated_at DESC, q.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...values, pageSize, (page - 1) * pageSize) as unknown as SqlRow[];
    return { rows: rows.map(mapSummary), total, page, pageSize };
  }

  get(id: number): QuotationRepositoryDetail | undefined {
    const row = this.database.prepare('SELECT * FROM quotations WHERE id = ?').get(id) as SqlRow | undefined;
    if (!row) return undefined;

    const summary = mapSummary(row);
    const items = this.database
      .prepare('SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order, id')
      .all(id) as unknown as SqlRow[];
    const customFields = this.database
      .prepare('SELECT * FROM quotation_custom_fields WHERE quotation_id = ? ORDER BY placement, sort_order, id')
      .all(id) as unknown as SqlRow[];

    return {
      ...summary,
      customerAddress: rowValue(row, 'customer_address'),
      validUntil: rowValue(row, 'valid_until'),
      remark: rowValue(row, 'remark'),
      taxRateBps: numberValue(row, 'tax_rate_bps'),
      subtotalCents: numberValue(row, 'subtotal_cents'),
      taxCents: numberValue(row, 'tax_cents'),
      customerProductsSyncedAt: row.customer_products_synced_at == null
        ? null
        : rowValue(row, 'customer_products_synced_at'),
      companySnapshot: parseJson<CompanySnapshot>(row.company_snapshot_json, {
        name: '', logoRelativePath: null, phone: '', address: '', defaultIssuer: '',
      }),
      displayConfig: parseJson<QuotationDisplayConfig>(row.display_config_json, {
        showLogo: false,
        showCompanyPhone: false,
        showCompanyAddress: false,
        showContactPhone: false,
        showTax: true,
        showTaxIncludedTotal: true,
        columns: { image: true, name: true, sku: true, specification: true, quantity: true, unitPrice: true, tierPrice: true, amount: false, remark: true },
      }),
      items: items.map(mapItem),
      customFields: customFields.map(mapCustomField),
      createdAt: rowValue(row, 'created_at'),
    };
  }

  insert(database: DatabaseSync, record: QuotationPersistenceInput): number {
    const quotationId = lastInsertId(database.prepare(
      `INSERT INTO quotations
        (number, status, quotation_date, customer_id, customer_name, contact_name, contact_phone, customer_address,
         valid_until, remark, tax_rate_bps, subtotal_cents, tax_cents, total_cents,
         customer_products_synced_at, company_snapshot_json, display_config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.number,
      record.status,
      record.quotationDate,
      record.customerId,
      record.customerName,
      record.contactName,
      record.contactPhone,
      record.customerAddress,
      record.validUntil,
      record.remark,
      record.taxRateBps,
      record.subtotalCents,
      record.taxCents,
      record.totalCents,
      record.customerProductsSyncedAt,
      JSON.stringify(record.companySnapshot),
      JSON.stringify(record.displayConfig),
      record.createdAt,
      record.updatedAt,
    ));
    this.writeChildren(database, quotationId, record);
    return quotationId;
  }

  replace(database: DatabaseSync, id: number, record: QuotationPersistenceInput): boolean {
    const result = database.prepare(
      `UPDATE quotations SET status = ?, quotation_date = ?, customer_id = ?, customer_name = ?, contact_name = ?, contact_phone = ?,
        customer_address = ?, valid_until = ?, remark = ?, tax_rate_bps = ?, subtotal_cents = ?, tax_cents = ?,
        total_cents = ?, customer_products_synced_at = ?, company_snapshot_json = ?, display_config_json = ?, updated_at = ? WHERE id = ?`,
    ).run(
      record.status,
      record.quotationDate,
      record.customerId,
      record.customerName,
      record.contactName,
      record.contactPhone,
      record.customerAddress,
      record.validUntil,
      record.remark,
      record.taxRateBps,
      record.subtotalCents,
      record.taxCents,
      record.totalCents,
      record.customerProductsSyncedAt,
      JSON.stringify(record.companySnapshot),
      JSON.stringify(record.displayConfig),
      record.updatedAt,
      id,
    );
    if (Number(result.changes ?? 0) === 0) return false;
    database.prepare('DELETE FROM quotation_items WHERE quotation_id = ?').run(id);
    database.prepare('DELETE FROM quotation_custom_fields WHERE quotation_id = ?').run(id);
    this.writeChildren(database, id, record);
    return true;
  }

  updateStatus(id: number, status: QuotationStatus): boolean {
    const result = this.database
      .prepare('UPDATE quotations SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id);
    return Number(result.changes ?? 0) > 0;
  }

  markCustomerProductsSynced(database: DatabaseSync, id: number, syncedAt: string): boolean {
    const result = database.prepare(
      'UPDATE quotations SET customer_products_synced_at = ?, updated_at = ? WHERE id = ?',
    ).run(syncedAt, syncedAt, id);
    return Number(result.changes ?? 0) > 0;
  }

  delete(id: number): boolean {
    const result = this.database.prepare('DELETE FROM quotations WHERE id = ?').run(id);
    return Number(result.changes ?? 0) > 0;
  }

  listImagePaths(id: number): string[] {
    return (this.database
      .prepare('SELECT image_relative_path FROM quotation_items WHERE quotation_id = ? AND image_relative_path IS NOT NULL')
      .all(id) as unknown as SqlRow[])
      .map((row) => rowValue(row, 'image_relative_path'))
      .filter(Boolean);
  }

  private writeChildren(database: DatabaseSync, quotationId: number, record: QuotationPersistenceInput): void {
    const timestamp = record.updatedAt;
    const insertItem = database.prepare(
      `INSERT INTO quotation_items
        (quotation_id, product_id, customer_product_id, is_temporary, name, sku, specification, parameters, pack_count,
         quantity, unit_price_cents, amount_cents, tiered_prices_json, remark, image_relative_path, image_original_name, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    record.items.forEach((item) => insertItem.run(
      quotationId,
      item.productId,
      item.customerProductId,
      item.isTemporary ? 1 : 0,
      item.name,
      item.sku,
      item.specification,
      item.parameters,
      item.packCount,
      item.quantity,
      item.unitPriceCents,
      item.amountCents,
      item.priceTiers.length ? JSON.stringify(item.priceTiers) : null,
      item.remark,
      item.imageRelativePath,
      item.imageOriginalName,
      item.sortOrder,
      timestamp,
      timestamp,
    ));

    const insertField = database.prepare(
      `INSERT INTO quotation_custom_fields (quotation_id, placement, label, value, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
    );
    record.customFields.forEach((field) => insertField.run(
      quotationId,
      field.placement,
      field.label,
      field.value,
      field.sortOrder,
    ));
  }
}
