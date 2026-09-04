import { describe, expect, it } from 'vitest';
import { getBatchAdvancePlan, getOrderNextAction, isDraftOrder, type BatchAdvanceAction } from '../../src/client/order-workflow';
import type { OrderStatus } from '../../src/client/components/OrderForm';

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

describe('订单批量操作分类', () => {
  function order(orderNo: string, status: OrderStatus, trackingNo = '') {
    return { orderNo, status, trackingNo };
  }

  function run(action: BatchAdvanceAction, orders: Array<{ orderNo: string; status: OrderStatus; trackingNo?: string }>) {
    return getBatchAdvancePlan(orders.map((item) => ({ ...item, trackingNo: item.trackingNo ?? '' })), action);
  }

  it('一键备货只作用于待备货订单，其余跳过', () => {
    const plan = run('stock', [
      order('SO-1', 'pending_stock'),
      order('SO-2', 'stock_reported'),
      order('SO-3', 'shipped'),
    ]);
    expect(plan.targets.map((target) => [target.order.orderNo, target.steps])).toEqual([['SO-1', ['stock_reported']]]);
    expect(plan.skipped.map((item) => item.orderNo)).toEqual(['SO-2', 'SO-3']);
  });

  it('一键打包把已备货订单经过待打包推进到待发货', () => {
    const plan = run('pack', [
      order('SO-1', 'stock_reported'),
      order('SO-2', 'pending_packing'),
    ]);
    expect(plan.targets.map((target) => [target.order.orderNo, target.steps])).toEqual([
      ['SO-1', ['pending_packing', 'ship_pending']],
      ['SO-2', ['ship_pending']],
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it('一键发货要求已填物流单号，缺单号的订单跳过并说明原因', () => {
    const plan = run('ship', [
      order('SO-1', 'ship_pending', 'SF123'),
      order('SO-2', 'ship_pending'),
      order('SO-3', 'pending_packing'),
    ]);
    expect(plan.targets.map((target) => [target.order.orderNo, target.steps])).toEqual([['SO-1', ['shipped']]]);
    expect(plan.skipped).toEqual([
      { orderNo: 'SO-2', reason: '缺少物流单号' },
      { orderNo: 'SO-3', reason: '当前状态不支持该操作' },
    ]);
  });
});
