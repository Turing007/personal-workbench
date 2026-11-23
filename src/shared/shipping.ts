export interface ShipmentItemRecord {
  id: number;
  orderItemId: number | null;
  name: string;
  sku: string;
  specification: string;
  packCount: number;
  quantity: number;
  boxes: number;
  remainingAfter: number;
  remark: string;
  sortOrder: number;
}

export interface ShipmentRecord {
  id: number;
  shipmentNo: string;
  orderId: number;
  orderNo: string;
  batchId: number | null;
  batchNo: string;
  trackingNo: string;
  shippedAt: string;
  totalBoxes: number;
  customerName: string;
  recipientName: string;
  recipientInfo: string;
  remark: string;
  companyName: string;
  items: ShipmentItemRecord[];
}

export interface PartialShipmentItemInput {
  orderItemId: number;
  quantity: number;
  boxes?: number;
}

export interface PartialShipmentEntryInput {
  orderId: number;
  trackingNo: string;
  items: PartialShipmentItemInput[];
}

export interface OrderFulfillmentProgress {
  totalQuantity: number;
  shippedQuantity: number;
  remainingQuantity: number;
  totalItems: number;
  shippedItems: number;
  isPartiallyShipped: boolean;
  isFullyShipped: boolean;
}

export function getOrderFulfillmentProgress(
  items: Array<{ quantity: number; shippedQuantity?: number | null }>,
): OrderFulfillmentProgress {
  let totalQuantity = 0;
  let shippedQuantity = 0;
  let shippedItems = 0;
  for (const item of items) {
    const ordered = Math.max(0, Math.trunc(Number(item.quantity) || 0));
    const shipped = Math.min(ordered, Math.max(0, Math.trunc(Number(item.shippedQuantity ?? 0) || 0)));
    totalQuantity += ordered;
    shippedQuantity += shipped;
    if (ordered > 0 && shipped >= ordered) shippedItems += 1;
  }
  const remainingQuantity = Math.max(0, totalQuantity - shippedQuantity);
  return {
    totalQuantity,
    shippedQuantity,
    remainingQuantity,
    totalItems: items.length,
    shippedItems,
    isPartiallyShipped: shippedQuantity > 0 && remainingQuantity > 0,
    isFullyShipped: totalQuantity > 0 && remainingQuantity === 0,
  };
}

/** 单行还能发多少：订单数量减已发数量，最少 0。 */
export function remainingQuantity(item: { quantity: number; shippedQuantity?: number | null }): number {
  return Math.max(0, Math.trunc(Number(item.quantity) || 0) - Math.max(0, Math.trunc(Number(item.shippedQuantity ?? 0) || 0)));
}

/** 本次数量按装箱数折算箱数；0 件不发箱。 */
export function boxesForQuantity(quantity: number, packSize: number): number {
  const count = Math.max(0, Math.trunc(Number(quantity) || 0));
  if (count === 0) return 0;
  return Math.max(1, Math.ceil(count / Math.max(1, Math.trunc(Number(packSize) || 1))));
}

/** 收件地址归一化：去掉所有空白，避免多打一个空格就拆成两个地址。 */
export function normalizeRecipientKey(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, '');
}

export interface ShippingAddressGroup<T> {
  /** 视图内唯一键：合并组用地址键，拆开后每单一个键。 */
  key: string;
  /** 原始地址归一化键，拆开/合并切换时使用；地址为空时为空字符串。 */
  addressKey: string;
  recipientName: string;
  recipientInfo: string;
  split: boolean;
  orders: T[];
}

export interface ShippingGroupableOrder {
  id?: string | number;
  orderNo: string;
  recipientName?: string;
  recipientInfo?: string;
}

function orderIdentity(order: ShippingGroupableOrder): string {
  return String(order.id ?? order.orderNo);
}

/**
 * 按收件地址把发货中订单分组：
 * - 地址去掉空白后相同就合并；
 * - 空地址不合并，避免把「未填收件信息」的错误订单并在一起；
 * - splitAddressKeys 里的地址组拆成单订单卡片，只影响当前页面；
 * - 组内按订单 ID（没有 ID 时按订单号）升序，箱数拆解顺序稳定。
 * 组之间的顺序沿用订单列表顺序。
 */
export function groupShippingOrders<T extends ShippingGroupableOrder>(
  orders: T[],
  splitAddressKeys: Iterable<string> = [],
): Array<ShippingAddressGroup<T>> {
  const split = new Set(splitAddressKeys);
  const groups = new Map<string, ShippingAddressGroup<T>>();
  for (const order of orders) {
    const addressKey = normalizeRecipientKey(order.recipientInfo);
    const mergeKey = addressKey ? `addr:${addressKey}` : `order:${orderIdentity(order)}`;
    const isSplit = Boolean(addressKey) && split.has(addressKey);
    const key = isSplit ? `order:${orderIdentity(order)}` : mergeKey;
    const existing = groups.get(key);
    if (existing) {
      existing.orders.push(order);
      continue;
    }
    groups.set(key, {
      key,
      addressKey,
      recipientName: String(order.recipientName ?? ''),
      recipientInfo: String(order.recipientInfo ?? ''),
      split: isSplit,
      orders: [order],
    });
  }
  return [...groups.values()].map((group) => ({
    ...group,
    orders: [...group.orders].sort((left, right) => {
      const leftId = Number(left.id);
      const rightId = Number(right.id);
      if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) return leftId - rightId;
      return left.orderNo.localeCompare(right.orderNo);
    }),
  }));
}

export interface ShippingSheetEntry {
  boxes: number;
}

/**
 * 发货表一行：箱数按订单拆解，不合并成总数；只带箱数和收件信息。
 * 例：2箱 + 3箱 + 5箱 张三 13800000000 广东省深圳市
 */
export function buildShippingSheetLine(input: {
  recipientName?: string;
  recipientInfo?: string;
  entries: ShippingSheetEntry[];
}): string {
  const active = input.entries.filter((entry) => entry.boxes > 0);
  if (!active.length) return '';
  const boxText = active.map((entry) => `${Math.max(1, Math.trunc(entry.boxes))}箱`).join(' + ');
  const recipient = String(input.recipientInfo ?? '').trim() || String(input.recipientName ?? '').trim();
  return `${boxText}${recipient ? ` ${recipient}` : ''}`;
}
