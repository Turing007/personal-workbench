import { describe, expect, it } from 'vitest';
import type { QuotationDetail, SalesDocumentDetail } from '../../src/shared/documents';
import {
  quotationDetailToDraft,
  quotationDraftToFormData,
  quotationDraftToPayload,
  salesDocumentDetailToDraft,
  salesDocumentDraftToPayload,
  type QuotationDraft,
} from '../../src/client/documents/document-drafts';

const company = { name: '个人工作台', logoRelativePath: null, phone: '', address: '', defaultIssuer: '高先生' };
const quotationDisplay = {
  showLogo: false,
  showCompanyPhone: false,
  showCompanyAddress: false,
  showContactPhone: true,
  showTax: true,
  showTaxIncludedTotal: true,
  columns: { image: true, name: true, sku: true, specification: true, quantity: true, unitPrice: true, amount: true, remark: true },
} as const;

function makeQuotationDraft(file?: File): QuotationDraft {
  return {
    number: '', status: 'draft', quotationDate: '2026-08-09', customerName: ' 华南五金 ', contactName: '', contactPhone: '', customerAddress: '', validUntil: '', remark: '',
    customerId: 12, taxRate: '13.00', subtotal: '9999.99', tax: '100.00', total: '10099.99', companySnapshot: company, displayConfig: quotationDisplay,
    items: [{
      clientKey: 'line-1', productId: null, customerProductId: 34, isTemporary: true, productCode: '', name: ' 临时产品 ', sku: 'TMP', specification: '标准', packCount: '24', quantity: '2', unitPrice: '12.34', remark: '',
      image: { relativePath: 'quotation-assets/history.png', originalName: 'history.png', mimeType: 'image/png', ...(file ? { file } : {}) },
    }],
    customFields: [],
  };
}

describe('document drafts', () => {
  it('builds multipart payload and preserves temporary image client keys', () => {
    const file = new File(['image'], 'temporary.png', { type: 'image/png' });
    const form = quotationDraftToFormData(makeQuotationDraft(file));
    const payload = JSON.parse(String(form.get('payload')));

    expect(payload.items[0]).toMatchObject({ clientKey: 'line-1', unitPriceCents: 1234, imageRelativePath: null });
    expect(form.get('itemImage.line-1')).toBeInstanceOf(File);
  });

  it('does not submit client-side calculated totals as trusted values', () => {
    const payload = quotationDraftToPayload(makeQuotationDraft());
    expect(payload.customerName).toBe('华南五金');
    expect(payload.taxRateBps).toBe(1300);
    expect(payload).not.toHaveProperty('subtotal');
    expect(payload).not.toHaveProperty('tax');
    expect(payload).not.toHaveProperty('total');
    expect(payload.items[0].imageRelativePath).toBe('quotation-assets/history.png');
  });

  it('maps quotation API cents to strings and retains snapshot paths', () => {
    const detail: QuotationDetail = {
      id: 1, number: 'BJ20260809001', status: 'sent', quotationDate: '2026-08-09', customerId: 12, customerName: '客户', contactName: '', contactPhone: '', customerAddress: '', validUntil: '', remark: '',
      taxRateBps: 1300, subtotalCents: 2468, taxCents: 321, totalCents: 2789, companySnapshot: company, displayConfig: quotationDisplay,
      items: [{ id: 2, quotationId: 1, productId: null, customerProductId: 34, isTemporary: true, name: '产品', sku: '', specification: '', parameters: '参数', packCount: 24, imageRelativePath: 'quotation-assets/old.webp', quantity: 2, unitPriceCents: 1234, amountCents: 2468, remark: '', sortOrder: 0 }],
      customFields: [], createdAt: '2026-08-09T00:00:00.000Z', updatedAt: '2026-08-09T00:00:00.000Z',
    };
    const draft = quotationDetailToDraft(detail);
    expect(draft).toMatchObject({ customerId: 12, taxRate: '13.00', subtotal: '24.68', tax: '3.21', total: '27.89' });
    expect(draft.items[0]).toMatchObject({ clientKey: 'quotation-2', customerProductId: 34, packCount: '24', unitPrice: '12.34', image: { relativePath: 'quotation-assets/old.webp' } });
    expect(quotationDraftToPayload(draft).items[0]).toMatchObject({ customerProductId: 34, packCount: 24 });
  });

  it('maps sales amounts and omits server-calculated payment totals on save', () => {
    const displayConfig = {
      showLogo: false, showCompanyPhone: false, showCompanyAddress: false, showProductImages: false,
      columns: { productCode: true, productName: true, specification: true, quantity: true, unitPrice: true, amount: true, remark: true },
    } as const;
    const detail: SalesDocumentDetail = {
      id: 3, number: 'XS20260809001', documentStatus: 'issued', paymentStatus: 'partial', documentDate: '2026-08-09', customerName: '客户', purchaseOrderNo: 'PO-1', totalCents: 11300, outstandingCents: 6300, updatedAt: '2026-08-09',
      contactName: '', contactPhone: '', customerAddress: '', shippingCents: 100, subtotalCents: 10000, taxRateBps: 1200, taxCents: 1200, receivedCents: 5000, issuer: '高先生', consignee: '', remark: '', companySnapshot: company, displayConfig, sourceQuotationId: null,
      items: [{ id: 4, salesDocumentId: 3, productId: 1, customerProductId: 34, isTemporary: false, name: '产品', sku: 'SKU', specification: '规格', parameters: '', packCount: 24, imageRelativePath: 'sales-document-assets/old.png', quantity: 1, unitPriceCents: 10000, amountCents: 10000, remark: '', sortOrder: 0 }], receipts: [], createdAt: '2026-08-09',
    };
    const draft = salesDocumentDetailToDraft(detail);
    const payload = salesDocumentDraftToPayload(draft);
    expect(draft).toMatchObject({ shipping: '1.00', received: '50.00', outstanding: '63.00' });
    expect(payload).not.toHaveProperty('receivedCents');
    expect(payload).not.toHaveProperty('outstandingCents');
    expect(payload).not.toHaveProperty('paymentStatus');
    expect(payload.items[0].imageRelativePath).toBe('sales-document-assets/old.png');
    expect(payload.items[0]).toMatchObject({ customerProductId: 34, packCount: 24 });
  });

  it('round trips quotation customer and customer product snapshots into payload', () => {
    const payload = quotationDraftToPayload(makeQuotationDraft());
    expect(payload).toMatchObject({ customerId: 12 });
    expect(payload.items[0]).toMatchObject({ customerProductId: 34, packCount: 24 });
  });
});
