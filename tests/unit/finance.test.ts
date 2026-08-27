import { describe, expect, it } from 'vitest';
import {
  calculateOutstandingCents,
  deriveFinancePaymentStatus,
  deriveInvoiceStatus,
  deriveProofStatus,
  invoiceStatusLabel,
  paymentStatusLabel,
  proofStatusLabel,
  type FinanceInvoice,
} from '../../src/shared/finance';

function invoice(status: FinanceInvoice['status']): Pick<FinanceInvoice, 'status'> {
  return { status };
}

describe('付款状态聚合', () => {
  it('零收款为未付款', () => {
    expect(deriveFinancePaymentStatus(10000, 0)).toBe('unpaid');
    expect(deriveFinancePaymentStatus(0, 0)).toBe('unpaid');
  });

  it('部分收款为部分付款', () => {
    expect(deriveFinancePaymentStatus(10000, 1)).toBe('partial');
    expect(deriveFinancePaymentStatus(10000, 9999)).toBe('partial');
  });

  it('刚好收清为已付款，超过应收为超额付款', () => {
    expect(deriveFinancePaymentStatus(10000, 10000)).toBe('paid');
    expect(deriveFinancePaymentStatus(10000, 15000)).toBe('overpaid');
    expect(deriveFinancePaymentStatus(0, 100)).toBe('overpaid');
  });

  it('拒绝负数和非安全整数分', () => {
    expect(() => deriveFinancePaymentStatus(-1, 0)).toThrow();
    expect(() => deriveFinancePaymentStatus(10000, -5)).toThrow();
    expect(() => deriveFinancePaymentStatus(Number.MAX_SAFE_INTEGER + 1, 0)).toThrow();
    expect(() => deriveFinancePaymentStatus(10.5, 0)).toThrow();
  });
});

describe('水单状态聚合', () => {
  it('没有水单返回无水单', () => {
    expect(deriveProofStatus([])).toBe('none');
  });

  it('存在待审核水单时优先展示待审核', () => {
    expect(deriveProofStatus([{ status: 'approved' }, { status: 'pending' }])).toBe('pending');
  });

  it('无待审核但有驳回时展示有驳回', () => {
    expect(deriveProofStatus([{ status: 'approved' }, { status: 'rejected' }])).toBe('rejected');
  });

  it('只有已审核时展示已审核', () => {
    expect(deriveProofStatus([{ status: 'approved' }])).toBe('approved');
  });

  it('全部作废视为无有效水单', () => {
    expect(deriveProofStatus([{ status: 'void' }])).toBe('none');
  });
});

describe('发票状态聚合', () => {
  it('没有发票返回未申请', () => {
    expect(deriveInvoiceStatus([])).toBe('not_requested');
  });

  it('全部作废返回已作废', () => {
    expect(deriveInvoiceStatus([invoice('void'), invoice('void')])).toBe('void');
  });

  it('按资料不完整、待开票、已开票、已发送的优先级聚合', () => {
    expect(deriveInvoiceStatus([invoice('sent'), invoice('incomplete')])).toBe('incomplete');
    expect(deriveInvoiceStatus([invoice('sent'), invoice('pending_issue')])).toBe('pending_issue');
    expect(deriveInvoiceStatus([invoice('sent'), invoice('issued')])).toBe('issued');
    expect(deriveInvoiceStatus([invoice('sent')])).toBe('sent');
  });

  it('作废发票不阻断其他状态聚合', () => {
    expect(deriveInvoiceStatus([invoice('void'), invoice('pending_issue')])).toBe('pending_issue');
  });
});

describe('金额与标签', () => {
  it('未收金额等于应收减已收，允许负数表示超收', () => {
    expect(calculateOutstandingCents(10000, 4000)).toBe(6000);
    expect(calculateOutstandingCents(10000, 12000)).toBe(-2000);
    expect(() => calculateOutstandingCents(-1, 0)).toThrow();
  });

  it('状态标签与中文文案一一对应', () => {
    expect(paymentStatusLabel('partial')).toBe('部分付款');
    expect(paymentStatusLabel('overpaid')).toBe('超额付款');
    expect(proofStatusLabel('pending')).toBe('待审核');
    expect(proofStatusLabel('none')).toBe('无水单');
    expect(invoiceStatusLabel('not_requested')).toBe('未申请');
    expect(invoiceStatusLabel('sent')).toBe('已发送');
  });
});
