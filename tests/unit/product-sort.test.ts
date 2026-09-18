import { describe, expect, it } from 'vitest';
import { compareProductByNewest } from '../../src/client/product-sort';
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

describe('产品库按最新排序', () => {
  it('最近更新的排最上面', () => {
    const list = [
      product({ id: '1', sku: 'VT-0001', name: '甲', updatedAt: '2026-09-01T02:00:00.000Z' }),
      product({ id: '2', sku: 'VT-0002', name: '乙', updatedAt: '2026-09-17T02:00:00.000Z' }),
      product({ id: '3', sku: 'VT-0003', name: '丙', updatedAt: '2026-09-09T02:00:00.000Z' }),
    ];
    expect([...list].sort(compareProductByNewest).map((item) => item.name)).toEqual(['乙', '丙', '甲']);
  });

  it('更新时间相同时按 id 倒序，保证批量导入不会乱序', () => {
    const timestamp = '2026-09-18T01:00:00.000Z';
    const list = [
      product({ id: '7', sku: 'VT-0007', name: '第七', updatedAt: timestamp }),
      product({ id: '12', sku: 'VT-0012', name: '第十二', updatedAt: timestamp }),
      product({ id: '9', sku: 'VT-0009', name: '第九', updatedAt: timestamp }),
    ];
    expect([...list].sort(compareProductByNewest).map((item) => item.name)).toEqual(['第十二', '第九', '第七']);
  });

  it('没有更新时间的记录排在最后，并按 id 倒序', () => {
    const list = [
      product({ id: '4', sku: 'VT-0004', name: '缺时间甲' }),
      product({ id: '5', sku: 'VT-0005', name: '有时间', updatedAt: '2026-09-18T01:00:00.000Z' }),
      product({ id: '8', sku: 'VT-0008', name: '缺时间乙', updatedAt: '不是时间' }),
    ];
    expect([...list].sort(compareProductByNewest).map((item) => item.name)).toEqual(['有时间', '缺时间乙', '缺时间甲']);
  });

  it('id 不是数字时退化为字符串倒序，不抛异常', () => {
    const timestamp = '2026-09-18T01:00:00.000Z';
    const list = [
      product({ id: 'a', sku: 'VT-0001', name: '甲', updatedAt: timestamp }),
      product({ id: 'c', sku: 'VT-0003', name: '丙', updatedAt: timestamp }),
      product({ id: 'b', sku: 'VT-0002', name: '乙', updatedAt: timestamp }),
    ];
    expect([...list].sort(compareProductByNewest).map((item) => item.name)).toEqual(['丙', '乙', '甲']);
  });

  it('不改动传入的数组本身', () => {
    const list = [
      product({ id: '1', sku: 'VT-0001', name: '旧', updatedAt: '2026-09-01T02:00:00.000Z' }),
      product({ id: '2', sku: 'VT-0002', name: '新', updatedAt: '2026-09-18T02:00:00.000Z' }),
    ];
    [...list].sort(compareProductByNewest);
    expect(list.map((item) => item.name)).toEqual(['旧', '新']);
  });
});
