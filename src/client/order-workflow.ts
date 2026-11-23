import type { OrderDraft, OrderStatus } from './components/OrderForm';
import { ORDER_STATUS_LABELS, ORDER_ROLLBACK_TARGETS, type OrderStatus as DomainOrderStatus } from '../shared/domain';

export type OrderNextAction =
  | { kind: 'advance'; label: string; target: OrderStatus }
  | { kind: 'shipping-view'; label: string }
  | { kind: 'publish'; label: string };

const actions: Partial<Record<OrderStatus, OrderNextAction>> = {
  draft: { kind: 'publish', label: '发布订单' },
  label_pending: { kind: 'advance', label: '进入备货', target: 'pending_stock' },
  pending_stock: { kind: 'advance', label: '确认已备货', target: 'stock_reported' },
  stock_reported: { kind: 'advance', label: '开始打包', target: 'pending_packing' },
  pending_packing: { kind: 'advance', label: '完成打包', target: 'ship_pending' },
  ship_pending: { kind: 'advance', label: '发货', target: 'shipping' },
  shipping: { kind: 'shipping-view', label: '继续发货' },
};

export function getOrderNextAction(status?: OrderStatus): OrderNextAction | undefined {
  return status ? actions[status] : undefined;
}

export interface OrderRollbackAction {
  label: string;
  target: DomainOrderStatus;
}

/** 撤销最近一次流程动作；白名单由 shared/domain 统一约束，避免前端与服务端漂移。 */
export function getOrderRollbackAction(status?: OrderStatus): OrderRollbackAction | undefined {
  if (!status || status === 'draft') return undefined;
  const target = ORDER_ROLLBACK_TARGETS[status];
  if (!target) return undefined;
  return { label: status === 'shipped' ? '退回发货中' : `回退到${ORDER_STATUS_LABELS[target]}`, target };
}

export function isUnshippedOrder(order: OrderDraft): boolean {
  return order.status !== 'shipped';
}

/** 草稿订单：不参与箱唛打印、发货等正式流程操作。 */
export function isDraftOrder(order: Pick<OrderDraft, 'status'>): boolean {
  return order.status === 'draft';
}

export type BatchAdvanceAction = 'stock' | 'pack' | 'ship';

export type BatchAdvanceOrder = Pick<OrderDraft, 'id' | 'orderNo' | 'status' | 'trackingNo' | 'labelPrintedAt'>
  & Partial<Pick<OrderDraft, 'amount' | 'financeSummary'>>;

export interface BatchAdvanceTarget {
  order: BatchAdvanceOrder;
  /** 需要依次推进的状态序列（状态机每次只允许单步推进，不含草稿）。 */
  steps: Array<Exclude<OrderStatus, 'draft'>>;
}

export interface BatchAdvancePlan {
  targets: BatchAdvanceTarget[];
  skipped: Array<{ orderNo: string; reason: string }>;
}

/**
 * 批量操作分类：
 * - 备货：待备货 → 已备货
 * - 打包：已备货/待打包 → 完成打包推进到待发货（已备货订单会先经过待打包）
 * - 发货：待发货 → 发货中（只推进状态，单号和确认发货在发货中视图完成）
 */
export function getBatchAdvancePlan(
  selected: BatchAdvanceOrder[],
  action: BatchAdvanceAction,
): BatchAdvancePlan {
  const targets: BatchAdvanceTarget[] = [];
  const skipped: Array<{ orderNo: string; reason: string }> = [];
  for (const order of selected) {
    if (action === 'stock' && order.status === 'pending_stock') {
      targets.push({ order, steps: ['stock_reported'] });
    } else if (action === 'pack' && order.status === 'stock_reported') {
      targets.push({ order, steps: ['pending_packing', 'ship_pending'] });
    } else if (action === 'pack' && order.status === 'pending_packing') {
      targets.push({ order, steps: ['ship_pending'] });
    } else if (action === 'ship' && order.status === 'ship_pending') {
      targets.push({ order, steps: ['shipping'] });
    } else {
      skipped.push({ orderNo: order.orderNo, reason: '当前状态不支持该操作' });
    }
  }
  return { targets, skipped };
}
