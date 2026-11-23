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
