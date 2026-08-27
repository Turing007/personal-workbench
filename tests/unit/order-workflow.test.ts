import { describe, expect, it } from 'vitest';
import { getOrderNextAction, isDraftOrder } from '../../src/client/order-workflow';

describe('订单下一步动作', () => {
  it('为备货、打包和发货状态提供明确动作', () => {
    expect(getOrderNextAction('pending_stock')).toEqual({ kind: 'advance', label: '确认已备货', target: 'stock_reported' });
    expect(getOrderNextAction('stock_reported')).toEqual({ kind: 'advance', label: '开始打包', target: 'pending_packing' });
    expect(getOrderNextAction('pending_packing')).toEqual({ kind: 'advance', label: '完成打包', target: 'ship_pending' });
    expect(getOrderNextAction('ship_pending')).toEqual({ kind: 'shipping', label: '去发货' });
  });

  it('已发货订单没有下一步动作', () => {
    expect(getOrderNextAction('shipped')).toBeUndefined();
  });

  it('草稿订单的下一步动作是发布', () => {
    expect(getOrderNextAction('draft')).toEqual({ kind: 'publish', label: '发布订单' });
  });

  it('isDraftOrder 正确识别草稿订单', () => {
    expect(isDraftOrder({ status: 'draft' })).toBe(true);
    expect(isDraftOrder({ status: 'pending_stock' })).toBe(false);
    expect(isDraftOrder({ status: undefined })).toBe(false);
  });
});
