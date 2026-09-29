import { describe, expect, it } from 'vitest';
import { compareProductByName } from '../../src/client/product-sort';
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

describe('产品库按品名排序', () => {
  it('中文按拼音序，不是 Unicode 码位序', () => {
    const list = [
      product({ sku: 'VT-0006', name: '直钉锤' }),
      product({ sku: 'VT-0001', name: '暴风机-无刷' }),
      product({ sku: 'VT-0005', name: '中吹-A款' }),
      product({ sku: 'VT-0002', name: '玻璃胶枪' }),
      product({ sku: 'VT-0003', name: '充气泵' }),
      product({ sku: 'VT-0004', name: '圆锯-7寸' }),
    ];
    expect([...list].sort(compareProductByName).map((item) => item.name)).toEqual([
      '暴风机-无刷', '玻璃胶枪', '充气泵', '圆锯-7寸', '直钉锤', '中吹-A款',
    ]);
  });

  it('带数字的品名排在中文前面，数字按数值读法参与比较', () => {
    const list = [
      product({ sku: 'VT-0002', name: '角磨机' }),
      product({ sku: 'VT-0001', name: '40涵道吹' }),
    ];
    expect([...list].sort(compareProductByName).map((item) => item.name)).toEqual(['40涵道吹', '角磨机']);
  });

  it('空名（未命名草稿）统一排最后', () => {
    const list = [
      product({ sku: 'VT-0009', name: '' }),
      product({ sku: 'VT-0008', name: '扳手' }),
      product({ sku: 'VT-0007', name: '  ' }),
    ];
    expect([...list].sort(compareProductByName).map((item) => item.sku)).toEqual(['VT-0008', 'VT-0007', 'VT-0009']);
  });

  it('品名相同时按 SKU 字典序兜底，顺序稳定', () => {
    const list = [
      product({ id: '3', sku: 'VT-0104', name: '单手锯' }),
      product({ id: '1', sku: 'VT-0023', name: '单手锯' }),
      product({ id: '2', sku: 'VT-0090', name: '单手锯' }),
    ];
    expect([...list].sort(compareProductByName).map((item) => item.sku)).toEqual(['VT-0023', 'VT-0090', 'VT-0104']);
  });

  it('品名与 SKU 都相同时按 id 升序，不抛异常', () => {
    const list = [
      product({ id: '12', sku: 'VT-0001', name: '同款' }),
      product({ id: 'a', sku: 'VT-0001', name: '同款' }),
      product({ id: '3', sku: 'VT-0001', name: '同款' }),
    ];
    expect([...list].sort(compareProductByName).map((item) => item.id)).toEqual(['3', '12', 'a']);
  });

  it('不改动传入的数组本身', () => {
    const list = [
      product({ sku: 'VT-0002', name: '乙' }),
      product({ sku: 'VT-0001', name: '甲' }),
    ];
    [...list].sort(compareProductByName);
    expect(list.map((item) => item.name)).toEqual(['乙', '甲']);
  });
});
