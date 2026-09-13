import { useEffect, useMemo, useState } from 'react';
import ShippingBatchPanel from '../components/ShippingBatchPanel';
import type { OrderDraft } from '../components/OrderForm';

export interface ShippingPageProps {
  orders: OrderDraft[];
  initialOrder?: OrderDraft;
  initialOrders?: OrderDraft[];
  onUpdateTracking?: (orderId: string, value: string) => void;
  onConfirm?: (orders: OrderDraft[]) => Promise<void> | void;
}

export default function ShippingPage({ orders, initialOrder, initialOrders, onUpdateTracking, onConfirm }: ShippingPageProps) {
  const [batch, setBatch] = useState<OrderDraft[]>([]);
  const eligible = useMemo(() => orders.filter((order) => order.status === 'ship_pending'), [orders]);
  useEffect(() => {
    if (initialOrder?.status === 'ship_pending') setBatch((current) => current.some((item) => item.id === initialOrder.id) ? current : [...current, initialOrder]);
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
  return <div className="page-shell shipping-page"><div className="page-toolbar"><div><strong>发货工作区</strong></div><span className="badge badge-warning">{eligible.length} 条待发货</span></div><section className="table-panel shipping-panel"><ShippingBatchPanel orders={batch} allOrders={eligible} onAdd={add} onRemove={remove} onTrackingChange={tracking} onClear={() => setBatch([])} onConfirm={() => { void onConfirm?.(batch); }} /></section></div>;
}
