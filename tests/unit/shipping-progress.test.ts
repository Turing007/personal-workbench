import { describe, expect, it } from 'vitest';
import { getOrderFulfillmentProgress } from '../../src/shared/shipping';

describe('订单发货进度', () => {
  it('未发货、部分发货和全部发完', () => {
    expect(getOrderFulfillmentProgress([{ quantity: 10, shippedQuantity: 0 }])).toMatchObject({
      shippedQuantity: 0, remainingQuantity: 10, isPartiallyShipped: false, isFullyShipped: false,
    });
    expect(getOrderFulfillmentProgress([{ quantity: 10, shippedQuantity: 4 }, { quantity: 5, shippedQuantity: 0 }])).toMatchObject({
      totalQuantity: 15, shippedQuantity: 4, remainingQuantity: 11, shippedItems: 0, isPartiallyShipped: true, isFullyShipped: false,
    });
    expect(getOrderFulfillmentProgress([{ quantity: 10, shippedQuantity: 10 }, { quantity: 5, shippedQuantity: 5 }])).toMatchObject({
      totalQuantity: 15, shippedQuantity: 15, remainingQuantity: 0, shippedItems: 2, isPartiallyShipped: false, isFullyShipped: true,
    });
  });

  it('已发数量不会超过订单数量', () => {
    expect(getOrderFulfillmentProgress([{ quantity: 3, shippedQuantity: 5 }])).toMatchObject({
      shippedQuantity: 3, remainingQuantity: 0, isFullyShipped: true,
    });
  });
});
