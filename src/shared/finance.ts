import type { OrderChannel } from './domain.js';

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
  /** 已收金额为净额：收款记录合计减去退款记录合计。 */
  receivedCents: number;
  outstandingCents: number;
  /** 已退金额（累计退款）。 */
  refundedCents: number;
  /** 超收金额，等于 max(0, 已收 - 应收)。 */
  overpaidCents: number;
  paymentStatus: FinancePaymentStatus;
  proofStatus: FinanceProofStatus;
  invoiceStatus: InvoiceStatus;
  invoiceRequestedAt: string | null;
  remark: string;
  createdAt: string;
  updatedAt: string;
}

/** 订单详情页使用的轻量财务摘要，不含水单/发票明细。 */
export interface OrderFinanceLite {
  orderId: number;
  receivableCents: number;
  receivedCents: number;
  outstandingCents: number;
  refundedCents: number;
  overpaidCents: number;
  paymentStatus: FinancePaymentStatus;
  proofStatus: FinanceProofStatus;
  invoiceStatus: InvoiceStatus;
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
  payeeName: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

/** 退给客户的款项；退款会冲减订单已收，并重算未收/超收与付款状态。 */
export interface FinanceRefund {
  id: number;
  orderId: number;
  refundedAt: string;
  amountCents: number;
  paymentMethod: string;
  reason: string;
  note: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayeeBreakdownRow {
  payeeName: string;
  receiptCount: number;
  amountCents: number;
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
  /** 按订单月份筛选，格式 YYYY-MM；为空表示不限 */
  month?: string;
  /** 按订单日期筛选，格式 YYYY-MM-DD；有值时优先于月份 */
  date?: string;
  /** 订单渠道；为空表示不限 */
  channel?: OrderChannel;
  paymentStatus?: FinancePaymentStatus;
  proofStatus?: FinanceProofStatus;
  invoiceStatus?: InvoiceStatus;
  orderStatus?: string;
  /** 公司筛选；unassigned 表示历史订单尚未分配公司 */
  companyId?: number | 'unassigned';
  /** 多选筛选（左侧筛选栏使用） */
  companyIds?: number[];
  includeUnassignedCompany?: boolean;
  paymentStatuses?: FinancePaymentStatus[];
  proofStatuses?: FinanceProofStatus[];
  invoiceStatuses?: InvoiceStatus[];
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
  refundedCents: number;
  overpaidCents: number;
  paymentStatus: FinancePaymentStatus;
  proofStatus: FinanceProofStatus;
  invoiceStatus: InvoiceStatus;
  orderStatus: string;
  /** 订单结算方式：corporate 对公（需开票）/ personal 对私（无需开票） */
  settlementType: string;
  /** 订单所属收款/开票公司；历史订单可能为空 */
  companyId: number | null;
  companyName: string;
  updatedAt: string;
  /** 订单成本完整时给出成本与毛利；否则为 null，UI 显示成本待补。 */
  costCents: number | null;
  profitCents: number | null;
  costComplete: boolean;
}

export interface FinanceListStats {
  receivableCents: number;
  receivedCents: number;
  outstandingCents: number;
  refundedCents: number;
  overpaidCents: number;
  pendingProofCount: number;
  pendingInvoiceCount: number;
  profitCents: number;
  profitOrderCount: number;
  costPendingOrderCount: number;
}

export interface FinanceListResult {
  rows: FinanceListRow[];
  total: number;
  page: number;
  pageSize: number;
  stats: FinanceListStats;
}

/** 水单收款页的跨订单水单列表。 */
export interface FinanceProofListRow extends PaymentProofRecord {
  orderNo: string;
  customerName: string;
  orderDate: string;
  settlementType: string;
  companyId: number | null;
  companyName: string;
  url?: string;
}

export interface FinanceProofListFilters {
  month?: string;
  /** 订单渠道；为空表示不限 */
  channel?: OrderChannel;
  companyId?: number | 'unassigned';
  status?: PaymentProofStatus;
  companyIds?: number[];
  includeUnassignedCompany?: boolean;
  statuses?: PaymentProofStatus[];
  query?: string;
  limit?: number;
}

/** 水单页按订单号定位订单时返回的轻量订单信息。 */
export interface FinanceOrderLookupRow {
  orderId: number;
  orderNo: string;
  customerName: string;
  recipientName: string;
  orderDate: string;
  settlementType: string;
  companyId: number | null;
  companyName: string;
  /** 订单金额（不是应收快照），用于按金额查找 */
  amountCents: number;
  receivableCents: number;
  receivedCents: number;
  outstandingCents: number;
  refundedCents: number;
  overpaidCents: number;
  paymentStatus: FinancePaymentStatus;
  proofStatus: FinanceProofStatus;
  invoiceStatus: InvoiceStatus;
}

function assertCents(value: number, field: string, allowNegative = false): void {
  if (!Number.isSafeInteger(value) || (!allowNegative && value < 0)) {
    throw new Error(`${field}必须是${allowNegative ? '' : '非负'}安全整数分`);
  }
}

/** 返回 YYYY-MM 格式的月份字符串（默认当前月） */
export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function calculateOutstandingCents(receivableCents: number, receivedCents: number): number {
  assertCents(receivableCents, '应收金额');
  assertCents(receivedCents, '已收金额');
  return receivableCents - receivedCents;
}

/** 超收金额：已收超过应收的部分；未超收为 0。未收金额仍允许为负数，兼容按客户汇总的账期抵扣。 */
export function calculateOverpaidCents(receivableCents: number, receivedCents: number): number {
  assertCents(receivableCents, '应收金额');
  assertCents(receivedCents, '已收金额');
  return Math.max(0, receivedCents - receivableCents);
}

export function deriveFinancePaymentStatus(receivableCents: number, receivedCents: number): FinancePaymentStatus {
  assertCents(receivableCents, '应收金额');
  assertCents(receivedCents, '已收金额');
  if (receivedCents === 0) return 'unpaid';
  if (receivedCents < receivableCents) return 'partial';
  if (receivedCents === receivableCents) return 'paid';
  return 'overpaid';
}

/** 发货前的收款校验：应收 ≤ 0 视为无需收款；已收达到应收取可发货，超付也算。 */
export function isOrderPaymentCleared(receivableCents: number, receivedCents: number): boolean {
  return receivableCents <= 0 || receivedCents >= receivableCents;
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
