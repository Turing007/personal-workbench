import { describe, expect, it } from 'vitest';
import { cloneCustomerProductForNew } from '../../src/client/customer-product-copy';
import type { CustomerProduct } from '../../src/shared/customers';

function sampleProduct(overrides: Partial<CustomerProduct> = {}): CustomerProduct {
  return {
    id: 42,
    customerId: 7,
    systemProductId: 3,
    name: '迷你风扇',
    specification: 'USB款',
    sku: 'CUST-001',
    packCount: 24,
    latestQuoteCents: 25900,
    finalPriceCents: 25900,
    costPriceCents: 15000,
    freightPerBoxCents: 800,
    remark: '客户要求彩盒',
    packaging: [
      { id: 'pack-1', name: '彩盒', innerSize: '10x8x5', innerWeight: 120, outerSize: '50x40x30', outerWeight: 5200, packCount: 24 },
    ],
    attachments: [
      {
        id: 9,
        customerProductId: 42,
        relativePath: 'customer-product-attachments/a.pdf',
        originalName: '说明书.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        createdAt: '2026-08-01T00:00:00.000Z',
        url: '/files/customer-product-attachments/a.pdf',
        category: 'instruction',
      },
    ],
    completionStatus: 'complete',
    sourceQuotationId: 11,
    imageRelativePath: 'customer-product-images/old.webp',
    lastSyncedAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('复制客户产品为新建草稿', () => {
  it('保留资料与包装信息，但断开系统产品关联并清空图片、附件与报价历史', () => {
    const draft = cloneCustomerProductForNew(sampleProduct());

    expect(draft.name).toBe('迷你风扇');
    expect(draft.specification).toBe('USB款');
    expect(draft.sku).toBe('CUST-001');
    expect(draft.packCount).toBe(24);
    expect(draft.finalPriceCents).toBe(25900);
    expect(draft.costPriceCents).toBe(15000);
    expect(draft.freightPerBoxCents).toBe(800);
    expect(draft.remark).toBe('客户要求彩盒');
    expect(draft.packaging).toHaveLength(1);
    expect(draft.packaging[0]).toMatchObject({ name: '彩盒', packCount: 24 });

    expect(draft.id).not.toBe(42);
    expect(draft.systemProductId).toBeNull();
    expect(draft.imageRelativePath).toBeNull();
    expect(draft.attachments).toHaveLength(0);
    expect(draft.latestQuoteCents).toBeNull();
    expect(draft.sourceQuotationId).toBeNull();
    expect(draft.lastSyncedAt).toBeNull();
  });

  it('包装行使用全新的临时 ID，不与原产品共用', () => {
    const source = sampleProduct();
    const draft = cloneCustomerProductForNew(source);

    expect(String(draft.packaging[0].id)).not.toBe(String(source.packaging[0].id));
  });

  it('品名原样保留，不做任何改写', () => {
    expect(cloneCustomerProductForNew(sampleProduct({ name: '迷你风扇（副本）' })).name).toBe('迷你风扇（副本）');
    expect(cloneCustomerProductForNew(sampleProduct({ name: '' })).name).toBe('');
  });

  it('完善状态按草稿自身的关键字段重新计算', () => {
    const draft = cloneCustomerProductForNew(sampleProduct({ sku: '', finalPriceCents: null }));
    expect(draft.completionStatus).toBe('incomplete');
  });
});
