export const ORDER_STATUS_SEQUENCE = [
  'label_pending',
  'pending_stock',
  'stock_reported',
  'pending_packing',
  'ship_pending',
  'shipped',
] as const;

export type OrderStatus = (typeof ORDER_STATUS_SEQUENCE)[number];

/**
 * 订单草稿状态：不属于正式流程序列，仅允许 draft → pending_stock（发布）。
 * 独立定义避免把 draft 混入 ORDER_STATUS_SEQUENCE，影响既有索引推导逻辑。
 */
export const ORDER_DRAFT_STATUS = 'draft' as const;

/** 全量订单状态（含草稿），供类型与展示标签使用。 */
export type AnyOrderStatus = OrderStatus | typeof ORDER_DRAFT_STATUS;

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  label_pending: '待打印箱唛',
  pending_stock: '待备货',
  stock_reported: '已备货',
  pending_packing: '待打包',
  ship_pending: '待发货',
  shipped: '已发货',
};

export const ORDER_STATUS_LABELS_WITH_DRAFT: Record<AnyOrderStatus, string> = {
  ...ORDER_STATUS_LABELS,
  [ORDER_DRAFT_STATUS]: '草稿',
};

/**
 * 发货工作区可见范围：只要还没发货就能进来提前录物流单号。
 * 草稿不算（信息可能不全），已发货排除；真正「确认发货」仍只对 ship_pending 生效。
 */
export function isUnshippedStatus(status: unknown): boolean {
  return status !== ORDER_DRAFT_STATUS && status !== 'shipped';
}

export function isDraftStatus(status: unknown): status is typeof ORDER_DRAFT_STATUS {
  return status === ORDER_DRAFT_STATUS;
}

export type TransitionReason = 'manual' | 'first-print';

export interface StatusTransitionContext {
  reason?: TransitionReason;
  trackingNo?: string | null;
}

export interface PackagingOption {
  id?: string;
  name: string;
  outerLength?: number;
  outerWidth?: number;
  outerHeight?: number;
  outerWeight?: number;
  packCount: number;
}

export interface CustomerProductSnapshot {
  customerProductId?: string;
  productName: string;
  sku: string;
  spec: string;
  packaging: PackagingOption[];
  remark?: string;
}

export interface OrderItemSnapshot extends CustomerProductSnapshot {
  id?: string;
  orderId?: string;
  quantity: number;
  packSizes: number[];
  lineRemark?: string;
}

export interface CartonLabelItem {
  sku: string;
  productName: string;
  spec: string;
  quantity: number;
  packSize: number;
}

export interface CartonLabel {
  id: string;
  orderId: string;
  orderNo: string;
  recipientName: string;
  cartonNo: number;
  totalCartons: number;
  items: CartonLabelItem[];
  printedAt?: string;
  manuallyEdited?: boolean;
}

export interface ShippingRow {
  totalCartons: number;
  shippingInfo: string;
}

export interface PaymentProof {
  id: string;
  relativePath: string;
  originalName: string;
  note: string;
  createdAt: string;
}

export interface Order {
  id: string;
  orderNo: string;
  orderTime: string;
  recipientName: string;
  shippingInfo: string;
  amount: number;
  trackingNo: string;
  status: OrderStatus;
  note: string;
}

export function canTransition(
  from: OrderStatus,
  to: OrderStatus,
  context: StatusTransitionContext = {},
): boolean {
  const fromIndex = ORDER_STATUS_SEQUENCE.indexOf(from);
  const toIndex = ORDER_STATUS_SEQUENCE.indexOf(to);

  if (fromIndex < 0 || toIndex !== fromIndex + 1) return false;
  if (context.reason !== 'manual') return false;
  if (from === 'ship_pending' && to === 'shipped') {
    return Boolean(context.trackingNo?.trim());
  }
  return true;
}

/**
 * 草稿订单的合法流转：仅允许发布（draft → pending_stock）。
 */
export function canDraftTransition(
  from: AnyOrderStatus,
  to: OrderStatus,
): boolean {
  return from === ORDER_DRAFT_STATUS && to === 'pending_stock';
}

export function getTransitionError(
  from: OrderStatus,
  to: OrderStatus,
  context: StatusTransitionContext = {},
): string | null {
  if (from === to) return '订单状态未发生变化';

  const fromIndex = ORDER_STATUS_SEQUENCE.indexOf(from);
  const toIndex = ORDER_STATUS_SEQUENCE.indexOf(to);
  if (fromIndex < 0 || toIndex !== fromIndex + 1) {
    return '订单状态只能按流程顺序逐步推进';
  }

  if (context.reason !== 'manual') {
    return '该状态推进必须由用户手动操作';
  }
  if (from === 'ship_pending' && to === 'shipped' && !context.trackingNo?.trim()) {
    return '确认已发货前必须填写物流单号';
  }
  return canTransition(from, to, context) ? null : '当前条件不满足状态推进要求';
}
