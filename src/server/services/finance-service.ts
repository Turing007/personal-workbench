import type { Readable } from 'node:stream';
import { withTransaction } from '../db/connection.js';
import { FinanceRepository, type FinanceInvoicePersistenceInput, type PaymentProofPersistenceInput } from '../db/finance-repository.js';
import type { FileStore } from '../files/file-store.js';
import type {
  FinanceInvoice,
  FinanceInvoiceFile,
  FinanceListFilters,
  FinanceListResult,
  OrderFinanceSummary,
  PaymentProofRecord,
  PaymentProofStatus,
  PayeeBreakdownRow,
} from '../../shared/finance.js';

function now(): string { return new Date().toISOString(); }

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validDate(value: unknown): string {
  const normalized = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new FinanceServiceError('VALIDATION_ERROR', '日期格式必须是 YYYY-MM-DD');
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) throw new FinanceServiceError('VALIDATION_ERROR', '日期无效');
  return normalized;
}

function cents(value: unknown, field: string, required = true): number | null {
  if (value === undefined || value === null || value === '') {
    if (!required) return null;
    throw new FinanceServiceError('VALIDATION_ERROR', `${field}不能为空`);
  }
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new FinanceServiceError('VALIDATION_ERROR', `${field}必须是非负整数分`);
  return result;
}

export class FinanceServiceError extends Error {
  constructor(
    public readonly code:
      | 'FINANCE_ORDER_NOT_FOUND'
      | 'PROOF_NOT_FOUND'
      | 'PROOF_AMOUNT_REQUIRED'
      | 'PROOF_ALREADY_REVIEWED'
      | 'PROOF_ALREADY_VOID'
      | 'PROOF_TRANSACTION_EXISTS'
      | 'PROOF_ORDER_MISMATCH'
      | 'RECEIPT_EXISTS'
      | 'RECEIPT_EXCEEDS_ORDER'
      | 'INVOICE_NOT_FOUND'
      | 'INVOICE_AMOUNT_EXCEEDS_ORDER'
      | 'INVOICE_ALREADY_VOID'
      | 'INVALID_FINANCE_STATUS'
      | 'VALIDATION_ERROR'
      | 'FILE_STORE_REQUIRED',
    message: string,
  ) {
    super(message);
    this.name = 'FinanceServiceError';
  }
}

export interface FinanceProofInput {
  paymentDate?: unknown;
  amountCents?: unknown;
  paymentMethod?: unknown;
  payerName?: unknown;
  transactionNo?: unknown;
  note?: unknown;
}

export interface FinanceInvoiceInput {
  invoiceType?: unknown;
  title?: unknown;
  taxNo?: unknown;
  recipientEmail?: unknown;
  recipientAddress?: unknown;
  amountCents?: unknown;
  taxRateBps?: unknown;
  taxCents?: unknown;
  invoiceCode?: unknown;
  invoiceNo?: unknown;
  issuedAt?: unknown;
  sentAt?: unknown;
  remark?: unknown;
}

export interface FinanceServiceOptions {
  database: import('node:sqlite').DatabaseSync;
  repository?: FinanceRepository;
  fileStore?: FileStore;
}

export interface FinanceDetail {
  order: Record<string, unknown>;
  finance: OrderFinanceSummary;
  proofs: Array<PaymentProofRecord & { url: string }>;
  receipts: ReturnType<FinanceRepository['listReceipts']>;
  invoices: Array<FinanceInvoice & { files: Array<FinanceInvoiceFile & { url: string }> }>;
}

export class FinanceService {
  readonly repository: FinanceRepository;
  readonly fileStore?: FileStore;

  constructor(private readonly options: FinanceServiceOptions) {
    this.repository = options.repository ?? new FinanceRepository(options.database);
    this.fileStore = options.fileStore;
  }

  list(filters: FinanceListFilters = {}): FinanceListResult {
    return this.repository.list(filters);
  }

  listPayeeBreakdown(month?: string): PayeeBreakdownRow[] {
    return this.repository.listPayeeBreakdown(month);
  }

