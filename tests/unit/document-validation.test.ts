import { describe, expect, it } from 'vitest';
import { validateDocumentLines, validateTaxRateBps } from '../../src/shared/document-validation';
import type {
  CompanySnapshot,
  PaymentStatus,
  QuotationStatus,
  SalesDocumentStatus,
} from '../../src/shared/documents';

const quotationStatuses = ['draft', 'sent', 'won', 'expired'] satisfies QuotationStatus[];
const salesDocumentStatuses = ['draft', 'issued', 'void'] satisfies SalesDocumentStatus[];
const paymentStatuses = ['unpaid', 'partial', 'paid'] satisfies PaymentStatus[];

describe('document validation', () => {
  it('keeps stable document status and company snapshot contracts', () => {
    const company: CompanySnapshot = {
      name: '示例公司',
      logoRelativePath: null,
      phone: '13800000000',
      address: '深圳',
      defaultIssuer: '高先生',
    };

    expect(quotationStatuses).toEqual(['draft', 'sent', 'won', 'expired']);
    expect(salesDocumentStatuses).toEqual(['draft', 'issued', 'void']);
    expect(paymentStatuses).toEqual(['unpaid', 'partial', 'paid']);
    expect(company.logoRelativePath).toBeNull();
  });

  it('rejects empty lines and negative values', () => {
    expect(() => validateDocumentLines([])).toThrow('至少需要一行产品');
    expect(() => validateDocumentLines([{ name: 'A', quantity: -1, unitPriceCents: 100 }])).toThrow('数量不能小于 0');
    expect(() => validateDocumentLines([{ name: 'A', quantity: 1, unitPriceCents: -1 }])).toThrow('单价不能小于 0');
  });

  it('rejects malformed line values and missing product names', () => {
    expect(() => validateDocumentLines([{ name: 'A', quantity: Number.NaN, unitPriceCents: 100 }])).toThrow('数量必须是有效数字');
    expect(() => validateDocumentLines([{ name: 'A', quantity: 1, unitPriceCents: 1.5 }])).toThrow('单价必须是整数分');
    expect(() => validateDocumentLines([{ name: '  ', quantity: 1, unitPriceCents: 100 }])).toThrow('产品名称不能为空');
  });

  it('accepts 0 to 100 percent tax in basis points', () => {
    expect(validateTaxRateBps(0)).toBe(0);
    expect(validateTaxRateBps(1300)).toBe(1300);
    expect(validateTaxRateBps(10000)).toBe(10000);
    expect(() => validateTaxRateBps(-1)).toThrow('税率不能小于 0');
    expect(() => validateTaxRateBps(10001)).toThrow('税率不能超过 100%');
  });
});
