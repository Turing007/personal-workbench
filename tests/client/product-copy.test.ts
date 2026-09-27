import { describe, expect, it } from 'vitest';
import { cloneProductForNew } from '../../src/client/product-copy';
import type { ProductRecord } from '../../src/client/components/ProductEditor';

function productFixture(): ProductRecord {
  return {
    id: '12',
    name: '测试产品',
    sku: 'VT-0012',
    specification: '标准规格',
    packCount: 10,
    category: '工具',
    purchasePrice: '99',
    supplier: '测试供应商',
    parameters: '参数',
    status: 'active',
    colors: ['蓝'],
    batteryPlugs: ['牧田'],
    accessories: '充电器',
    remark: '备注',
    images: [{ id: '31', name: '产品图.png', url: '/files/product-images/31.png' }],
    attachments: [{ id: '41', category: 'manual', name: '说明书.pdf', url: '/files/product-attachments/41.pdf', mimeType: 'application/pdf', size: 10 }],
    packaging: [{
      id: '21',
      name: '彩盒包装',
      innerSize: '10×10×10cm',
      innerWeight: '1',
      outerSize: '20×20×20cm',
      outerWeight: '2',
      packSize: 10,
      purchasePrice: '3',
      images: [{ id: '51', name: '包装图.png', url: '/files/product-packaging-images/51.png' }],
    }],
    purchaseQuotes: [
      { id: '61', supplier: '测试供应商', variant: '含配件', price: '99', isDefault: true },
      { id: '62', supplier: '另一家', variant: '不含配件', price: '88', isDefault: false },
    ],
  };
}

describe('产品复制草稿', () => {
  it('复制资料和包装但不复用源产品或文件资源', () => {
    const source = productFixture();
    const copy = cloneProductForNew(source);

    expect(copy.id).not.toBe(source.id);
    expect(copy.id).toMatch(/^product-copy-/);
    expect(copy.sku).toBe('');
    expect(copy.status).toBe('active');
    expect(copy.accessories).toBe(source.accessories);
    expect(copy.packaging).toHaveLength(1);
    expect(copy.packaging[0]?.id).not.toBe(source.packaging[0]?.id);
    expect(copy.packaging[0]?.name).toBe(source.packaging[0]?.name);
    expect(copy.images).toEqual([]);
    expect(copy.attachments).toEqual([]);
    expect(copy.packaging[0]?.images).toEqual([]);
    expect(copy.colors).not.toBe(source.colors);
    expect(copy.batteryPlugs).not.toBe(source.batteryPlugs);
    // 报价跟着复制（同款通常同价），但 id 必须换掉，不能沿用源产品的报价行主键。
    expect(copy.purchaseQuotes?.map((quote) => quote.variant)).toEqual(['含配件', '不含配件']);
    expect(copy.purchaseQuotes?.[0]?.isDefault).toBe(true);
    expect(copy.purchaseQuotes?.map((quote) => quote.id)).not.toContain('61');
  });
});
