import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRODUCT_IMAGE_CATEGORY,
  MAX_PRODUCT_IMAGE_NOTE_LENGTH,
  PRODUCT_IMAGE_CATEGORY_LABELS,
  PRODUCT_IMAGE_CATEGORY_OPTIONS,
  PRODUCT_IMAGE_CATEGORY_SEQUENCE,
  isProductImageCategory,
  normalizeProductImageCategory,
  productImageCategoryLabel,
} from '../../src/shared/product-image-categories';

describe('产品图片分类', () => {
  it('分类顺序固定为产品图、尺寸图、包装图、客拍图、其他', () => {
    expect(PRODUCT_IMAGE_CATEGORY_SEQUENCE).toEqual(['product', 'dimension', 'packaging', 'customer', 'other']);
    expect(DEFAULT_PRODUCT_IMAGE_CATEGORY).toBe('product');
  });

  it('每个分类都有中文标签，下拉选项与顺序一致', () => {
    for (const category of PRODUCT_IMAGE_CATEGORY_SEQUENCE) {
      expect(PRODUCT_IMAGE_CATEGORY_LABELS[category]).toBeTruthy();
    }
    expect(PRODUCT_IMAGE_CATEGORY_OPTIONS.map((option) => option.value)).toEqual([...PRODUCT_IMAGE_CATEGORY_SEQUENCE]);
    expect(PRODUCT_IMAGE_CATEGORY_OPTIONS[1]).toEqual({ value: 'dimension', label: '尺寸图' });
  });

  it('只认已知分类，历史数据与脏值一律回落到精修图（product）', () => {
    expect(isProductImageCategory('customer')).toBe(true);
    expect(isProductImageCategory('')).toBe(false);
    expect(isProductImageCategory(undefined)).toBe(false);
    expect(isProductImageCategory('尺寸图')).toBe(false);

    expect(normalizeProductImageCategory('dimension')).toBe('dimension');
    expect(normalizeProductImageCategory(undefined)).toBe('product');
    expect(normalizeProductImageCategory('未知分类')).toBe('product');
    expect(productImageCategoryLabel('other')).toBe('其他');
    expect(productImageCategoryLabel(null)).toBe('精修图');
  });

  it('备注长度上限为 200 字', () => {
    expect(MAX_PRODUCT_IMAGE_NOTE_LENGTH).toBe(200);
  });
});
