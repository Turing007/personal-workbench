import { useEffect, useMemo, useState } from 'react';
import ShippingBatchPanel from '../components/ShippingBatchPanel';
import type { OrderDraft } from '../components/OrderForm';
import { isUnshippedStatus } from '../../shared/domain';

export interface ShippingPageProps {
  orders: OrderDraft[];
  initialOrder?: OrderDraft;
  initialOrders?: OrderDraft[];
  onUpdateTracking?: (orderId: string, value: string) => void;
  /** 只保存物流单号、不推进状态：给还没到「待发货」的订单提前录号用。 */
  onSaveTracking?: (orderId: string, value: string) => Promise<boolean>;
  onConfirm?: (orders: OrderDraft[]) => Promise<void> | void;
}

export default function ShippingPage({ orders, initialOrder, initialOrders, onUpdateTracking, onSaveTracking, onConfirm }: ShippingPageProps) {
  const [batch, setBatch] = useState<OrderDraft[]>([]);
  const eligible = useMemo(() => orders.filter((order) => isUnshippedStatus(order.status)), [orders]);
  useEffect(() => {
    if (initialOrder && isUnshippedStatus(initialOrder.status)) setBatch((current) => current.some((item) => item.id === initialOrder.id) ? current : [...current, initialOrder]);
  }, [initialOrder]);
  // 批量发货入口：把所选待发货订单一次性预载进发货批次，补录物流单号后统一确认。
  useEffect(() => {
    if (!initialOrders?.length) return;
    setBatch((current) => {
      const ids = new Set(current.map((item) => item.id));
      const additions = initialOrders.filter((order) => order.id != null && !ids.has(order.id));
      return additions.length ? [...current, ...additions] : current;
    });
  }, [initialOrders]);
  const add = (order: OrderDraft) => setBatch((current) => current.some((item) => item.id === order.id) ? current : [...current, order]);
  const remove = (id: string) => setBatch((current) => current.filter((order) => (order.id ?? order.orderNo) !== id));
  const tracking = (id: string, value: string) => {
    setBatch((current) => current.map((order) => (order.id ?? order.orderNo) === id ? { ...order, trackingNo: value } : order));
    onUpdateTracking?.(id, value);
  };
  return <div className="page-shell shipping-page">
    <div className="shipping-page-head">
      <div className="shipping-heading-copy">
        <span className="page-breadcrumb">履约 / 发货</span>
        <strong className="page-title">发货工作区</strong>
        <span className="page-subtitle">把未发货订单加入批次，回填物流单号后确认发货</span>
      </div>
      <span className="badge badge-warning">{eligible.length} 条未发货</span>
    </div>
    <section className="table-panel shipping-panel">
      <ShippingBatchPanel orders={batch} allOrders={eligible} onAdd={add} onRemove={remove} onTrackingChange={tracking} onSaveTracking={onSaveTracking} onClear={() => setBatch([])} onConfirm={() => { void onConfirm?.(batch); }} />
    </section>
  </div>;
}
