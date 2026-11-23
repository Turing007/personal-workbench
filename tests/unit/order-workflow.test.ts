import { describe, expect, it } from 'vitest';
import { getBatchAdvancePlan, getOrderNextAction, getOrderRollbackAction, isDraftOrder, type BatchAdvanceAction, type BatchAdvanceOrder } from '../../src/client/order-workflow';
import type { OrderStatus } from '../../src/client/components/OrderForm';

describe('订单下一步动作', () => {
  it('为备货、打包和发货状态提供明确动作', () => {
    expect(getOrderNextAction('pending_stock')).toEqual({ kind: 'advance', label: '确认已备货', target: 'stock_reported' });
    expect(getOrderNextAction('stock_reported')).toEqual({ kind: 'advance', label: '开始打包', target: 'pending_packing' });
    expect(getOrderNextAction('pending_packing')).toEqual({ kind: 'advance', label: '完成打包', target: 'ship_pending' });
    expect(getOrderNextAction('ship_pending')).toEqual({ kind: 'advance', label: '发货', target: 'shipping' });
    expect(getOrderNextAction('shipping')).toEqual({ kind: 'shipping-view', label: '继续发货' });
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

describe('订单状态回退动作', () => {
  it('只给可撤销的业务节点提供回退入口', () => {
    expect(getOrderRollbackAction('stock_reported')).toEqual({ label: '回退到待备货', target: 'pending_stock' });
    expect(getOrderRollbackAction('pending_packing')).toEqual({ label: '回退到已备货', target: 'stock_reported' });
    expect(getOrderRollbackAction('ship_pending')).toEqual({ label: '回退到待打包', target: 'pending_packing' });
    expect(getOrderRollbackAction('shipping')).toEqual({ label: '回退到待发货', target: 'ship_pending' });
    expect(getOrderRollbackAction('shipped')).toEqual({ label: '退回发货中', target: 'shipping' });
    expect(getOrderRollbackAction('pending_stock')).toBeUndefined();
    expect(getOrderRollbackAction('draft')).toBeUndefined();
  });
});

describe('订单批量操作分类', () => {
  function order(orderNo: string, status: OrderStatus, trackingNo = '') {
    return { orderNo, status, trackingNo };
  }

  function run(action: BatchAdvanceAction, orders: BatchAdvanceOrder[]) {
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

  it('一键发货只把待发货推进到发货中，不要求单号和收款', () => {
    const plan = run('ship', [
      order('SO-1', 'ship_pending', 'SF123'),
      order('SO-2', 'ship_pending'),
      order('SO-3', 'pending_packing'),
    ]);
    expect(plan.targets.map((target) => [target.order.orderNo, target.steps])).toEqual([
      ['SO-1', ['shipping']],
      ['SO-2', ['shipping']],
    ]);
    expect(plan.skipped).toEqual([{ orderNo: 'SO-3', reason: '当前状态不支持该操作' }]);
  });

  it('一键发货不受未收款和缺单号影响，统一进入发货中再处理', () => {
    const plan = run('ship', [
      { ...order('SO-1', 'ship_pending', ''), amount: '100', financeSummary: { receivableCents: 10000, receivedCents: 0 } },
      { ...order('SO-2', 'ship_pending', 'SF456'), amount: '100', financeSummary: { receivableCents: 10000, receivedCents: 10000 } },
    ]);
    expect(plan.targets.map((target) => [target.order.orderNo, target.steps])).toEqual([
      ['SO-1', ['shipping']],
      ['SO-2', ['shipping']],
    ]);
    expect(plan.skipped).toEqual([]);
  });
});
