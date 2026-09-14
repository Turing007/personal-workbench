import { describe, expect, it } from 'vitest';
import { compareProductBySku } from '../../src/client/product-sort';
import type { ProductRecord } from '../../src/client/components/ProductEditor';

function product(overrides: Partial<ProductRecord> & { sku: string; name: string }): ProductRecord {
  return {
    id: overrides.id ?? '1',
    sku: overrides.sku,
    name: overrides.name,
    specification: '',
    category: '',
    purchasePrice: '',
    supplier: '',
    parameters: '',
    status: 'active',
    colors: [],
    batteryPlugs: [],
    images: [],
    attachments: [],
    accessories: '',
    remark: '',
    packaging: [],
    ...overrides,
  } as ProductRecord;
}

describe('产品库按 SKU 排序', () => {
  it('按 SKU 升序，且数字部分按自然序（SKU-2 在 SKU-10 前）', () => {
    const list = [
      product({ sku: 'SKU-10', name: '十' }),
      product({ sku: 'SKU-2', name: '二' }),
      product({ sku: 'ABC-1', name: '甲' }),
    ];
    expect([...list].sort(compareProductBySku).map((item) => item.sku)).toEqual(['ABC-1', 'SKU-2', 'SKU-10']);
  });

  it('未填 SKU 的排在最后，并按其品名排序', () => {
    const list = [
      product({ sku: '', name: '乙草稿' }),
      product({ sku: 'B-2', name: '乙' }),
      product({ sku: '  ', name: '甲草稿' }),
    ];
    expect([...list].sort(compareProductBySku).map((item) => item.name)).toEqual(['乙', '甲草稿', '乙草稿']);
  });

  it('SKU 相同（含大小写差异）时按品名兜底', () => {
    const list = [
      product({ sku: 'mk-1', name: 'C 产品' }),
      product({ sku: 'MK-1', name: 'A 产品' }),
      product({ sku: 'MK-1', name: 'B 产品' }),
    ];
    const sorted = [...list].sort(compareProductBySku);
    expect(sorted.map((item) => item.name)).toEqual(['A 产品', 'B 产品', 'C 产品']);
  });
});
