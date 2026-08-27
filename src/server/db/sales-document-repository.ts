import type { DatabaseSync } from 'node:sqlite';
import type {
  CompanySnapshot,
  PaymentStatus,
  SalesDocumentDisplayConfig,
  SalesDocumentItem,
  SalesDocumentStatus,
  SalesDocumentSummary,
  SalesReceipt,
  SalesReceiptFile,
} from '../../shared/documents.js';

export interface SalesDocumentPersistenceItem {
  productId: number | null;
  customerProductId: number | null;
  isTemporary: boolean;
  productCode: string;
  name: string;
  sku: string;
  specification: string;
  parameters: string;
  packCount: number | null;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  remark: string;
  imageRelativePath: string | null;
  imageOriginalName: string;
  sortOrder: number;
}

export interface SalesDocumentPersistenceInput {
  number: string;
  sourceQuotationId: number | null;
  documentStatus: SalesDocumentStatus;
  paymentStatus: PaymentStatus;
  documentDate: string;
  customerId: number | null;
  customerName: string;
  contactName: string;
  contactPhone: string;
  customerAddress: string;
  purchaseOrderNo: string;
  issuer: string;
  consignee: string;
  remark: string;
  shippingCents: number;
  taxRateBps: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  receivedCents: number;
  outstandingCents: number;
  companySnapshot: CompanySnapshot;
  displayConfig: SalesDocumentDisplayConfig;
  items: readonly SalesDocumentPersistenceItem[];
  createdAt: string;
  updatedAt: string;
}

