/**
 * 产品图片分类：按产品归档尺寸图、包装成品图、客拍图，后续同款产品可直接复用。
 * 服务端校验与前端下拉共用这份定义，避免两边各写一份标签。
 */
export const PRODUCT_IMAGE_CATEGORY_SEQUENCE = ['product', 'dimension', 'packaging', 'customer', 'other'] as const;

export type ProductImageCategory = (typeof PRODUCT_IMAGE_CATEGORY_SEQUENCE)[number];

export const PRODUCT_IMAGE_CATEGORY_LABELS: Record<ProductImageCategory, string> = {
  product: '产品图',
  dimension: '尺寸图',
  packaging: '包装图',
  customer: '客拍图',
  other: '其他',
};

export const DEFAULT_PRODUCT_IMAGE_CATEGORY: ProductImageCategory = 'product';

/** 备注用于记录拍摄背景，例如“客户A 2026-03 要求补拍侧面”。 */
export const MAX_PRODUCT_IMAGE_NOTE_LENGTH = 200;

export function isProductImageCategory(value: unknown): value is ProductImageCategory {
  return typeof value === 'string' && (PRODUCT_IMAGE_CATEGORY_SEQUENCE as readonly string[]).includes(value);
}

/** 历史图片没有分类，展示与保存时统一回落到“产品图”。 */
export function normalizeProductImageCategory(value: unknown): ProductImageCategory {
  return isProductImageCategory(value) ? value : DEFAULT_PRODUCT_IMAGE_CATEGORY;
}

export function productImageCategoryLabel(value: unknown): string {
  return PRODUCT_IMAGE_CATEGORY_LABELS[normalizeProductImageCategory(value)];
}

export const PRODUCT_IMAGE_CATEGORY_OPTIONS = PRODUCT_IMAGE_CATEGORY_SEQUENCE.map((value) => ({
  value,
  label: PRODUCT_IMAGE_CATEGORY_LABELS[value],
}));
