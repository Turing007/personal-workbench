import { Clipboard, Send, Trash2, Truck } from 'lucide-react';
import type { OrderDraft, OrderStatus } from './OrderForm';

export interface ShippingBatchPanelProps {
  orders: OrderDraft[];
  allOrders?: OrderDraft[];
  onAdd: (order: OrderDraft) => void;
  onRemove: (orderId: string) => void;
  onTrackingChange: (orderId: string, trackingNo: string) => void;
  onClear: () => void;
  onConfirm: () => void;
  onCopy?: (text: string) => void;
}

function shippingText(orders: OrderDraft[]) {
  return orders.map((order) => `${orderBoxCount(order)}箱 ${order.recipientInfo || order.recipientName}`).join('\n');
}

function orderBoxCount(order: OrderDraft): number {
  return order.totalBoxes && order.totalBoxes > 0
    ? order.totalBoxes
    : order.items.reduce((total, item) => total + item.boxes, 0);
}

export default function ShippingBatchPanel({ orders, allOrders = [], onAdd, onRemove, onTrackingChange, onClear, onConfirm, onCopy }: ShippingBatchPanelProps) {
  const eligible = allOrders.filter((order) => order.status === 'ship_pending' && !orders.some((item) => item.id === order.id));
  const text = shippingText(orders);
  const invalid = orders.filter((order) => !order.trackingNo.trim());
  return <div className="shipping-workspace">
    <section className="shipping-available section-box" style={{ alignContent: 'start', gap: 9 }}><div className="section-box-header"><strong className="section-box-title">待发货订单</strong><span className="badge badge-neutral">{eligible.length} 条可加入</span></div><div className="shipping-available-list" style={{ display: 'grid', gap: 6, maxHeight: 500, overflowY: 'auto' }}>{eligible.map((order) => <div key={order.id} className="shipping-available-order card" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 9 }}><div style={{ flex: 1, minWidth: 0 }}><strong className="shipping-order-number" style={{ display: 'block', fontSize: 12 }}>{order.orderNo}</strong><span className="shipping-order-recipient" style={{ display: 'block', marginTop: 3, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{order.recipientName} · {order.recipientInfo}</span></div><button type="button" className="button button-secondary button-sm" onClick={() => onAdd(order)}>加入批次</button></div>)}{!eligible.length && <div className="empty-state">暂无可加入的待发货订单</div>}</div></section>
    <section className="shipping-batch card" style={{ display: 'grid', alignContent: 'start', gap: 10, padding: 13 }}><div className="section-box-header"><div className="section-title"><Truck size={16} color="#0f766e" /><strong>当前发货批次</strong><span className="badge badge-neutral">{orders.length} 单 / {orders.reduce((total, order) => total + orderBoxCount(order), 0)} 箱</span></div><button type="button" className="icon-button danger" title="清空批次" onClick={onClear}><Trash2 size={15} /></button></div><div className="shipping-batch-list" style={{ display: 'grid', gap: 6 }}>{orders.map((order) => <div key={order.id} className="shipping-batch-order section-box"><div style={{ minWidth: 0 }}><strong className="shipping-order-number" style={{ display: 'block', fontSize: 12 }}>{order.orderNo} · {order.recipientName}</strong><span className="shipping-order-box-count" style={{ color: '#64748b', fontSize: 11 }}>{orderBoxCount(order)} 箱</span></div><input className="input shipping-tracking-input" aria-label={`${order.orderNo}物流单号`} value={order.trackingNo} onChange={(event) => onTrackingChange(order.id ?? order.orderNo, event.target.value)} placeholder="回填物流单号" /><button type="button" className="icon-button danger" title="移出批次" onClick={() => onRemove(order.id ?? order.orderNo)}><Trash2 size={14} /></button></div>)}</div><div className="shipping-sheet section-box" style={{ gap: 6 }}><div className="section-box-header"><strong className="section-box-title">发货表</strong><button type="button" className="button button-secondary button-sm" onClick={() => { void navigator.clipboard?.writeText(text); onCopy?.(text); }} disabled={!orders.length}><Clipboard size={13} />复制</button></div><textarea className="textarea" readOnly rows={Math.max(4, orders.length + 1)} value={text} placeholder="批次发货表只显示总箱数和收件信息" /></div><div className="shipping-confirm-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>{invalid.length > 0 && <span className="notice notice-warning">还有 {invalid.length} 单未填写物流单号</span>}<button type="button" className="button button-primary" disabled={!orders.length || invalid.length > 0} onClick={onConfirm} style={{ background: orders.length && !invalid.length ? '#0f766e' : '#cbd5e1' }}><Send size={14} />确认批次发货</button></div></section>
  </div>;
}

export function isShippingStatus(status: OrderStatus): boolean { return status === 'ship_pending'; }
