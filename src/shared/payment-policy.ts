/**
 * 客户付款方式：先款后货（收定金才能发布、收全款才能备货）、
 * 发货前付清（默认，沿用现有全额收款门槛）、账期（可先发货，按账期对账）。
 */
export type PaymentPolicy = 'prepay' | 'before_ship' | 'credit';

export const PAYMENT_POLICY_LABELS: Record<PaymentPolicy, string> = {
  prepay: '先款后货',
  before_ship: '发货前付清',
  credit: '账期',
};

export const PAYMENT_POLICY_OPTIONS: Array<{ value: PaymentPolicy; label: string; hint: string }> = [
  { value: 'prepay', label: '先款后货', hint: '收定金才能发布，收全款才能备货' },
  { value: 'before_ship', label: '发货前付清', hint: '可先备货打包，发货前必须收齐全款' },
  { value: 'credit', label: '账期', hint: '可先发货，按账期对账收款' },
];

export function normalizePaymentPolicy(value: unknown, fallback: PaymentPolicy = 'before_ship'): PaymentPolicy {
  return value === 'prepay' || value === 'before_ship' || value === 'credit' ? value : fallback;
}

/** 定金金额：应收金额 × 定金比例，四舍五入到分。 */
export function depositCents(receivableCents: number, depositPercent: number): number {
  const percent = Math.min(100, Math.max(0, Math.trunc(Number(depositPercent) || 0)));
  return Math.round(Math.max(0, Number(receivableCents) || 0) * percent / 100);
}

/** 账期到期日 = 最后一次发货日期 + 账期天数（按北京时间的日期，YYYY-MM-DD）。 */
export function paymentDueDate(lastShippedAt: string, creditDays: number): string {
  if (!lastShippedAt) return '';
  const base = new Date(lastShippedAt);
  if (Number.isNaN(base.getTime())) return '';
  const days = Math.max(0, Math.trunc(Number(creditDays) || 0));
  return new Date(base.getTime() + (days * 24 + 8) * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 今天（北京时间）距离到期日还有几天：正数未到期，负数已逾期。 */
export function daysUntilDue(dueDate: string, today = new Date()): number | null {
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T00:00:00+08:00`);
  if (Number.isNaN(due.getTime())) return null;
  const startOfToday = new Date(new Date(today.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) + 'T00:00:00+08:00');
  return Math.round((due.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000));
}

/** 付款方式的完整展示文案，例如「先款后货（定金 30%）」「账期 30 天」。 */
export function paymentPolicySummary(policy: PaymentPolicy, depositPercent = 0, creditDays = 0): string {
  if (policy === 'prepay') return depositPercent > 0 ? `先款后货（定金 ${depositPercent}%）` : '先款后货（收全款）';
  if (policy === 'credit') return creditDays > 0 ? `账期 ${creditDays} 天` : '账期';
  return '发货前付清';
}