  get(orderId: number): FinanceDetail | undefined {
    const order = this.repository.getOrder(orderId);
    if (!order) return undefined;
    const finance = this.repository.getOrderFinance(orderId)
      ?? this.repository.ensureOrderFinance(orderId, Number(order.amount_cents ?? 0));
    const detail = this.repository.getOrderDetail(orderId);
    if (!detail) return undefined;
    return {
      order,
      finance,
      proofs: detail.proofs.map((proof) => ({ ...proof, url: `/files/${proof.relativePath}` })),
      receipts: detail.receipts,
      invoices: detail.invoices.map((invoice) => ({
        ...invoice,
        files: invoice.files.map((file) => ({ ...file, url: `/files/${file.relativePath}` })),
      })),
    };
  }

  async uploadProof(orderId: number, stream: Readable, originalName: string, mimeType: string, input: FinanceProofInput): Promise<PaymentProofRecord> {
    this.assertOrder(orderId);
    if (!this.fileStore) throw new FinanceServiceError('FILE_STORE_REQUIRED', '附件存储尚未配置');
    const stored = await this.fileStore.saveImage(stream, 'payment', originalName, mimeType);
    try {
      const proof = this.repository.addProof(orderId, {
        ...stored,
        note: normalizeText(input.note),
        paymentDate: input.paymentDate == null || input.paymentDate === '' ? null : validDate(input.paymentDate),
        amountCents: cents(input.amountCents, '付款金额', false),
        paymentMethod: normalizeText(input.paymentMethod),
        payerName: normalizeText(input.payerName),
        transactionNo: normalizeText(input.transactionNo),
      });
      this.repository.recalculateOrderFinanceAtomic(orderId);
      return proof;
    } catch (error) {
      await this.fileStore.deleteFile(stored.relativePath).catch(() => undefined);
      if (/UNIQUE constraint failed.*payment_proofs/i.test(String(error))) throw new FinanceServiceError('PROOF_TRANSACTION_EXISTS', '该流水号已在此订单使用');
      throw error;
    }
  }

  updateProof(proofId: number, input: FinanceProofInput): PaymentProofRecord {
    const proof = this.repository.getProof(proofId);
    if (!proof) throw new FinanceServiceError('PROOF_NOT_FOUND', '水单不存在');
    if (proof.status === 'approved') throw new FinanceServiceError('PROOF_ALREADY_REVIEWED', '已审核水单不能编辑');
    if (proof.status === 'void') throw new FinanceServiceError('PROOF_ALREADY_VOID', '已作废水单不能编辑');
    const payload: PaymentProofPersistenceInput = {
      paymentDate: input.paymentDate == null || input.paymentDate === '' ? null : validDate(input.paymentDate),
      amountCents: cents(input.amountCents, '付款金额', false),
      paymentMethod: normalizeText(input.paymentMethod),
      payerName: normalizeText(input.payerName),
      transactionNo: normalizeText(input.transactionNo),
      note: normalizeText(input.note),
    };
    try {
      const updated = this.repository.updateProof(proofId, payload);
      if (!updated) throw new FinanceServiceError('PROOF_NOT_FOUND', '水单不存在');
      this.repository.recalculateOrderFinanceAtomic(proof.orderId);
      return updated;
    } catch (error) {
      if (/UNIQUE constraint failed.*payment_proofs/i.test(String(error))) throw new FinanceServiceError('PROOF_TRANSACTION_EXISTS', '该流水号已在此订单使用');
      throw error;
    }
  }

  approveProof(proofId: number, payeeName = ''): FinanceDetail {
    const proof = this.repository.getProof(proofId);
    if (!proof) throw new FinanceServiceError('PROOF_NOT_FOUND', '水单不存在');
    if (proof.status === 'approved') return this.get(proof.orderId)!;
    if (proof.status === 'void') throw new FinanceServiceError('PROOF_ALREADY_VOID', '已作废水单不能审核');
    if (!proof.amountCents || proof.amountCents <= 0 || !proof.paymentDate) throw new FinanceServiceError('PROOF_AMOUNT_REQUIRED', '审核前请补充付款日期和付款金额');
    try {
      withTransaction(this.options.database, (database) => {
        const current = database.prepare('SELECT * FROM payment_proofs WHERE id = ?').get(proofId) as Record<string, unknown> | undefined;
        if (!current) throw new FinanceServiceError('PROOF_NOT_FOUND', '水单不存在');
        if (String(current.status) === 'approved') return;
        if (String(current.status) === 'void') throw new FinanceServiceError('PROOF_ALREADY_VOID', '已作废水单不能审核');
        const existing = this.repository.findReceiptByProof(database, proofId);
        if (!existing) {
          this.repository.insertReceipt(database, {
            orderId: Number(current.order_id), paymentProofId: proofId, receivedAt: String(current.payment_date), amountCents: Number(current.amount_cents), paymentMethod: String(current.payment_method ?? ''), payeeName: normalizeText(payeeName), note: String(current.note ?? ''), createdAt: now(), updatedAt: now(),
          });
        }
        this.repository.setProofReview(database, proofId, 'approved', '', now());
        this.repository.recalculateOrderFinance(database, Number(current.order_id));
      });
    } catch (error) {
      if (/UNIQUE constraint failed.*finance_receipts/i.test(String(error))) throw new FinanceServiceError('RECEIPT_EXISTS', '该水单已生成收款记录');
      throw error;
    }
    return this.get(proof.orderId)!;
  }

