import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUS_SEQUENCE,
  canTransition,
  getTransitionError,
  type OrderStatus,
} from '../../src/shared/domain';

describe('订单状态流转', () => {
  it('保持确认的状态顺序', () => {
    expect(ORDER_STATUS_SEQUENCE).toEqual([
      'label_pending',
      'pending_stock',
      'stock_reported',
      'pending_packing',
      'ship_pending',
      'shipped',
    ] satisfies OrderStatus[]);
  });

  it('旧待打印箱唛状态仍可手动兼容推进到待备货', () => {
    expect(canTransition('label_pending', 'pending_stock', { reason: 'manual' })).toBe(true);
    expect(canTransition('label_pending', 'pending_stock')).toBe(false);
    expect(getTransitionError('label_pending', 'pending_stock', { reason: 'manual' })).toBeNull();
  });

  it('已备货不会自动跳到待打包或待发货', () => {
    expect(canTransition('pending_stock', 'stock_reported', { reason: 'manual' })).toBe(true);
    expect(canTransition('stock_reported', 'pending_packing', { reason: 'manual' })).toBe(true);
    expect(canTransition('stock_reported', 'ship_pending', { reason: 'manual' })).toBe(false);
    expect(canTransition('stock_reported', 'ship_pending')).toBe(false);
  });

  it('待发货只有在物流单号非空时才能变为已发货', () => {
    expect(canTransition('ship_pending', 'shipped', { reason: 'manual', trackingNo: '  ' })).toBe(false);
    expect(canTransition('ship_pending', 'shipped', { reason: 'manual' })).toBe(false);
    expect(canTransition('ship_pending', 'shipped', { reason: 'manual', trackingNo: 'SF123456' })).toBe(true);
    expect(getTransitionError('ship_pending', 'shipped', { reason: 'manual' })).toContain('物流单号');
  });

  it('不允许跳过中间状态或反向流转', () => {
    expect(canTransition('label_pending', 'stock_reported', { reason: 'manual' })).toBe(false);
    expect(canTransition('pending_packing', 'stock_reported', { reason: 'manual' })).toBe(false);
    expect(canTransition('shipped', 'ship_pending', { reason: 'manual' })).toBe(false);
  });
});
