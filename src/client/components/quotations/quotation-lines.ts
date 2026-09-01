import type { DocumentImageDraft, DocumentItemDraft } from '../../documents/document-drafts';
import { createDocumentClientKey } from '../../documents/document-drafts';
import { resolveTierUnitPriceCents } from '../../../shared/money';

export interface QuotationLineDraft extends DocumentItemDraft {
  image: DocumentImageDraft & { previewUrl?: string };
}

export function emptyLine(): QuotationLineDraft {
  return {
    clientKey: createDocumentClientKey('quotation-line'),
    productId: null,
    customerProductId: null,
    isTemporary: true,
    productCode: '',
    name: '',
    sku: '',
    specification: '',
    parameters: '',
    packCount: '',
    image: { relativePath: null, originalName: '', mimeType: '' },
    quantity: '1',
    unitPrice: '',
    priceTiers: [],
    remark: '',
  };
}

export function parseNonNegative(value: string): number | null {
  if (!value.trim()) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parseTiers(item: QuotationLineDraft): Array<{ minQuantity: number; maxQuantity: number | null; unitPriceCents: number }> {
  return (item.priceTiers ?? [])
    .filter((tier) => tier.minQuantity.trim() || tier.maxQuantity.trim() || tier.unitPrice.trim())
    .map((tier) => ({
      minQuantity: Number(tier.minQuantity || 0),
      maxQuantity: tier.maxQuantity.trim() ? Number(tier.maxQuantity) : null,
      unitPriceCents: Math.max(0, Math.round((parseNonNegative(tier.unitPrice) ?? 0) * 100)),
    }));
}

export function lineUnitPriceCents(item: QuotationLineDraft): number {
  // 报价单不含数量：区间价仅作为价格档位展示，行价格按数量 1 解析。
  const baseCents = Math.max(0, Math.round((parseNonNegative(item.unitPrice) ?? 0) * 100));
  return resolveTierUnitPriceCents(parseTiers(item), 1, baseCents);
}

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(cents / 100);
}

/** 校验产品行内容与数量区间价，返回错误文案；合法时返回 null。 */
export function validateQuotationLines(items: QuotationLineDraft[]): string | null {
  if (!items.length) return '至少需要一行产品';
  const invalidIndex = items.findIndex((item) => !item.name.trim() || parseNonNegative(item.unitPrice) === null);
  if (invalidIndex >= 0) return `第 ${invalidIndex + 1} 行产品信息或单价无效`;
  const invalidTier = items.some((item) => (item.priceTiers ?? []).some((tier) => {
    if (!tier.minQuantity.trim() && !tier.maxQuantity.trim() && !tier.unitPrice.trim()) return false;
    const min = Number(tier.minQuantity);
    const max = tier.maxQuantity.trim() ? Number(tier.maxQuantity) : null;
    const price = Number(tier.unitPrice);
    return !Number.isFinite(min) || min < 0
      || (max !== null && (!Number.isFinite(max) || max < min))
      || !Number.isFinite(price) || price < 0;
  }));
  if (invalidTier) return '数量区间价填写无效：区间数量需为非负数字、截止数量不小于起始数量、单价需为非负数字';
  const nonIncreasingTier = items.some((item) => {
    const mins = (item.priceTiers ?? [])
      .filter((tier) => tier.minQuantity.trim())
      .map((tier) => Number(tier.minQuantity))
      .sort((a, b) => a - b);
    return mins.some((min, index) => index > 0 && min <= mins[index - 1]);
  });
  if (nonIncreasingTier) return '数量区间的起始数量必须从小到大递增（例如 1~99、100~499、500+）';
  return null;
}
