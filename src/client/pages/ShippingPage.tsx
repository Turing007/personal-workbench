import { useEffect, useMemo, useState } from 'react';
import ShippingBatchPanel from '../components/ShippingBatchPanel';
import type { OrderDraft } from '../components/OrderForm';
import type { OrderChannel } from '../../shared/domain';

export interface ShippingPageProps {
  orders: OrderDraft[];
  initialOrder?: OrderDraft;
  initialOrders?: OrderDraft[];
  onUpdateTracking?: (orderId: string, value: string) => void;
  /** 保存批次内的物流单号，不推进状态。 */
  onSaveTracking?: (orderId: string, value: string) => Promise<boolean>;
  onConfirm?: (orders: OrderDraft[]) => Promise<void> | void;
}

export default function ShippingPage({ orders, initialOrder, initialOrders, onUpdateTracking, onSaveTracking, onConfirm }: ShippingPageProps) {
  const [batch, setBatch] = useState<OrderDraft[]>([]);
  const [channel, setChannel] = useState<'all' | OrderChannel>('all');
  const eligible = useMemo(() => orders.filter((order) => order.status === 'ship_pending' && (channel === 'all' || order.channel === channel)), [orders, channel]);
  useEffect(() => {
    if (initialOrder?.status === 'ship_pending') setBatch((current) => current.some((item) => item.id === initialOrder.id) ? current : [...current, initialOrder]);
  }, [initialOrder]);
  // 批量发货入口：把所选待发货订单一次性预载进发货批次，补录物流单号后统一确认。
  useEffect(() => {
    if (!initialOrders?.length) return;
    setBatch((current) => {
      const ids = new Set(current.map((item) => item.id));
      const additions = initialOrders.filter((order) => order.id != null && order.status === 'ship_pending' && !ids.has(order.id));
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
        <span className="page-subtitle">把待发货订单加入批次，回填物流单号后确认发货</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <select className="toolbar-select" aria-label="订单渠道筛选" value={channel} onChange={(event) => setChannel(event.target.value as 'all' | OrderChannel)}><option value="all">全部渠道</option><option value="online">线上订单</option><option value="offline">线下订单</option></select>
        <span className="badge badge-warning">{eligible.length} 条待发货</span>
      </div>
    </div>
    <section className="table-panel shipping-panel">
      <ShippingBatchPanel orders={batch} allOrders={eligible} onAdd={add} onRemove={remove} onTrackingChange={tracking} onSaveTracking={onSaveTracking} onClear={() => setBatch([])} onConfirm={() => { void onConfirm?.(batch); }} />
    </section>
  </div>;
}
