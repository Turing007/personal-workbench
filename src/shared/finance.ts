export type FinancePaymentStatus = 'unpaid' | 'partial' | 'paid' | 'overpaid';
export type FinanceProofStatus = 'none' | 'pending' | 'approved' | 'rejected';
export type PaymentProofStatus = 'pending' | 'approved' | 'rejected' | 'void';
export type InvoiceStatus = 'not_requested' | 'incomplete' | 'pending_issue' | 'issued' | 'sent' | 'void';

export const FINANCE_PAYMENT_STATUS_LABELS = {
  unpaid: '未付款',
  partial: '部分付款',
  paid: '已付款',
  overpaid: '超额付款',
} as const satisfies Record<FinancePaymentStatus, string>;

export const PAYMENT_PROOF_STATUS_LABELS = {
  none: '无水单',
  pending: '待审核',
  approved: '已审核',
  rejected: '有驳回',
} as const satisfies Record<FinanceProofStatus, string>;

export const INVOICE_STATUS_LABELS = {
  not_requested: '未申请',
  incomplete: '资料不完整',
  pending_issue: '待开票',
  issued: '已开票',
  sent: '已发送',
  void: '已作废',
} as const satisfies Record<InvoiceStatus, string>;

export interface OrderFinanceSummary {
  id: number;
  orderId: number;
  receivableCents: number;
  receivedCents: number;
  outstandingCents: number;
  paymentStatus: FinancePaymentStatus;
  proofStatus: FinanceProofStatus;
  invoiceStatus: InvoiceStatus;
  invoiceRequestedAt: string | null;
  remark: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentProofRecord {
  id: number;
  orderId: number;
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  note: string;
  paymentDate: string | null;
  amountCents: number | null;
  paymentMethod: string;
  payerName: string;
  transactionNo: string;
  status: PaymentProofStatus;
  reviewNote: string;
  reviewedAt: string | null;
  createdAt: string;
}

export interface FinanceReceipt {
  id: number;
  orderId: number;
  paymentProofId: number | null;
  receivedAt: string;
  amountCents: number;
  paymentMethod: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceInvoiceFile {
  id: number;
  invoiceId: number;
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  url?: string;
}

export interface FinanceInvoice {
  id: number;
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
  files: FinanceInvoiceFile[];
}

export interface FinanceListFilters {
  query?: string;
  orderNo?: string;
  customerName?: string;
  paymentStatus?: FinancePaymentStatus;
  proofStatus?: FinanceProofStatus;
  invoiceStatus?: InvoiceStatus;
  orderStatus?: string;
  page?: number;
  pageSize?: number;
}

export interface FinanceListRow {
  orderId: number;
  orderNo: string;
  customerName: string;
  orderDate: string;
  receivableCents: number;
  receivedCents: number;
  outstandingCents: number;
  paymentStatus: FinancePaymentStatus;
  proofStatus: FinanceProofStatus;
  invoiceStatus: InvoiceStatus;
  orderStatus: string;
  updatedAt: string;
}

export interface FinanceListStats {
  receivableCents: number;
  receivedCents: number;
  outstandingCents: number;
  pendingProofCount: number;
  pendingInvoiceCount: number;
}

export interface FinanceListResult {
  rows: FinanceListRow[];
  total: number;
  page: number;
  pageSize: number;
  stats: FinanceListStats;
}

function assertCents(value: number, field: string, allowNegative = false): void {
  if (!Number.isSafeInteger(value) || (!allowNegative && value < 0)) {
    throw new Error(`${field}必须是${allowNegative ? '' : '非负'}安全整数分`);
  }
}

export function calculateOutstandingCents(receivableCents: number, receivedCents: number): number {
  assertCents(receivableCents, '应收金额');
  assertCents(receivedCents, '已收金额');
  return receivableCents - receivedCents;
}

export function deriveFinancePaymentStatus(receivableCents: number, receivedCents: number): FinancePaymentStatus {
  assertCents(receivableCents, '应收金额');
  assertCents(receivedCents, '已收金额');
  if (receivedCents === 0) return 'unpaid';
  if (receivedCents < receivableCents) return 'partial';
  if (receivedCents === receivableCents) return 'paid';
  return 'overpaid';
}

export function deriveProofStatus(proofs: Array<Pick<PaymentProofRecord, 'status'> | { status: PaymentProofStatus }>): FinanceProofStatus {
  if (proofs.length === 0) return 'none';
  if (proofs.some((proof) => proof.status === 'pending')) return 'pending';
  if (proofs.some((proof) => proof.status === 'rejected')) return 'rejected';
  if (proofs.some((proof) => proof.status === 'approved')) return 'approved';
  return 'none';
}

export function deriveInvoiceStatus(
  invoices: Array<Pick<FinanceInvoice, 'status'> | { status: Exclude<InvoiceStatus, 'not_requested'> }>,
): InvoiceStatus {
  if (invoices.length === 0) return 'not_requested';
  if (invoices.every((invoice) => invoice.status === 'void')) return 'void';
  if (invoices.some((invoice) => invoice.status === 'incomplete')) return 'incomplete';
  if (invoices.some((invoice) => invoice.status === 'pending_issue')) return 'pending_issue';
  if (invoices.some((invoice) => invoice.status === 'issued')) return 'issued';
  return 'sent';
}

export function paymentStatusLabel(status: FinancePaymentStatus): string {
  return FINANCE_PAYMENT_STATUS_LABELS[status];
}

export function proofStatusLabel(status: FinanceProofStatus): string {
  return PAYMENT_PROOF_STATUS_LABELS[status];
}

export function invoiceStatusLabel(status: InvoiceStatus): string {
  return INVOICE_STATUS_LABELS[status];
}
