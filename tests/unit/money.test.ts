import { describe, expect, it } from 'vitest';
import {
  calculateDocumentTotals,
  centsToChineseUppercase,
  centsToYuan,
  calculateLineAmountCents,
  derivePaymentStatus,
  calculateOutstandingCents,
  yuanToCents,
} from '../../src/shared/money';

describe('document money', () => {
  it('rounds line amounts and tax in integer cents', () => {
    expect(calculateDocumentTotals([{ quantity: 3, unitPriceCents: 1999 }], 1300, 800)).toEqual({
      subtotalCents: 5997,
      taxCents: 780,
      shippingCents: 800,
      totalCents: 7577,
    });
  });

  it('converts yuan and rounds fractional cents predictably', () => {
    expect(yuanToCents(19.99)).toBe(1999);
    expect(yuanToCents(1.005)).toBe(101);
    expect(centsToYuan(1999)).toBe(19.99);
    expect(calculateLineAmountCents(2.5, 1999)).toBe(4998);
  });

  it('derives payment state and outstanding balance', () => {
    expect(derivePaymentStatus(10000, 0)).toBe('unpaid');
    expect(derivePaymentStatus(10000, 3000)).toBe('partial');
    expect(derivePaymentStatus(10000, 10000)).toBe('paid');
    expect(derivePaymentStatus(10000, 12000)).toBe('paid');
    expect(calculateOutstandingCents(10000, 3000)).toBe(7000);
    expect(calculateOutstandingCents(10000, 12000)).toBe(0);
  });

  it('formats integer and decimal amounts as Chinese uppercase money', () => {
    expect(centsToChineseUppercase(123456)).toBe('壹仟贰佰叁拾肆元伍角陆分');
    expect(centsToChineseUppercase(10005)).toBe('壹佰元零伍分');
    expect(centsToChineseUppercase(10000)).toBe('壹佰元整');
    expect(centsToChineseUppercase(0)).toBe('零元整');
  });
});
