import { INVOICE_STATUS_LABELS, type InvoiceStatus } from './finance.js';

/** 订单结算方式：对公需要开票，对私无需开票。历史订单按对公处理。 */
export type OrderSettlementType = 'corporate' | 'personal';

export const ORDER_SETTLEMENT_LABELS = {
  corporate: '对公',
  personal: '对私',
} as const satisfies Record<OrderSettlementType, string>;

/** 无需开票时展示的发票状态文案（不属于 InvoiceStatus 枚举，仅用于展示层）。 */
export const INVOICE_NOT_REQUIRED_LABEL = '无需开票';

export function isSettlementType(value: unknown): value is OrderSettlementType {
  return value === 'corporate' || value === 'personal';
}

export function isPersonalSettlement(value: unknown): boolean {
  return value === 'personal';
}

/** 结算方式对应的发票需求：对公（含历史空值）需要开票，对私无需开票。 */
export function invoiceRequired(settlementType: unknown): boolean {
  return !isPersonalSettlement(settlementType);
}

/** 发票状态的展示文案：对私订单固定显示「无需开票」，对公订单显示实际发票状态。 */
export function invoiceDisplayLabel(settlementType: unknown, invoiceStatus: string): string {
  if (isPersonalSettlement(settlementType)) return INVOICE_NOT_REQUIRED_LABEL;
  return INVOICE_STATUS_LABELS[invoiceStatus as InvoiceStatus] ?? invoiceStatus;
}
