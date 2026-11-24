import { describe, expect, it } from 'vitest';
import {
  daysUntilDue,
  depositCents,
  normalizePaymentPolicy,
  paymentDueDate,
  paymentPolicySummary,
} from '../../src/shared/payment-policy';

describe('付款方式', () => {
  it('未知值回落到发货前付清', () => {
    expect(normalizePaymentPolicy('credit')).toBe('credit');
    expect(normalizePaymentPolicy('prepay')).toBe('prepay');
    expect(normalizePaymentPolicy('other')).toBe('before_ship');
    expect(normalizePaymentPolicy(undefined)).toBe('before_ship');
  });

  it('定金按应收比例四舍五入到分', () => {
    expect(depositCents(100000, 30)).toBe(30000);
    expect(depositCents(99999, 30)).toBe(30000);
    expect(depositCents(100000, 0)).toBe(0);
    expect(depositCents(100000, 120)).toBe(100000);
    expect(depositCents(-5, 30)).toBe(0);
  });

  it('到期日按最后一次发货日期加账期天数（北京时间日期）', () => {
    expect(paymentDueDate('2026-11-20T10:00:00.000Z', 30)).toBe('2026-12-20');
    expect(paymentDueDate('2026-11-20T23:30:00.000Z', 0)).toBe('2026-11-21');
    expect(paymentDueDate('', 30)).toBe('');
  });

  it('逾期天数：正数未到期，负数已逾期', () => {
    expect(daysUntilDue('2026-12-20', new Date('2026-12-10T04:00:00Z'))).toBe(10);
    expect(daysUntilDue('2026-12-01', new Date('2026-12-10T04:00:00Z'))).toBe(-9);
    expect(daysUntilDue('', new Date())).toBeNull();
  });

  it('展示文案带定金比例和账期天数', () => {
    expect(paymentPolicySummary('prepay', 30)).toBe('先款后货（定金 30%）');
    expect(paymentPolicySummary('prepay', 0)).toBe('先款后货（收全款）');
    expect(paymentPolicySummary('credit', 0, 30)).toBe('账期 30 天');
    expect(paymentPolicySummary('before_ship')).toBe('发货前付清');
  });
});