  rejectProof(proofId: number, note: string): FinanceDetail {
    const proof = this.repository.getProof(proofId);
    if (!proof) throw new FinanceServiceError('PROOF_NOT_FOUND', '水单不存在');
    if (proof.status === 'approved') throw new FinanceServiceError('PROOF_ALREADY_REVIEWED', '已审核水单不能驳回');
    if (proof.status === 'void') throw new FinanceServiceError('PROOF_ALREADY_VOID', '已作废水单不能驳回');
    const reviewNote = normalizeText(note);
    if (!reviewNote) throw new FinanceServiceError('VALIDATION_ERROR', '驳回原因不能为空');
    withTransaction(this.options.database, (database) => {
      this.repository.setProofReview(database, proofId, 'rejected', reviewNote, now());
      this.repository.recalculateOrderFinance(database, proof.orderId);
    });
    return this.get(proof.orderId)!;
  }

  voidProof(proofId: number, note = ''): FinanceDetail {
    const proof = this.repository.getProof(proofId);
    if (!proof) throw new FinanceServiceError('PROOF_NOT_FOUND', '水单不存在');
    if (proof.status === 'void') return this.get(proof.orderId)!;
    withTransaction(this.options.database, (database) => {
      this.repository.deleteReceiptByProof(database, proofId);
      this.repository.setProofReview(database, proofId, 'void', normalizeText(note), now());
      this.repository.recalculateOrderFinance(database, proof.orderId);
    });
    return this.get(proof.orderId)!;
  }

  async deleteProof(proofId: number): Promise<PaymentProofRecord> {
    const proof = this.repository.getProof(proofId);
    if (!proof) throw new FinanceServiceError('PROOF_NOT_FOUND', '水单不存在');
    if (proof.status !== 'pending' && proof.status !== 'rejected') throw new FinanceServiceError('PROOF_ALREADY_REVIEWED', '已审核或已作废水单不能删除');
    const deleted = this.repository.deleteProof(proofId);
    if (!deleted) throw new FinanceServiceError('PROOF_NOT_FOUND', '水单不存在');
    if (this.fileStore) await this.fileStore.deleteFile(deleted.relativePath).catch(() => undefined);
    this.repository.recalculateOrderFinanceAtomic(proof.orderId);
    return proof;
  }

  createInvoice(orderId: number, input: FinanceInvoiceInput): FinanceInvoice {
    this.assertOrder(orderId);
    const payload = this.normalizeInvoice(orderId, input, 'incomplete');
    this.assertInvoiceAmount(orderId, payload.amountCents);
    return withTransaction(this.options.database, (database) => {
      const invoice = this.repository.insertInvoice(database, payload);
      this.repository.recalculateOrderFinance(database, orderId);
      return invoice;
    });
  }

  updateInvoice(invoiceId: number, input: FinanceInvoiceInput): FinanceInvoice {
    const invoice = this.repository.getInvoice(invoiceId);
    if (!invoice) throw new FinanceServiceError('INVOICE_NOT_FOUND', '发票记录不存在');
    if (invoice.status === 'void' || invoice.status === 'sent') throw new FinanceServiceError('INVOICE_ALREADY_VOID', '已发送或已作废发票不能编辑');
    const payload = this.normalizeInvoice(invoice.orderId, input, invoice.status);
    this.assertInvoiceAmount(invoice.orderId, payload.amountCents, invoiceId);
    const updated = withTransaction(this.options.database, (database) => {
      if (!this.repository.updateInvoice(database, invoiceId, payload)) throw new FinanceServiceError('INVOICE_NOT_FOUND', '发票记录不存在');
      this.repository.recalculateOrderFinance(database, invoice.orderId);
      return this.repository.getInvoice(invoiceId)!;
    });
    return updated;
  }

