import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { renderQuotationHtml } from '../../src/server/documents/quotation-template';
import type { QuotationServiceDetail } from '../../src/server/services/quotation-service';

// PDF 模板派生图护栏（重构方案第 4 步）：
// 内联 480px 派生图而非原图；派生图不可用时回退原图，导出不中断。

function makeQuotation(imagePath: string | null): QuotationServiceDetail {
  return {
    id: 1,
    number: 'BJ20261115001',
    status: 'draft',
    quotationDate: '2026-11-15',
    customerId: null,
    customerName: '测试客户',
    contactName: '',
    contactPhone: '',
    totalCents: 10000,
    itemCount: 1,
    updatedAt: '2026-11-15T00:00:00.000Z',
    customerAddress: '',
    validUntil: '',
    remark: '',
    taxRateBps: 0,
    pricingBasis: 'shipping_ex_tax',
    subtotalCents: 10000,
    taxCents: 0,
    companySnapshot: { name: '测试公司', logoRelativePath: null, phone: '', address: '', defaultIssuer: '', wechatQrRelativePath: null },
    displayConfig: {
      showLogo: false, showCompanyPhone: false, showCompanyAddress: false, showContactPhone: false, showTax: true, showTaxIncludedTotal: true,
      columns: { image: true, name: true, specification: true, unitPrice: true, tierPrice: true, remark: true },
    },
    customerProductsSyncedAt: null,
    items: [{
      id: 1, quotationId: 1, productId: null, customerProductId: null, isTemporary: true,
      name: '带图产品', sku: '', specification: '', parameters: '', packCount: null,
      imageRelativePath: imagePath, unitPriceCents: 10000, priceTiers: [], remark: '', sortOrder: 0,
    }],
    customFields: [],
    createdAt: '2026-11-15T00:00:00.000Z',
    subtotal: 100, tax: 0, total: 100,
  } as unknown as QuotationServiceDetail;
}

describe('报价单 PDF 模板图片内联', () => {
  it('派生图显著小于原图内联，且输出 webp data URL', async () => {
    // 2000×2000 噪点图：模拟手机上传的大图（约 1MB+ JPEG）
    const raw = randomBytes(2000 * 2000 * 3);
    const original = await sharp(raw, { raw: { width: 2000, height: 2000, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
    expect(original.length).toBeGreaterThan(500_000);
    const derivative = await sharp(original).resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();

    const quotation = makeQuotation('quotation-assets/big.jpg');
    const htmlOriginal = await renderQuotationHtml(quotation, { readFile: async () => original });
    const htmlDerivative = await renderQuotationHtml(quotation, {
      readFile: async () => original,
      readImage: async () => derivative,
    });

    expect(htmlOriginal).toContain('data:image/jpeg;base64,');
    expect(htmlDerivative).toContain('data:image/webp;base64,');
    expect(htmlDerivative.length).toBeLessThan(htmlOriginal.length / 5);
  }, 30_000);

  it('派生图不可用时回退原图，导出不中断', async () => {
    const original = await sharp({ create: { width: 80, height: 80, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
    const quotation = makeQuotation('quotation-assets/small.png');
    const html = await renderQuotationHtml(quotation, {
      readFile: async () => original,
      readImage: async () => { throw new Error('THUMBNAIL_UNSUPPORTED'); },
    });
    expect(html).toContain('data:image/png;base64,');
  });

  it('无图片读取器时不内联图片，模板仍正常渲染', async () => {
    const html = await renderQuotationHtml(makeQuotation('quotation-assets/x.jpg'), {});
    expect(html).toContain('BJ20261115001');
    expect(html).not.toContain('data:image');
  });
});