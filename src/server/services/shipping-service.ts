import type { DatabaseRepositories } from '../db/repositories.js';
import { formatShippingText } from '../../shared/formatters.js';
import { OrderService } from './order-service.js';

export interface ShippingServiceOptions {
  repositories: DatabaseRepositories;
  orderService?: OrderService;
}

export class ShippingService {
  readonly repositories: DatabaseRepositories;
  readonly orderService: OrderService;

  constructor(options: ShippingServiceOptions) {
    this.repositories = options.repositories;
    this.orderService = options.orderService ?? new OrderService({ repositories: options.repositories });
  }

  eligibleOrders() {
    return this.orderService.list({ status: 'ship_pending', page: 1, pageSize: 200 });
  }

  createBatch(orderIds: number[]) {
    const ids = [...new Set(orderIds)];
    if (ids.length === 0) throw new Error('至少选择一个待发货订单');
    ids.forEach((orderId) => {
      const order = this.repositories.getOrderDetail(orderId) as (Record<string, unknown> & {
        status?: unknown;
        order_no?: unknown;
      }) | undefined;
      if (!order) throw new Error(`订单不存在：${orderId}`);
      if (order.status !== 'ship_pending') throw new Error(`订单 ${order.order_no} 当前不是待发货状态`);
    });
    const id = this.repositories.createShipmentBatch(ids);
    return this.getBatch(id);
  }

  getBatch(batchId: number) {
    return this.repositories.getShipmentBatch(batchId);
  }

  updateTracking(batchId: number, orderId: number, trackingNo: string) {
    if (!trackingNo.trim()) throw new Error('物流单号不能为空');
    const batch = this.repositories.getShipmentBatch(batchId);
    if (!batch) return undefined;
    const order = batch.orders.find((entry) => Number(entry.order_id) === orderId);
    if (!order) throw new Error('发货批次中不存在该订单');
    this.repositories.updateShipmentBatchOrder(batchId, orderId, trackingNo);
    return this.getBatch(batchId);
  }

  getText(batchId: number): string | undefined {
    if (!this.repositories.getShipmentBatch(batchId)) return undefined;
    const raw = this.repositories.getShipmentBatchText(batchId);
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
  }

  confirm(batchId: number) {
    const batch = this.repositories.getShipmentBatch(batchId);
    if (!batch) return undefined;
    const missing = batch.orders.filter((order) => !String(order.tracking_no ?? '').trim());
    if (missing.length) throw new Error(`以下订单缺少物流单号：${missing.map((order) => order.order_no).join('、')}`);
    batch.orders.forEach((order) => {
      if (order.status !== 'ship_pending') throw new Error(`订单 ${order.order_no} 当前不可发货`);
    });
    this.repositories.confirmShipment(batchId);
    return this.getBatch(batchId);
  }

  formatRows(rows: Array<{ totalCartons: number; shippingInfo: string }>): string {
    return formatShippingText(rows);
  }
}

export function createShippingService(options: ShippingServiceOptions): ShippingService {
  return new ShippingService(options);
}
