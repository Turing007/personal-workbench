import { describe, expect, it } from 'vitest';
import { getCustomerProductCompletionStatus } from '../../src/shared/customers';

describe('客户产品完善状态', () => {
  it('最终价格、SKU、装箱数全部存在时为已完善', () => {
    expect(getCustomerProductCompletionStatus({
      sku: 'ZS-001',
      packCount: 24,
      finalPriceCents: 25900,
    })).toBe('complete');
  });

  it.each([
    { sku: '', packCount: 24, finalPriceCents: 25900 },
    { sku: 'ZS-001', packCount: null, finalPriceCents: 25900 },
    { sku: 'ZS-001', packCount: 24, finalPriceCents: null },
  ])('任一人工字段缺失时为待完善', (input) => {
    expect(getCustomerProductCompletionStatus(input)).toBe('incomplete');
  });
});
