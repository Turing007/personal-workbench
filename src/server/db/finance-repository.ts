import type { DatabaseSync } from 'node:sqlite';
import { withTransaction } from './connection.js';
import {
  calculateOutstandingCents,
  deriveFinancePaymentStatus,
  deriveInvoiceStatus,
  deriveProofStatus,
  type FinanceInvoice,
  type FinanceInvoiceFile,
  type FinanceListFilters,
  type FinanceListResult,
  type FinanceListRow,
  type FinanceListStats,
  type FinanceOrderLookupRow,
  type FinanceProofListFilters,
  type FinanceProofListRow,
  type FinanceReceipt,
  type OrderFinanceSummary,
  type PayeeBreakdownRow,
  type PaymentProofRecord,
  type PaymentProofStatus,
  type InvoiceStatus,
} from '../../shared/finance.js';
import type { CompanyReceiptBreakdownRow, CompanyStatsRow } from '../../shared/companies.js';
import { UNASSIGNED_COMPANY_NAME } from '../../shared/companies.js';

interface SqlRow { [key: string]: unknown }

export interface PaymentProofPersistenceInput {
  paymentDate: string | null;
  amountCents: number | null;
  paymentMethod: string;
  payerName: string;
  transactionNo: string;
  note: string;
}

export interface FinanceInvoicePersistenceInput {
  orderId: number;
  status: Exclude<InvoiceStatus, 'not_requested'>;
  invoiceType: string;
  title: string;
  taxNo: string;
  recipientEmail: string;
  recipientAddress: string;
  amountCents: number;
  taxRateBps: number;
  taxCents: number;
  invoiceCode: string;
  invoiceNo: string;
  issuedAt: string | null;
  sentAt: string | null;
  voidedAt: string | null;
  remark: string;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceInvoiceFilePersistenceInput {
  invoiceId: number;
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface FinanceReceiptPersistenceInput {
  orderId: number;
  paymentProofId: number;
  receivedAt: string;
  amountCents: number;
  paymentMethod: string;
  payeeName: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceOrderDetail {
  order: SqlRow;
  finance: OrderFinanceSummary;
  proofs: PaymentProofRecord[];
  receipts: FinanceReceipt[];
  invoices: FinanceInvoice[];
}

function numberValue(row: SqlRow, key: string, fallback = 0): number {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : fallback;
}

function stringValue(row: SqlRow, key: string, fallback = ''): string {
  return row[key] == null ? fallback : String(row[key]);
}

function nullableString(row: SqlRow, key: string): string | null {
  return row[key] == null ? null : String(row[key]);
}

function lastInsertId(result: { lastInsertRowid: number | bigint }): number {
  return Number(result.lastInsertRowid);
}

/** “4,820”“¥4820”“4820.00”都能当作金额查询；纯数字订单号也会同时作为金额尝试，不会影响订单号命中。 */
function parseLookupAmountCents(value: string): number | null {
  const normalized = value.replace(/[¥￥,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

function mapFinance(row: SqlRow | undefined): OrderFinanceSummary | undefined {
  if (!row) return undefined;
  return {
    id: numberValue(row, 'id'),
    orderId: numberValue(row, 'order_id'),
    receivableCents: numberValue(row, 'receivable_cents'),
    receivedCents: numberValue(row, 'received_cents'),
    outstandingCents: numberValue(row, 'outstanding_cents'),
    paymentStatus: stringValue(row, 'payment_status') as OrderFinanceSummary['paymentStatus'],
    proofStatus: stringValue(row, 'proof_status') as OrderFinanceSummary['proofStatus'],
    invoiceStatus: stringValue(row, 'invoice_status') as OrderFinanceSummary['invoiceStatus'],
    invoiceRequestedAt: nullableString(row, 'invoice_requested_at'),
    remark: stringValue(row, 'remark'),
    createdAt: stringValue(row, 'created_at'),
    updatedAt: stringValue(row, 'updated_at'),
  };
}

function mapProof(row: SqlRow): PaymentProofRecord {
  return {
    id: numberValue(row, 'id'),
    orderId: numberValue(row, 'order_id'),
    relativePath: stringValue(row, 'relative_path'),
    originalName: stringValue(row, 'original_name'),
    mimeType: stringValue(row, 'mime_type'),
    size: numberValue(row, 'size_bytes'),
    note: stringValue(row, 'note'),
    paymentDate: nullableString(row, 'payment_date'),
    amountCents: row.amount_cents == null ? null : numberValue(row, 'amount_cents'),
    paymentMethod: stringValue(row, 'payment_method'),
    payerName: stringValue(row, 'payer_name'),
    transactionNo: stringValue(row, 'transaction_no'),
    status: stringValue(row, 'status', 'pending') as PaymentProofStatus,
    reviewNote: stringValue(row, 'review_note'),
    reviewedAt: nullableString(row, 'reviewed_at'),
    createdAt: stringValue(row, 'created_at'),
  };
}

function mapReceipt(row: SqlRow): FinanceReceipt {
  return {
    id: numberValue(row, 'id'),
    orderId: numberValue(row, 'order_id'),
    paymentProofId: row.payment_proof_id == null ? null : numberValue(row, 'payment_proof_id'),
    receivedAt: stringValue(row, 'received_at'),
    amountCents: numberValue(row, 'amount_cents'),
    paymentMethod: stringValue(row, 'payment_method'),
    payeeName: stringValue(row, 'payee_name'),
    note: stringValue(row, 'note'),
    createdAt: stringValue(row, 'created_at'),
    updatedAt: stringValue(row, 'updated_at'),
  };
}

function mapInvoiceFile(row: SqlRow): FinanceInvoiceFile {
  return {
    id: numberValue(row, 'id'),
    invoiceId: numberValue(row, 'invoice_id'),
    relativePath: stringValue(row, 'relative_path'),
    originalName: stringValue(row, 'original_name'),
    mimeType: stringValue(row, 'mime_type'),
    size: numberValue(row, 'size_bytes'),
    createdAt: stringValue(row, 'created_at'),
  };
}

function mapInvoice(row: SqlRow, files: FinanceInvoiceFile[] = []): FinanceInvoice {
  return {
    id: numberValue(row, 'id'),
    orderId: numberValue(row, 'order_id'),
    status: stringValue(row, 'status') as FinanceInvoice['status'],
    invoiceType: stringValue(row, 'invoice_type'),
    title: stringValue(row, 'title'),
    taxNo: stringValue(row, 'tax_no'),
    recipientEmail: stringValue(row, 'recipient_email'),
    recipientAddress: stringValue(row, 'recipient_address'),
    amountCents: numberValue(row, 'amount_cents'),
    taxRateBps: numberValue(row, 'tax_rate_bps'),
    taxCents: numberValue(row, 'tax_cents'),
    invoiceCode: stringValue(row, 'invoice_code'),
    invoiceNo: stringValue(row, 'invoice_no'),
    issuedAt: nullableString(row, 'issued_at'),
    sentAt: nullableString(row, 'sent_at'),
    voidedAt: nullableString(row, 'voided_at'),
    remark: stringValue(row, 'remark'),
    createdAt: stringValue(row, 'created_at'),
    updatedAt: stringValue(row, 'updated_at'),
    files,
  };
}

export class FinanceRepository {
  constructor(private readonly database: DatabaseSync) {}

  getOrder(orderId: number): SqlRow | undefined {
    return this.database.prepare(`
      SELECT o.*, COALESCE(NULLIF(c.full_name, ''), c.short_name) AS company_name, c.full_name AS company_full_name
      FROM orders o
      LEFT JOIN companies c ON c.id = o.company_id
      WHERE o.id = ?
    `).get(orderId) as SqlRow | undefined;
  }

  ensureOrderFinance(orderId: number, receivableCents: number, database = this.database): OrderFinanceSummary {
    const timestamp = new Date().toISOString();
    database.prepare(`
      INSERT OR IGNORE INTO order_finance
        (order_id, receivable_cents, received_cents, outstanding_cents, payment_status, proof_status, invoice_status, created_at, updated_at)
      VALUES (?, ?, 0, ?, 'unpaid', 'none', 'not_requested', ?, ?)
    `).run(orderId, receivableCents, receivableCents, timestamp, timestamp);
    const row = database.prepare('SELECT * FROM order_finance WHERE order_id = ?').get(orderId) as SqlRow | undefined;
    const mapped = mapFinance(row);
    if (!mapped) throw new Error('订单财务记录创建失败');
    return mapped;
  }

  getOrderFinance(orderId: number): OrderFinanceSummary | undefined {
    return mapFinance(this.database.prepare('SELECT * FROM order_finance WHERE order_id = ?').get(orderId) as SqlRow | undefined);
  }

  recalculateOrderFinance(database: DatabaseSync, orderId: number): OrderFinanceSummary {
    const order = database.prepare('SELECT amount_cents FROM orders WHERE id = ?').get(orderId) as SqlRow | undefined;
    if (!order) throw new Error('订单不存在');
    const existing = database.prepare('SELECT * FROM order_finance WHERE order_id = ?').get(orderId) as SqlRow | undefined;
    if (!existing) this.ensureOrderFinance(orderId, numberValue(order, 'amount_cents'), database);
    const receipts = database.prepare('SELECT * FROM finance_receipts WHERE order_id = ? ORDER BY received_at, id').all(orderId) as SqlRow[];
    const proofs = database.prepare('SELECT status FROM payment_proofs WHERE order_id = ?').all(orderId) as Array<{ status?: unknown }>;
    const invoices = database.prepare('SELECT status FROM finance_invoices WHERE order_id = ?').all(orderId) as Array<{ status?: unknown }>;
    const receivableCents = numberValue(order, 'amount_cents');
    const receivedCents = receipts.reduce((sum, row) => sum + numberValue(row, 'amount_cents'), 0);
    const proofStatus = deriveProofStatus(proofs.map((row) => ({ status: String(row.status ?? 'pending') as PaymentProofStatus })));
    const invoiceStatus = deriveInvoiceStatus(invoices.map((row) => ({ status: String(row.status) as Exclude<InvoiceStatus, 'not_requested'> })));
    const updatedAt = new Date().toISOString();
    database.prepare(`
      UPDATE order_finance SET receivable_cents = ?, received_cents = ?, outstanding_cents = ?, payment_status = ?, proof_status = ?, invoice_status = ?, updated_at = ?
      WHERE order_id = ?
    `).run(
      receivableCents,
      receivedCents,
      calculateOutstandingCents(receivableCents, receivedCents),
      deriveFinancePaymentStatus(receivableCents, receivedCents),
      proofStatus,
      invoiceStatus,
      updatedAt,
      orderId,
    );
    return mapFinance(database.prepare('SELECT * FROM order_finance WHERE order_id = ?').get(orderId) as SqlRow)!;
  }

  recalculateOrderFinanceAtomic(orderId: number): OrderFinanceSummary {
    return withTransaction(this.database, (database) => this.recalculateOrderFinance(database, orderId));
  }

  list(filters: FinanceListFilters = {}): FinanceListResult {
    const page = Math.max(1, Math.trunc(filters.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Math.trunc(filters.pageSize ?? 50)));
    const values: Array<string | number> = [];
    const conditions: string[] = [];
    if (filters.paymentStatus) { conditions.push('f.payment_status = ?'); values.push(filters.paymentStatus); }
    if (filters.proofStatus) { conditions.push('f.proof_status = ?'); values.push(filters.proofStatus); }
    if (filters.invoiceStatus) { conditions.push('f.invoice_status = ?'); values.push(filters.invoiceStatus); }
    if (filters.orderStatus) { conditions.push('o.status = ?'); values.push(filters.orderStatus); }
    if (filters.companyId === 'unassigned') {
      conditions.push('o.company_id IS NULL');
    } else if (filters.companyId != null) {
      conditions.push('o.company_id = ?');
      values.push(filters.companyId);
    }
    const month = filters.month?.trim();
    if (month) {
      conditions.push("substr(o.ordered_at, 1, 7) = ?");
      values.push(month);
    }
    const query = (filters.query ?? filters.orderNo ?? filters.customerName)?.trim();
    if (query) {
      const like = `%${query}%`;
      conditions.push('(o.order_no LIKE ? OR o.customer_name LIKE ? OR o.customer_contact_name LIKE ? OR o.customer_contact_phone LIKE ?)');
      values.push(like, like, like, like);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = Number(this.database.prepare(`SELECT COUNT(*) AS count FROM order_finance f JOIN orders o ON o.id = f.order_id LEFT JOIN companies c ON c.id = o.company_id ${where}`).get(...values)?.count ?? 0);
    const rows = this.database.prepare(`
      SELECT o.id AS order_id, o.order_no, o.customer_name, o.ordered_at AS order_date,
        f.receivable_cents, f.received_cents, f.outstanding_cents, f.payment_status,
        f.proof_status, f.invoice_status, o.status AS order_status, o.settlement_type,
        o.company_id, COALESCE(NULLIF(c.full_name, ''), c.short_name, '') AS company_name, f.updated_at
      FROM order_finance f
      JOIN orders o ON o.id = f.order_id
      LEFT JOIN companies c ON c.id = o.company_id
      ${where}
      ORDER BY f.updated_at DESC, f.id DESC LIMIT ? OFFSET ?
    `).all(...values, pageSize, (page - 1) * pageSize) as SqlRow[];
    const statsRows = this.database.prepare(`
      SELECT COALESCE(SUM(f.receivable_cents), 0) AS receivable_cents,
        COALESCE(SUM(f.received_cents), 0) AS received_cents,
        COALESCE(SUM(f.outstanding_cents), 0) AS outstanding_cents,
        COALESCE(SUM((SELECT COUNT(*) FROM payment_proofs p WHERE p.order_id = f.order_id AND p.status = 'pending')), 0) AS pending_proof_count,
        COALESCE(SUM(CASE WHEN f.invoice_status IN ('incomplete', 'pending_issue', 'issued')
          AND COALESCE(o.settlement_type, 'corporate') <> 'personal' THEN 1 ELSE 0 END), 0) AS pending_invoice_count
      FROM order_finance f
      JOIN orders o ON o.id = f.order_id
      LEFT JOIN companies c ON c.id = o.company_id
      ${where}
    `).get(...values) as SqlRow;
    const stats: FinanceListStats = {
      receivableCents: numberValue(statsRows, 'receivable_cents'),
      receivedCents: numberValue(statsRows, 'received_cents'),
      outstandingCents: numberValue(statsRows, 'outstanding_cents'),
      pendingProofCount: numberValue(statsRows, 'pending_proof_count'),
      pendingInvoiceCount: numberValue(statsRows, 'pending_invoice_count'),
    };
    return {
      rows: rows.map((row): FinanceListRow => ({
        orderId: numberValue(row, 'order_id'), orderNo: stringValue(row, 'order_no'), customerName: stringValue(row, 'customer_name'), orderDate: stringValue(row, 'order_date'),
        receivableCents: numberValue(row, 'receivable_cents'), receivedCents: numberValue(row, 'received_cents'), outstandingCents: numberValue(row, 'outstanding_cents'),
        paymentStatus: stringValue(row, 'payment_status') as FinanceListRow['paymentStatus'], proofStatus: stringValue(row, 'proof_status') as FinanceListRow['proofStatus'], invoiceStatus: stringValue(row, 'invoice_status') as FinanceListRow['invoiceStatus'], orderStatus: stringValue(row, 'order_status'), settlementType: stringValue(row, 'settlement_type', 'corporate'), companyId: row.company_id == null ? null : numberValue(row, 'company_id'), companyName: stringValue(row, 'company_name'), updatedAt: stringValue(row, 'updated_at'),
      })), total, page, pageSize, stats,
    };
  }

  listProofs(orderId: number): PaymentProofRecord[] {
    return (this.database.prepare('SELECT * FROM payment_proofs WHERE order_id = ? ORDER BY created_at DESC, id DESC').all(orderId) as SqlRow[]).map(mapProof);
  }

  listProofsAcrossOrders(filters: FinanceProofListFilters = {}): FinanceProofListRow[] {
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    if (filters.status) {
      conditions.push('p.status = ?');
      values.push(filters.status);
    }
    if (filters.companyId === 'unassigned') {
      conditions.push('o.company_id IS NULL');
    } else if (filters.companyId != null) {
      conditions.push('o.company_id = ?');
      values.push(filters.companyId);
    }
    const month = filters.month?.trim();
    if (month) {
      conditions.push('substr(COALESCE(p.payment_date, p.created_at), 1, 7) = ?');
      values.push(month);
    }
    const query = filters.query?.trim();
    if (query) {
      conditions.push('(o.order_no LIKE ? OR o.customer_name LIKE ? OR p.payer_name LIKE ?)');
      values.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(500, Math.max(1, Math.trunc(filters.limit ?? 200)));
    const rows = this.database.prepare(`
      SELECT p.*, o.order_no, o.customer_name, o.ordered_at AS order_date,
        COALESCE(o.settlement_type, 'corporate') AS settlement_type,
        o.company_id, COALESCE(NULLIF(c.full_name, ''), c.short_name, '') AS company_name
      FROM payment_proofs p
      JOIN orders o ON o.id = p.order_id
      LEFT JOIN companies c ON c.id = o.company_id
      ${where}
      ORDER BY COALESCE(p.payment_date, p.created_at) DESC, p.id DESC
      LIMIT ?
    `).all(...values, limit) as SqlRow[];
    return rows.map((row) => ({
      ...mapProof(row),
      orderNo: stringValue(row, 'order_no'),
      customerName: stringValue(row, 'customer_name'),
      orderDate: stringValue(row, 'order_date'),
      settlementType: stringValue(row, 'settlement_type', 'corporate'),
      companyId: row.company_id == null ? null : numberValue(row, 'company_id'),
      companyName: stringValue(row, 'company_name'),
      url: `/files/${stringValue(row, 'relative_path')}`,
    }));
  }

  getProof(id: number): PaymentProofRecord | undefined {
    const row = this.database.prepare('SELECT * FROM payment_proofs WHERE id = ?').get(id) as SqlRow | undefined;
    return row ? mapProof(row) : undefined;
  }

  updateProof(id: number, input: PaymentProofPersistenceInput): PaymentProofRecord | undefined {
    const result = this.database.prepare(`
      UPDATE payment_proofs SET payment_date = ?, amount_cents = ?, payment_method = ?, payer_name = ?, transaction_no = ?, note = ? WHERE id = ?
    `).run(input.paymentDate, input.amountCents, input.paymentMethod, input.payerName, input.transactionNo, input.note, id);
    if (Number(result.changes ?? 0) === 0) return undefined;
    return this.getProof(id);
  }

  setProofReview(database: DatabaseSync, id: number, status: PaymentProofStatus, reviewNote: string, reviewedAt: string | null): boolean {
    const result = database.prepare('UPDATE payment_proofs SET status = ?, review_note = ?, reviewed_at = ? WHERE id = ?').run(status, reviewNote, reviewedAt, id);
    return Number(result.changes ?? 0) > 0;
  }

  deleteProof(id: number): { relativePath: string; orderId: number } | undefined {
    const row = this.database.prepare('SELECT relative_path, order_id FROM payment_proofs WHERE id = ?').get(id) as SqlRow | undefined;
    if (!row) return undefined;
    this.database.prepare('DELETE FROM payment_proofs WHERE id = ?').run(id);
    return { relativePath: stringValue(row, 'relative_path'), orderId: numberValue(row, 'order_id') };
  }

  addProof(orderId: number, input: { relativePath: string; originalName: string; mimeType: string; size: number; note?: string; paymentDate?: string | null; amountCents?: number | null; paymentMethod?: string; payerName?: string; transactionNo?: string }): PaymentProofRecord {
    const id = lastInsertId(this.database.prepare(`
      INSERT INTO payment_proofs (order_id, relative_path, original_name, mime_type, size_bytes, note, payment_date, amount_cents, payment_method, payer_name, transaction_no, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(orderId, input.relativePath, input.originalName, input.mimeType, input.size, input.note ?? '', input.paymentDate ?? null, input.amountCents ?? null, input.paymentMethod ?? '', input.payerName ?? '', input.transactionNo ?? '', new Date().toISOString()));
    return this.getProof(id)!;
  }

  findReceiptByProof(database: DatabaseSync, proofId: number): FinanceReceipt | undefined {
    const row = database.prepare('SELECT * FROM finance_receipts WHERE payment_proof_id = ?').get(proofId) as SqlRow | undefined;
    return row ? mapReceipt(row) : undefined;
  }

  insertReceipt(database: DatabaseSync, input: FinanceReceiptPersistenceInput): FinanceReceipt {
    const id = lastInsertId(database.prepare(`
      INSERT INTO finance_receipts (order_id, payment_proof_id, received_at, amount_cents, payment_method, payee_name, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.orderId, input.paymentProofId, input.receivedAt, input.amountCents, input.paymentMethod, input.payeeName, input.note, input.createdAt, input.updatedAt));
    return mapReceipt(database.prepare('SELECT * FROM finance_receipts WHERE id = ?').get(id) as SqlRow);
  }

  deleteReceiptByProof(database: DatabaseSync, proofId: number): void {
    database.prepare('DELETE FROM finance_receipts WHERE payment_proof_id = ?').run(proofId);
  }

  listReceipts(orderId: number): FinanceReceipt[] {
    return (this.database.prepare('SELECT * FROM finance_receipts WHERE order_id = ? ORDER BY received_at DESC, id DESC').all(orderId) as SqlRow[]).map(mapReceipt);
  }

  listPayeeBreakdown(month?: string): PayeeBreakdownRow[] {
    const values: Array<string | number> = [];
    // 与统计卡片的“已收金额”口径一致：按订单下单月份过滤，而不是实际收款月份。
    let join = '';
    let where = '';
    const trimmed = month?.trim();
    if (trimmed) {
      join = 'JOIN orders o ON o.id = finance_receipts.order_id';
      where = 'WHERE substr(o.ordered_at, 1, 7) = ?';
      values.push(trimmed);
    }
    const rows = this.database.prepare(`
      SELECT COALESCE(NULLIF(finance_receipts.payee_name, ''), '未指定') AS payee_name,
        COUNT(*) AS receipt_count,
        COALESCE(SUM(finance_receipts.amount_cents), 0) AS amount_cents
      FROM finance_receipts ${join} ${where}
      GROUP BY COALESCE(NULLIF(finance_receipts.payee_name, ''), '未指定')
      ORDER BY amount_cents DESC, receipt_count DESC
    `).all(...values) as SqlRow[];
    return rows.map((row) => ({
      payeeName: stringValue(row, 'payee_name', '未指定'),
      receiptCount: numberValue(row, 'receipt_count'),
      amountCents: numberValue(row, 'amount_cents'),
    }));
  }

  /** 财务台账“已收金额 → 按公司”，月份口径与台账一致（下单月份）。 */
  listCompanyBreakdown(month?: string): CompanyReceiptBreakdownRow[] {
    const values: Array<string | number> = [UNASSIGNED_COMPANY_NAME];
    let where = '';
    const trimmed = month?.trim();
    if (trimmed) {
      where = 'WHERE substr(o.ordered_at, 1, 7) = ?';
      values.push(trimmed);
    }
    const rows = this.database.prepare(`
      SELECT o.company_id,
        COALESCE(NULLIF(c.full_name, ''), NULLIF(c.short_name, ''), ?) AS company_name,
        COUNT(*) AS receipt_count,
        COALESCE(SUM(r.amount_cents), 0) AS amount_cents
      FROM finance_receipts r
      JOIN orders o ON o.id = r.order_id
      LEFT JOIN companies c ON c.id = o.company_id
      ${where}
      GROUP BY o.company_id, c.full_name, c.short_name
      ORDER BY amount_cents DESC, receipt_count DESC
    `).all(...values) as SqlRow[];
    return rows.map((row) => ({
      companyId: row.company_id == null ? null : numberValue(row, 'company_id'),
      companyName: stringValue(row, 'company_name', UNASSIGNED_COMPANY_NAME),
      receiptCount: numberValue(row, 'receipt_count'),
      amountCents: numberValue(row, 'amount_cents'),
    }));
  }

  /**
   * 水单页按公司统计：
   * - 已入账/待确认按水单付款日期月份；
   * - 待开票按订单下单月份，金额为应收减去有效发票金额。
   */
  listCompanyStats(month?: string): CompanyStatsRow[] {
    const trimmed = month?.trim();
    const receivedValues: Array<string | number> = [];
    const pendingValues: Array<string | number> = [];
    const invoiceValues: Array<string | number> = [];
    const receivedMonth = trimmed ? 'AND substr(r.received_at, 1, 7) = ?' : '';
    const pendingMonth = trimmed ? 'AND substr(COALESCE(p.payment_date, p.created_at), 1, 7) = ?' : '';
    const invoiceMonth = trimmed ? 'AND substr(o.ordered_at, 1, 7) = ?' : '';
    if (trimmed) {
      receivedValues.push(trimmed);
      pendingValues.push(trimmed);
      invoiceValues.push(trimmed);
    }
    const receivedRows = this.database.prepare(`
      SELECT o.company_id, COUNT(*) AS count, COALESCE(SUM(r.amount_cents), 0) AS amount_cents
      FROM finance_receipts r
      JOIN orders o ON o.id = r.order_id
      WHERE 1 = 1 ${receivedMonth}
      GROUP BY o.company_id
    `).all(...receivedValues) as SqlRow[];
    const pendingRows = this.database.prepare(`
      SELECT o.company_id, COUNT(*) AS count, COALESCE(SUM(p.amount_cents), 0) AS amount_cents
      FROM payment_proofs p
      JOIN orders o ON o.id = p.order_id
      WHERE p.status = 'pending' AND p.amount_cents IS NOT NULL ${pendingMonth}
      GROUP BY o.company_id
    `).all(...pendingValues) as SqlRow[];
    const invoiceRows = this.database.prepare(`
      SELECT o.company_id,
        COUNT(*) AS count,
        COALESCE(SUM(MAX(0, f.receivable_cents - COALESCE((
          SELECT SUM(i.amount_cents) FROM finance_invoices i
          WHERE i.order_id = o.id AND i.status <> 'void'
        ), 0))), 0) AS amount_cents
      FROM order_finance f
      JOIN orders o ON o.id = f.order_id
      WHERE COALESCE(o.settlement_type, 'corporate') <> 'personal'
        AND f.invoice_status IN ('not_requested', 'incomplete', 'pending_issue')
        ${invoiceMonth}
      GROUP BY o.company_id
    `).all(...invoiceValues) as SqlRow[];

    const companyRows = this.database
      .prepare("SELECT id, COALESCE(NULLIF(full_name, ''), short_name) AS short_name FROM companies ORDER BY is_active DESC, COALESCE(NULLIF(full_name, ''), short_name) COLLATE NOCASE, id")
      .all() as Array<{ id: number; short_name: string }>;
    const received = new Map<string, SqlRow>();
    const pending = new Map<string, SqlRow>();
    const invoice = new Map<string, SqlRow>();
    const key = (value: unknown) => (value == null ? 'null' : String(value));
    for (const row of receivedRows) received.set(key(row.company_id), row);
    for (const row of pendingRows) pending.set(key(row.company_id), row);
    for (const row of invoiceRows) invoice.set(key(row.company_id), row);

    const build = (companyId: number | null, companyName: string): CompanyStatsRow => {
      const receivedRow = received.get(key(companyId));
      const pendingRow = pending.get(key(companyId));
      const invoiceRow = invoice.get(key(companyId));
      return {
        companyId,
        companyName,
        receivedCents: numberValue(receivedRow ?? {}, 'amount_cents'),
        receivedCount: numberValue(receivedRow ?? {}, 'count'),
        pendingCents: numberValue(pendingRow ?? {}, 'amount_cents'),
        pendingCount: numberValue(pendingRow ?? {}, 'count'),
        pendingInvoiceCents: numberValue(invoiceRow ?? {}, 'amount_cents'),
        pendingInvoiceCount: numberValue(invoiceRow ?? {}, 'count'),
      };
    };

    const rows = companyRows.map((row) => build(numberValue(row, 'id'), stringValue(row, 'short_name')));
    const hasUnassigned = received.has('null') || pending.has('null') || invoice.has('null');
    if (hasUnassigned) rows.push(build(null, UNASSIGNED_COMPANY_NAME));
    return rows;
  }

  /** 水单页快速收集：订单号、客户、收件人模糊匹配，金额按订单金额或未收金额精确匹配。 */
  lookupOrders(query: string, limit = 10): FinanceOrderLookupRow[] {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const like = `%${trimmed}%`;
    const conditions = ['o.order_no LIKE ?', 'o.customer_name LIKE ?', 'o.recipient_name LIKE ?'];
    const values: Array<string | number> = [like, like, like];
    const amountCents = parseLookupAmountCents(trimmed);
    if (amountCents != null) {
      conditions.push('(o.amount_cents = ? OR COALESCE(f.outstanding_cents, o.amount_cents) = ?)');
      values.push(amountCents, amountCents);
    }
    const rows = this.database.prepare(`
      SELECT o.id AS order_id, o.order_no, o.customer_name, o.recipient_name, o.ordered_at AS order_date,
        COALESCE(o.settlement_type, 'corporate') AS settlement_type,
        o.company_id, COALESCE(NULLIF(c.full_name, ''), c.short_name, '') AS company_name,
        o.amount_cents,
        COALESCE(f.receivable_cents, o.amount_cents) AS receivable_cents,
        COALESCE(f.received_cents, 0) AS received_cents,
        COALESCE(f.outstanding_cents, o.amount_cents) AS outstanding_cents,
        COALESCE(f.payment_status, 'unpaid') AS payment_status,
        COALESCE(f.proof_status, 'none') AS proof_status,
        COALESCE(f.invoice_status, 'not_requested') AS invoice_status
      FROM orders o
      LEFT JOIN order_finance f ON f.order_id = o.id
      LEFT JOIN companies c ON c.id = o.company_id
      WHERE ${conditions.join(' OR ')}
      ORDER BY
        CASE
          WHEN o.order_no = ? THEN 0
          WHEN o.customer_name = ? THEN 1
          WHEN o.recipient_name = ? THEN 2
          ELSE 3
        END,
        o.ordered_at DESC, o.id DESC
      LIMIT ?
    `).all(...values, trimmed, trimmed, trimmed, Math.max(1, Math.min(50, limit))) as SqlRow[];
    return rows.map((row) => ({
      orderId: numberValue(row, 'order_id'),
      orderNo: stringValue(row, 'order_no'),
      customerName: stringValue(row, 'customer_name'),
      recipientName: stringValue(row, 'recipient_name'),
      orderDate: stringValue(row, 'order_date'),
      settlementType: stringValue(row, 'settlement_type', 'corporate'),
      companyId: row.company_id == null ? null : numberValue(row, 'company_id'),
      companyName: stringValue(row, 'company_name'),
      amountCents: numberValue(row, 'amount_cents'),
      receivableCents: numberValue(row, 'receivable_cents'),
      receivedCents: numberValue(row, 'received_cents'),
      outstandingCents: numberValue(row, 'outstanding_cents'),
      paymentStatus: stringValue(row, 'payment_status') as FinanceOrderLookupRow['paymentStatus'],
      proofStatus: stringValue(row, 'proof_status') as FinanceOrderLookupRow['proofStatus'],
      invoiceStatus: stringValue(row, 'invoice_status') as FinanceOrderLookupRow['invoiceStatus'],
    }));
  }

  listInvoices(orderId: number): FinanceInvoice[] {
    const rows = this.database.prepare('SELECT * FROM finance_invoices WHERE order_id = ? ORDER BY created_at DESC, id DESC').all(orderId) as SqlRow[];
    return rows.map((row) => {
      const files = this.database.prepare('SELECT * FROM finance_invoice_files WHERE invoice_id = ? ORDER BY created_at DESC, id DESC').all(numberValue(row, 'id')) as SqlRow[];
      return mapInvoice(row, files.map(mapInvoiceFile));
    });
  }

  getInvoice(id: number): FinanceInvoice | undefined {
    const row = this.database.prepare('SELECT * FROM finance_invoices WHERE id = ?').get(id) as SqlRow | undefined;
    if (!row) return undefined;
    const files = this.database.prepare('SELECT * FROM finance_invoice_files WHERE invoice_id = ? ORDER BY created_at DESC, id DESC').all(id) as SqlRow[];
    return mapInvoice(row, files.map(mapInvoiceFile));
  }

  insertInvoice(database: DatabaseSync, input: FinanceInvoicePersistenceInput): FinanceInvoice {
    const id = lastInsertId(database.prepare(`
      INSERT INTO finance_invoices (order_id, status, invoice_type, title, tax_no, recipient_email, recipient_address, amount_cents, tax_rate_bps, tax_cents, invoice_code, invoice_no, issued_at, sent_at, voided_at, remark, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.orderId, input.status, input.invoiceType, input.title, input.taxNo, input.recipientEmail, input.recipientAddress, input.amountCents, input.taxRateBps, input.taxCents, input.invoiceCode, input.invoiceNo, input.issuedAt, input.sentAt, input.voidedAt, input.remark, input.createdAt, input.updatedAt));
    return this.getInvoiceFrom(database, id)!;
  }

  updateInvoice(database: DatabaseSync, id: number, input: FinanceInvoicePersistenceInput): boolean {
    const result = database.prepare(`
      UPDATE finance_invoices SET status = ?, invoice_type = ?, title = ?, tax_no = ?, recipient_email = ?, recipient_address = ?, amount_cents = ?, tax_rate_bps = ?, tax_cents = ?, invoice_code = ?, invoice_no = ?, issued_at = ?, sent_at = ?, voided_at = ?, remark = ?, updated_at = ? WHERE id = ?
    `).run(input.status, input.invoiceType, input.title, input.taxNo, input.recipientEmail, input.recipientAddress, input.amountCents, input.taxRateBps, input.taxCents, input.invoiceCode, input.invoiceNo, input.issuedAt, input.sentAt, input.voidedAt, input.remark, input.updatedAt, id);
    return Number(result.changes ?? 0) > 0;
  }

  private getInvoiceFrom(database: DatabaseSync, id: number): FinanceInvoice | undefined {
    const row = database.prepare('SELECT * FROM finance_invoices WHERE id = ?').get(id) as SqlRow | undefined;
    if (!row) return undefined;
    const files = database.prepare('SELECT * FROM finance_invoice_files WHERE invoice_id = ? ORDER BY created_at DESC, id DESC').all(id) as SqlRow[];
    return mapInvoice(row, files.map(mapInvoiceFile));
  }

  insertInvoiceFile(database: DatabaseSync, input: FinanceInvoiceFilePersistenceInput): FinanceInvoiceFile {
    const id = lastInsertId(database.prepare(`
      INSERT INTO finance_invoice_files (invoice_id, relative_path, original_name, mime_type, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.invoiceId, input.relativePath, input.originalName, input.mimeType, input.size, input.createdAt));
    return mapInvoiceFile(database.prepare('SELECT * FROM finance_invoice_files WHERE id = ?').get(id) as SqlRow);
  }

  getInvoiceFile(id: number): FinanceInvoiceFile | undefined {
    const row = this.database.prepare('SELECT * FROM finance_invoice_files WHERE id = ?').get(id) as SqlRow | undefined;
    return row ? mapInvoiceFile(row) : undefined;
  }

  deleteInvoiceFile(database: DatabaseSync, id: number): FinanceInvoiceFile | undefined {
    const row = database.prepare('SELECT * FROM finance_invoice_files WHERE id = ?').get(id) as SqlRow | undefined;
    if (!row) return undefined;
    database.prepare('DELETE FROM finance_invoice_files WHERE id = ?').run(id);
    return mapInvoiceFile(row);
  }

  getOrderDetail(orderId: number): FinanceOrderDetail | undefined {
    const order = this.getOrder(orderId);
    const finance = this.getOrderFinance(orderId);
    if (!order || !finance) return undefined;
    return { order, finance, proofs: this.listProofs(orderId), receipts: this.listReceipts(orderId), invoices: this.listInvoices(orderId) };
  }
}
