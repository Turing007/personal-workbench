import type { OrderDraft, OrderStatus } from './components/OrderForm';

export type OrderNextAction =
  | { kind: 'advance'; label: string; target: OrderStatus }
  | { kind: 'shipping'; label: string }
  | { kind: 'publish'; label: string };

const actions: Partial<Record<OrderStatus, OrderNextAction>> = {
  draft: { kind: 'publish', label: '发布订单' },
  label_pending: { kind: 'advance', label: '进入备货', target: 'pending_stock' },
  pending_stock: { kind: 'advance', label: '确认已备货', target: 'stock_reported' },
  stock_reported: { kind: 'advance', label: '开始打包', target: 'pending_packing' },
  pending_packing: { kind: 'advance', label: '完成打包', target: 'ship_pending' },
  ship_pending: { kind: 'shipping', label: '去发货' },
};

export function getOrderNextAction(status?: OrderStatus): OrderNextAction | undefined {
  return status ? actions[status] : undefined;
}

export function isUnshippedOrder(order: OrderDraft): boolean {
  return order.status !== 'shipped';
}

/** 草稿订单：不参与箱唛打印、发货等正式流程操作。 */
export function isDraftOrder(order: Pick<OrderDraft, 'status'>): boolean {
  return order.status === 'draft';
}