export interface SalesDocumentListFilters {
  documentStatus?: SalesDocumentStatus;
  paymentStatus?: PaymentStatus;
  query?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface SalesDocumentListResult {
  rows: SalesDocumentSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SalesDocumentRepositoryDetail extends SalesDocumentSummary {
  contactName: string;
  contactPhone: string;
  customerAddress: string;
  shippingCents: number;
  subtotalCents: number;
  taxRateBps: number;
  taxCents: number;
  receivedCents: number;
  issuer: string;
  consignee: string;
  remark: string;
  companySnapshot: CompanySnapshot;
  displayConfig: SalesDocumentDisplayConfig;
  sourceQuotationId: number | null;
  items: SalesDocumentRepositoryItem[];
  receipts: SalesReceipt[];
  createdAt: string;
}

export interface SalesDocumentRepositoryItem extends SalesDocumentItem {
  productCode: string;
  imageOriginalName: string;
}

export interface SalesReceiptPersistenceInput {
  salesDocumentId: number;
  receivedAt: string;
  amountCents: number;
  paymentMethod: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface SalesReceiptFilePersistenceInput {
  receiptId: number;
  relativePath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

type SqlRow = Record<string, unknown>;

const DEFAULT_COMPANY: CompanySnapshot = {
  name: '',
  logoRelativePath: null,
  phone: '',
  address: '',
  defaultIssuer: '',
};

const DEFAULT_DISPLAY: SalesDocumentDisplayConfig = {
  showLogo: false,
  showCompanyPhone: false,
  showCompanyAddress: false,
  showProductImages: false,
  columns: {
    productCode: true,
    productName: true,
    specification: true,
    quantity: true,
    unitPrice: true,
    amount: true,
    remark: true,
  },
};

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

function mapSummary(row: SqlRow): SalesDocumentSummary {
  return {
    id: numberValue(row, 'id'),
    number: rowValue(row, 'number'),
    documentStatus: rowValue(row, 'document_status') as SalesDocumentStatus,
    paymentStatus: rowValue(row, 'payment_status') as PaymentStatus,
    documentDate: rowValue(row, 'document_date'),
    customerId: row.customer_id == null ? null : numberValue(row, 'customer_id'),
    customerName: rowValue(row, 'customer_name'),
    purchaseOrderNo: rowValue(row, 'purchase_order_no'),
    totalCents: numberValue(row, 'total_cents'),
    outstandingCents: numberValue(row, 'outstanding_cents'),
    updatedAt: rowValue(row, 'updated_at'),
    generatedOrderId: row.generated_order_id == null ? null : numberValue(row, 'generated_order_id'),
    generatedOrderNo: row.generated_order_no == null ? null : rowValue(row, 'generated_order_no'),
  };
}

function mapItem(row: SqlRow): SalesDocumentRepositoryItem {
  return {
    id: numberValue(row, 'id'),
    salesDocumentId: numberValue(row, 'sales_document_id'),
    productId: row.product_id == null ? null : numberValue(row, 'product_id'),
    customerProductId: row.customer_product_id == null ? null : numberValue(row, 'customer_product_id'),
    isTemporary: Boolean(numberValue(row, 'is_temporary')),
    productCode: rowValue(row, 'product_code'),
    name: rowValue(row, 'name'),
    sku: rowValue(row, 'sku'),
    specification: rowValue(row, 'specification'),
    parameters: rowValue(row, 'parameters'),
    packCount: row.pack_count == null ? null : numberValue(row, 'pack_count'),
    imageRelativePath: row.image_relative_path == null ? null : rowValue(row, 'image_relative_path'),
    imageOriginalName: rowValue(row, 'image_original_name'),
    quantity: numberValue(row, 'quantity'),
    unitPriceCents: numberValue(row, 'unit_price_cents'),
    amountCents: numberValue(row, 'amount_cents'),
    remark: rowValue(row, 'remark'),
    sortOrder: numberValue(row, 'sort_order'),
  };
}

function mapReceiptFile(row: SqlRow): SalesReceiptFile {
  return {
    id: numberValue(row, 'id'),
    receiptId: numberValue(row, 'receipt_id'),
    relativePath: rowValue(row, 'relative_path'),
    originalName: rowValue(row, 'original_name'),
    mimeType: rowValue(row, 'mime_type'),
    sizeBytes: numberValue(row, 'size_bytes'),
    createdAt: rowValue(row, 'created_at'),
  };
}

function mapReceipt(row: SqlRow, files: SalesReceiptFile[] = []): SalesReceipt {
  return {
    id: numberValue(row, 'id'),
    salesDocumentId: numberValue(row, 'sales_document_id'),
    receivedAt: rowValue(row, 'received_at'),
    amountCents: numberValue(row, 'amount_cents'),
    paymentMethod: rowValue(row, 'payment_method'),
    note: rowValue(row, 'note'),
    files,
    createdAt: rowValue(row, 'created_at'),
  };
}

export class SalesDocumentRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(filters: SalesDocumentListFilters = {}): SalesDocumentListResult {
    const page = Math.max(1, Math.trunc(filters.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Math.trunc(filters.pageSize ?? 50)));
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    if (filters.documentStatus) {
      conditions.push('s.document_status = ?');
      values.push(filters.documentStatus);
    }
    if (filters.paymentStatus) {
      conditions.push('s.payment_status = ?');
      values.push(filters.paymentStatus);
    }
    const query = (filters.query ?? filters.q)?.trim();
    if (query) {
      const like = `%${query}%`;
      conditions.push(`(
        s.number LIKE ? OR s.customer_name LIKE ? OR s.contact_name LIKE ? OR s.contact_phone LIKE ? OR
        s.address LIKE ? OR s.purchase_order_no LIKE ? OR EXISTS (
          SELECT 1 FROM sales_document_items si WHERE si.sales_document_id = s.id AND
          (si.product_code LIKE ? OR si.name LIKE ? OR si.sku LIKE ? OR si.specification LIKE ?)
        )
      )`);
      values.push(like, like, like, like, like, like, like, like, like, like);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = Number(this.database.prepare(`SELECT COUNT(*) AS count FROM sales_documents s ${where}`).get(...values)?.count ?? 0);
    const rows = this.database.prepare(
      `SELECT s.id, s.number, s.document_status, s.payment_status, s.document_date, s.customer_id, s.customer_name,
        s.purchase_order_no, s.total_cents, s.outstanding_cents, s.updated_at,
        o.id AS generated_order_id, o.order_no AS generated_order_no
       FROM sales_documents s
       LEFT JOIN orders o ON o.source_sales_document_id = s.id
       ${where}
       ORDER BY s.updated_at DESC, s.id DESC LIMIT ? OFFSET ?`,
    ).all(...values, pageSize, (page - 1) * pageSize) as unknown as SqlRow[];
    return { rows: rows.map(mapSummary), total, page, pageSize };
  }

  findGeneratedOrder(salesDocumentId: number): { id: number; orderNo: string } | undefined {
    const row = this.database.prepare(
      'SELECT id, order_no FROM orders WHERE source_sales_document_id = ?',
    ).get(salesDocumentId) as SqlRow | undefined;
    if (!row) return undefined;
    return { id: numberValue(row, 'id'), orderNo: rowValue(row, 'order_no') };
  }

  get(id: number): SalesDocumentRepositoryDetail | undefined {
    const row = this.database.prepare('SELECT * FROM sales_documents WHERE id = ?').get(id) as SqlRow | undefined;
    if (!row) return undefined;
    const items = this.database.prepare(
      'SELECT * FROM sales_document_items WHERE sales_document_id = ? ORDER BY sort_order, id',
    ).all(id) as unknown as SqlRow[];
    const receiptRows = this.database.prepare(
      'SELECT * FROM sales_receipts WHERE sales_document_id = ? ORDER BY received_at, id',
    ).all(id) as unknown as SqlRow[];
    const receipts = receiptRows.map((receiptRow) => {
      const receiptId = numberValue(receiptRow, 'id');
      const files = this.database.prepare(
        'SELECT * FROM sales_receipt_files WHERE receipt_id = ? ORDER BY created_at, id',
      ).all(receiptId) as unknown as SqlRow[];
      return mapReceipt(receiptRow, files.map(mapReceiptFile));
    });
    return {
      ...mapSummary(row),
      contactName: rowValue(row, 'contact_name'),
      contactPhone: rowValue(row, 'contact_phone'),
      customerAddress: rowValue(row, 'address'),
      shippingCents: numberValue(row, 'shipping_cents'),
      subtotalCents: numberValue(row, 'subtotal_cents'),
      taxRateBps: numberValue(row, 'tax_rate_bps'),
      taxCents: numberValue(row, 'tax_cents'),
      receivedCents: numberValue(row, 'received_cents'),
      issuer: rowValue(row, 'issuer'),
      consignee: rowValue(row, 'recipient'),
      remark: rowValue(row, 'remark'),
      companySnapshot: parseJson(row.company_snapshot_json, DEFAULT_COMPANY),
      displayConfig: parseJson(row.display_config_json, DEFAULT_DISPLAY),
      sourceQuotationId: row.source_quotation_id == null ? null : numberValue(row, 'source_quotation_id'),
      items: items.map(mapItem),
      receipts,
      createdAt: rowValue(row, 'created_at'),
    };
  }

  insert(database: DatabaseSync, record: SalesDocumentPersistenceInput): number {
    const id = lastInsertId(database.prepare(
      `INSERT INTO sales_documents
        (number, customer_id, source_quotation_id, document_status, payment_status, document_date, customer_name,
         contact_name, contact_phone, address, purchase_order_no, issuer, recipient, remark, shipping_cents,
         tax_rate_bps, subtotal_cents, tax_cents, total_cents, received_cents, outstanding_cents,
         company_snapshot_json, display_config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.number, record.customerId, record.sourceQuotationId, record.documentStatus, record.paymentStatus, record.documentDate,
      record.customerName, record.contactName, record.contactPhone, record.customerAddress,
      record.purchaseOrderNo, record.issuer, record.consignee, record.remark, record.shippingCents,
      record.taxRateBps, record.subtotalCents, record.taxCents, record.totalCents, record.receivedCents,
      record.outstandingCents, JSON.stringify(record.companySnapshot), JSON.stringify(record.displayConfig),
      record.createdAt, record.updatedAt,
    ));
    this.writeItems(database, id, record);
    return id;
  }

  replace(database: DatabaseSync, id: number, record: SalesDocumentPersistenceInput): boolean {
    const result = database.prepare(
      `UPDATE sales_documents SET document_status = ?, payment_status = ?, document_date = ?, customer_id = ?, customer_name = ?,
        contact_name = ?, contact_phone = ?, address = ?, purchase_order_no = ?, issuer = ?, recipient = ?,
        remark = ?, shipping_cents = ?, tax_rate_bps = ?, subtotal_cents = ?, tax_cents = ?, total_cents = ?,
        received_cents = ?, outstanding_cents = ?, company_snapshot_json = ?, display_config_json = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      record.documentStatus, record.paymentStatus, record.documentDate, record.customerId, record.customerName, record.contactName,
      record.contactPhone, record.customerAddress, record.purchaseOrderNo, record.issuer, record.consignee,
      record.remark, record.shippingCents, record.taxRateBps, record.subtotalCents, record.taxCents,
      record.totalCents, record.receivedCents, record.outstandingCents, JSON.stringify(record.companySnapshot),
      JSON.stringify(record.displayConfig), record.updatedAt, id,
    );
    if (Number(result.changes ?? 0) === 0) return false;
    database.prepare('DELETE FROM sales_document_items WHERE sales_document_id = ?').run(id);
    this.writeItems(database, id, record);
    return true;
  }

  updateStatus(id: number, status: SalesDocumentStatus, updatedAt: string): boolean {
    const result = this.database.prepare(
      'UPDATE sales_documents SET document_status = ?, updated_at = ? WHERE id = ?',
    ).run(status, updatedAt, id);
    return Number(result.changes ?? 0) > 0;
  }

  delete(id: number): boolean {
    const result = this.database.prepare('DELETE FROM sales_documents WHERE id = ?').run(id);
    return Number(result.changes ?? 0) > 0;
  }

  getReceipt(id: number): SalesReceipt | undefined {
    const row = this.database.prepare('SELECT * FROM sales_receipts WHERE id = ?').get(id) as SqlRow | undefined;
    if (!row) return undefined;
    const files = this.database.prepare(
      'SELECT * FROM sales_receipt_files WHERE receipt_id = ? ORDER BY created_at, id',
    ).all(id) as unknown as SqlRow[];
    return mapReceipt(row, files.map(mapReceiptFile));
  }

  insertReceipt(database: DatabaseSync, input: SalesReceiptPersistenceInput): number {
    return lastInsertId(database.prepare(
      `INSERT INTO sales_receipts
        (sales_document_id, received_at, amount_cents, payment_method, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.salesDocumentId, input.receivedAt, input.amountCents, input.paymentMethod, input.note,
      input.createdAt, input.updatedAt,
    ));
  }

  updateReceipt(database: DatabaseSync, id: number, input: SalesReceiptPersistenceInput): boolean {
    const result = database.prepare(
      `UPDATE sales_receipts SET received_at = ?, amount_cents = ?, payment_method = ?, note = ?, updated_at = ?
       WHERE id = ?`,
    ).run(input.receivedAt, input.amountCents, input.paymentMethod, input.note, input.updatedAt, id);
    return Number(result.changes ?? 0) > 0;
  }

  deleteReceipt(database: DatabaseSync, id: number): boolean {
    const result = database.prepare('DELETE FROM sales_receipts WHERE id = ?').run(id);
    return Number(result.changes ?? 0) > 0;
  }

  sumReceipts(database: DatabaseSync, salesDocumentId: number): number {
    return Number(database.prepare(
      'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM sales_receipts WHERE sales_document_id = ?',
    ).get(salesDocumentId)?.total ?? 0);
  }

  updatePaymentTotals(
    database: DatabaseSync,
    id: number,
    receivedCents: number,
    outstandingCents: number,
    paymentStatus: PaymentStatus,
    updatedAt: string,
  ): boolean {
    const result = database.prepare(
      `UPDATE sales_documents SET received_cents = ?, outstanding_cents = ?, payment_status = ?, updated_at = ?
       WHERE id = ?`,
    ).run(receivedCents, outstandingCents, paymentStatus, updatedAt, id);
    return Number(result.changes ?? 0) > 0;
  }

  getReceiptFile(id: number): SalesReceiptFile | undefined {
    const row = this.database.prepare('SELECT * FROM sales_receipt_files WHERE id = ?').get(id) as SqlRow | undefined;
    return row ? mapReceiptFile(row) : undefined;
  }

  insertReceiptFile(database: DatabaseSync, input: SalesReceiptFilePersistenceInput): number {
    return lastInsertId(database.prepare(
      `INSERT INTO sales_receipt_files
        (receipt_id, relative_path, original_name, mime_type, size_bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      input.receiptId, input.relativePath, input.originalName, input.mimeType, input.sizeBytes, input.createdAt,
    ));
  }

  deleteReceiptFile(database: DatabaseSync, id: number): boolean {
    const result = database.prepare('DELETE FROM sales_receipt_files WHERE id = ?').run(id);
    return Number(result.changes ?? 0) > 0;
  }

  listDocumentFilePaths(id: number): string[] {
    const itemPaths = this.database.prepare(
      `SELECT image_relative_path AS relative_path FROM sales_document_items
       WHERE sales_document_id = ? AND image_relative_path IS NOT NULL`,
    ).all(id) as unknown as SqlRow[];
    const receiptPaths = this.database.prepare(
      `SELECT f.relative_path FROM sales_receipt_files f
       JOIN sales_receipts r ON r.id = f.receipt_id WHERE r.sales_document_id = ?`,
    ).all(id) as unknown as SqlRow[];
    return [...itemPaths, ...receiptPaths].map((row) => rowValue(row, 'relative_path')).filter(Boolean);
  }

  private writeItems(database: DatabaseSync, salesDocumentId: number, record: SalesDocumentPersistenceInput): void {
    const insert = database.prepare(
      `INSERT INTO sales_document_items
        (sales_document_id, product_id, customer_product_id, is_temporary, product_code, name, sku, specification, parameters, pack_count, quantity,
         unit_price_cents, amount_cents, remark, image_relative_path, image_original_name, sort_order,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    record.items.forEach((item) => insert.run(
      salesDocumentId, item.productId, item.customerProductId, item.isTemporary ? 1 : 0, item.productCode, item.name, item.sku,
      item.specification, item.parameters, item.packCount, item.quantity, item.unitPriceCents, item.amountCents, item.remark,
      item.imageRelativePath, item.imageOriginalName, item.sortOrder, record.updatedAt, record.updatedAt,
    ));
  }
}