  submitInvoice(invoiceId: number): FinanceInvoice {
    const invoice = this.requireInvoice(invoiceId);
    if (invoice.status === 'void') throw new FinanceServiceError('INVOICE_ALREADY_VOID', '已作废发票不能提交');
    if (!invoice.title || !invoice.taxNo || !invoice.invoiceType || invoice.amountCents <= 0) throw new FinanceServiceError('VALIDATION_ERROR', '请补齐发票类型、抬头、税号和开票金额');
    return this.changeInvoiceStatus(invoice, 'pending_issue');
  }

  issueInvoice(invoiceId: number, input: FinanceInvoiceInput): FinanceInvoice {
    const invoice = this.requireInvoice(invoiceId);
    if (invoice.status !== 'pending_issue') throw new FinanceServiceError('INVALID_FINANCE_STATUS', '只有待开票记录才能标记已开票');
    const payload = this.normalizeInvoice(invoice.orderId, { ...input, invoiceType: input.invoiceType ?? invoice.invoiceType, title: input.title ?? invoice.title, taxNo: input.taxNo ?? invoice.taxNo, amountCents: input.amountCents ?? invoice.amountCents, taxRateBps: input.taxRateBps ?? invoice.taxRateBps, taxCents: input.taxCents ?? invoice.taxCents, invoiceCode: input.invoiceCode, invoiceNo: input.invoiceNo, issuedAt: input.issuedAt ?? new Date().toISOString().slice(0, 10) }, 'issued');
    if (!normalizeText(payload.invoiceNo)) throw new FinanceServiceError('VALIDATION_ERROR', '发票号码不能为空');
    return withTransaction(this.options.database, (database) => {
      if (!this.repository.updateInvoice(database, invoiceId, payload)) throw new FinanceServiceError('INVOICE_NOT_FOUND', '发票记录不存在');
      this.repository.recalculateOrderFinance(database, invoice.orderId);
      return this.repository.getInvoice(invoiceId)!;
    });
  }

  sendInvoice(invoiceId: number): FinanceInvoice {
    const invoice = this.requireInvoice(invoiceId);
    if (invoice.status !== 'issued') throw new FinanceServiceError('INVALID_FINANCE_STATUS', '只有已开票记录才能发送');
    if (!invoice.files.length) throw new FinanceServiceError('VALIDATION_ERROR', '请先上传发票文件');
    return this.changeInvoiceStatus(invoice, 'sent');
  }

  voidInvoice(invoiceId: number, note = ''): FinanceInvoice {
    const invoice = this.requireInvoice(invoiceId);
    if (invoice.status === 'void') return invoice;
    return withTransaction(this.options.database, (database) => {
      const payload = this.invoicePersistence(invoice.orderId, invoice, 'void', { voidedAt: now(), remark: normalizeText(note) || invoice.remark });
      this.repository.updateInvoice(database, invoiceId, payload);
      this.repository.recalculateOrderFinance(database, invoice.orderId);
      return this.repository.getInvoice(invoiceId)!;
    });
  }

  async uploadInvoiceFile(invoiceId: number, stream: Readable, originalName: string, mimeType: string): Promise<FinanceInvoiceFile> {
    const invoice = this.requireInvoice(invoiceId);
    if (invoice.status === 'void') throw new FinanceServiceError('INVOICE_ALREADY_VOID', '已作废发票不能上传文件');
    if (!this.fileStore) throw new FinanceServiceError('FILE_STORE_REQUIRED', '附件存储尚未配置');
    const stored = await this.fileStore.saveFile(stream, 'finance-invoice', originalName, mimeType);
    try {
      const file = withTransaction(this.options.database, (database) => this.repository.insertInvoiceFile(database, { invoiceId, ...stored, createdAt: now() }));
      return file;
    } catch (error) {
      await this.fileStore.deleteFile(stored.relativePath).catch(() => undefined);
      throw error;
    }
  }

