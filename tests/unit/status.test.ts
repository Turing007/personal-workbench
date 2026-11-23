import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUS_SEQUENCE,
  canRollback,
  canTransition,
  getTransitionError,
  isUnshippedStatus,
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
      'shipping',
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

  it('待发货进入发货中不要求物流单号，发货中确认已发货才要求单号', () => {
    expect(canTransition('ship_pending', 'shipping', { reason: 'manual' })).toBe(true);
    expect(canTransition('ship_pending', 'shipped', { reason: 'manual', trackingNo: 'SF123456' })).toBe(false);
    expect(canTransition('shipping', 'shipped', { reason: 'manual', trackingNo: '  ' })).toBe(false);
    expect(canTransition('shipping', 'shipped', { reason: 'manual' })).toBe(false);
    expect(canTransition('shipping', 'shipped', { reason: 'manual', trackingNo: 'SF123456' })).toBe(true);
    expect(getTransitionError('shipping', 'shipped', { reason: 'manual' })).toContain('物流单号');
  });

  it('不允许跳过中间状态或反向流转', () => {
    expect(canTransition('label_pending', 'stock_reported', { reason: 'manual' })).toBe(false);
    expect(canTransition('pending_packing', 'stock_reported', { reason: 'manual' })).toBe(false);
    expect(canTransition('shipped', 'ship_pending', { reason: 'manual' })).toBe(false);
  });

  it('只允许撤销最近一次备货/打包/发货动作，已发货不能直接跳过发货中', () => {
    expect(canRollback('stock_reported', 'pending_stock')).toBe(true);
    expect(canRollback('pending_packing', 'stock_reported')).toBe(true);
    expect(canRollback('ship_pending', 'pending_packing')).toBe(true);
    expect(canTransition('ship_pending', 'pending_packing', { reason: 'rollback' })).toBe(true);
    expect(getTransitionError('ship_pending', 'pending_packing', { reason: 'rollback' })).toBeNull();

    expect(canRollback('shipping', 'ship_pending')).toBe(true);
    expect(getTransitionError('shipping', 'ship_pending', { reason: 'rollback' })).toBeNull();
    expect(canRollback('ship_pending', 'stock_reported')).toBe(false);
    expect(canRollback('shipped', 'shipping')).toBe(true);
    expect(canRollback('shipped', 'ship_pending')).toBe(false);
    expect(canRollback('shipped', 'pending_packing')).toBe(false);
    expect(canRollback('pending_stock', 'label_pending')).toBe(false);
    expect(getTransitionError('shipped', 'shipping', { reason: 'rollback' })).toBeNull();
  });

  it('未发货状态包含发货中，草稿与已发货排除在外', () => {
    for (const status of ['label_pending', 'pending_stock', 'stock_reported', 'pending_packing', 'ship_pending', 'shipping'] as OrderStatus[]) {
      expect(isUnshippedStatus(status)).toBe(true);
    }
    expect(isUnshippedStatus('shipped')).toBe(false);
    expect(isUnshippedStatus('draft')).toBe(false);
    expect(isUnshippedStatus(undefined)).toBe(true); // 异常值不屏蔽入口，交由上层按状态展示
  });
});