  async deleteInvoiceFile(fileId: number): Promise<FinanceInvoiceFile> {
    const file = this.repository.getInvoiceFile(fileId);
    if (!file) throw new FinanceServiceError('INVOICE_NOT_FOUND', '发票附件不存在');
    const invoice = this.requireInvoice(file.invoiceId);
    if (invoice.status === 'sent' || invoice.status === 'void') throw new FinanceServiceError('INVOICE_ALREADY_VOID', '已发送或已作废发票不能删除附件');
    const deleted = withTransaction(this.options.database, (database) => this.repository.deleteInvoiceFile(database, fileId));
    if (!deleted) throw new FinanceServiceError('INVOICE_NOT_FOUND', '发票附件不存在');
    if (this.fileStore) await this.fileStore.deleteFile(deleted.relativePath).catch(() => undefined);
    return deleted;
  }

  private assertOrder(orderId: number): Record<string, unknown> {
    const order = this.repository.getOrder(orderId);
    if (!order) throw new FinanceServiceError('FINANCE_ORDER_NOT_FOUND', '订单不存在');
    if (!this.repository.getOrderFinance(orderId)) this.repository.ensureOrderFinance(orderId, Number(order.amount_cents ?? 0));
    return order;
  }

  private requireInvoice(invoiceId: number): FinanceInvoice {
    const invoice = this.repository.getInvoice(invoiceId);
    if (!invoice) throw new FinanceServiceError('INVOICE_NOT_FOUND', '发票记录不存在');
    return invoice;
  }

  private assertInvoiceAmount(orderId: number, amountCents: number, excludeInvoiceId?: number): void {
    const finance = this.repository.getOrderFinance(orderId) ?? this.repository.ensureOrderFinance(orderId, Number(this.repository.getOrder(orderId)?.amount_cents ?? 0));
    const current = this.repository.listInvoices(orderId).filter((invoice) => invoice.status !== 'void' && invoice.id !== excludeInvoiceId).reduce((sum, invoice) => sum + invoice.amountCents, 0);
    if (current + amountCents > finance.receivableCents) throw new FinanceServiceError('INVOICE_AMOUNT_EXCEEDS_ORDER', '有效发票金额不能超过订单应收金额');
  }

  private normalizeInvoice(orderId: number, input: FinanceInvoiceInput, status: FinanceInvoice['status']): FinanceInvoicePersistenceInput {
    const amountCents = cents(input.amountCents, '开票金额')!;
    const taxRateBps = cents(input.taxRateBps ?? 0, '税率')!;
    const taxCents = cents(input.taxCents ?? 0, '税额')!;
    if (taxRateBps > 10000) throw new FinanceServiceError('VALIDATION_ERROR', '税率不能超过 100%');
    return {
      orderId, status, invoiceType: normalizeText(input.invoiceType), title: normalizeText(input.title), taxNo: normalizeText(input.taxNo), recipientEmail: normalizeText(input.recipientEmail), recipientAddress: normalizeText(input.recipientAddress), amountCents, taxRateBps, taxCents, invoiceCode: normalizeText(input.invoiceCode), invoiceNo: normalizeText(input.invoiceNo), issuedAt: input.issuedAt ? validDate(input.issuedAt) : null, sentAt: input.sentAt ? validDate(input.sentAt) : null, voidedAt: null, remark: normalizeText(input.remark), createdAt: now(), updatedAt: now(),
    };
  }

  private invoicePersistence(orderId: number, invoice: FinanceInvoice, status: FinanceInvoice['status'], overrides: Partial<FinanceInvoicePersistenceInput> = {}): FinanceInvoicePersistenceInput {
    return { orderId, status, invoiceType: invoice.invoiceType, title: invoice.title, taxNo: invoice.taxNo, recipientEmail: invoice.recipientEmail, recipientAddress: invoice.recipientAddress, amountCents: invoice.amountCents, taxRateBps: invoice.taxRateBps, taxCents: invoice.taxCents, invoiceCode: invoice.invoiceCode, invoiceNo: invoice.invoiceNo, issuedAt: invoice.issuedAt, sentAt: invoice.sentAt, voidedAt: invoice.voidedAt, remark: invoice.remark, createdAt: invoice.createdAt, updatedAt: now(), ...overrides };
  }

  private changeInvoiceStatus(invoice: FinanceInvoice, status: FinanceInvoice['status']): FinanceInvoice {
    return withTransaction(this.options.database, (database) => {
      this.repository.updateInvoice(database, invoice.id, this.invoicePersistence(invoice.orderId, invoice, status, { sentAt: status === 'sent' ? now() : invoice.sentAt }));
      this.repository.recalculateOrderFinance(database, invoice.orderId);
      return this.repository.getInvoice(invoice.id)!;
    });
  }
}
