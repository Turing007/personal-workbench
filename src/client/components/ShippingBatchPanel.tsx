import { Clipboard, Send, Trash2, Truck } from 'lucide-react';
import { useState } from 'react';
import { copyText } from '../copy-text';
import { isUnshippedStatus, ORDER_STATUS_LABELS_WITH_DRAFT, type AnyOrderStatus } from '../../shared/domain';
import type { OrderDraft, OrderStatus } from './OrderForm';

export interface ShippingBatchPanelProps {
  orders: OrderDraft[];
  allOrders?: OrderDraft[];
  onAdd: (order: OrderDraft) => void;
  onRemove: (orderId: string) => void;
  onTrackingChange: (orderId: string, trackingNo: string) => void;
  /** 只保存物流单号、不推进状态；用于还没到「待发货」的订单。 */
  onSaveTracking?: (orderId: string, trackingNo: string) => Promise<boolean>;
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

function orderKeyOf(order: OrderDraft) { return order.id ?? order.orderNo; }

export default function ShippingBatchPanel({ orders, allOrders = [], onAdd, onRemove, onTrackingChange, onSaveTracking, onClear, onConfirm, onCopy }: ShippingBatchPanelProps) {
  const [dirtyKeys, setDirtyKeys] = useState<string[]>([]);
  const [savingKeys, setSavingKeys] = useState<string[]>([]);
  const eligible = allOrders.filter((order) => isUnshippedStatus(order.status) && !orders.some((item) => item.id === order.id));
  const text = shippingText(orders);
  // 只有「待发货」的单能确认发货；更早状态的单可以先保存物流单号，等流程推进后再确认。
  const ready = orders.filter((order) => order.status === 'ship_pending');
  const waiting = orders.length - ready.length;
  const missingTracking = ready.filter((order) => !order.trackingNo.trim());
  const markDirty = (key: string, dirty: boolean) => setDirtyKeys((current) => (dirty ? [...new Set([...current, key])] : current.filter((item) => item !== key)));

  const saveTracking = async (order: OrderDraft) => {
    const key = orderKeyOf(order);
    if (!onSaveTracking || savingKeys.includes(key)) return;
    setSavingKeys((current) => [...current, key]);
    try {
      if (await onSaveTracking(key, order.trackingNo.trim())) markDirty(key, false);
    } finally {
      setSavingKeys((current) => current.filter((item) => item !== key));
    }
  };

  return <div className="shipping-workspace">
    <section className="shipping-available section-box" style={{ alignContent: 'start', gap: 9 }}>
      <div className="section-box-header"><strong className="section-box-title">未发货订单</strong><span className="badge badge-neutral">{eligible.length} 条可加入</span></div>
      <div className="shipping-available-list" style={{ display: 'grid', gap: 6, maxHeight: 500, overflowY: 'auto' }}>
        {eligible.map((order) => <div key={order.id} className="shipping-available-order card">
          <div className="shipping-available-head">
            <strong className="shipping-order-number">{order.orderNo}</strong>
            <span className={`badge ${order.status === 'ship_pending' ? 'badge-warning' : 'badge-neutral'}`}>{ORDER_STATUS_LABELS_WITH_DRAFT[order.status as AnyOrderStatus] ?? order.status}</span>
            <button type="button" className="button button-secondary button-sm" onClick={() => onAdd(order)}>加入批次</button>
          </div>
          <div className="shipping-order-recipient">{order.recipientName || '未填收件人'}</div>
          <div className="shipping-order-address">{order.recipientInfo || '未填收件信息'}</div>
        </div>)}
        {!eligible.length && <div className="empty-state">暂无可加入的未发货订单</div>}
      </div>
    </section>

    <section className="shipping-batch card" style={{ display: 'grid', alignContent: 'start', gap: 10, padding: 13 }}>
      <div className="section-box-header"><div className="section-title"><Truck size={16} color="#0f766e" /><strong>当前发货批次</strong><span className="badge badge-neutral">{orders.length} 单 / {orders.reduce((total, order) => total + orderBoxCount(order), 0)} 箱</span></div><button type="button" className="icon-button danger" title="清空批次" onClick={onClear}><Trash2 size={15} /></button></div>
      <div className="shipping-batch-list" style={{ display: 'grid', gap: 6 }}>
        {orders.map((order) => {
          const key = orderKeyOf(order);
          const shippable = order.status === 'ship_pending';
          const dirty = dirtyKeys.includes(key);
          const saving = savingKeys.includes(key);
          return <div key={key} className="shipping-batch-order section-box">
            <div className="shipping-order-identity">
              <strong className="shipping-order-number">{order.orderNo} · {order.recipientName}</strong>
              <span className="shipping-order-address">{order.recipientInfo || '未填收件信息'}</span>
              <span className="shipping-order-box-count" style={{ color: shippable ? '#64748b' : '#b45309' }}>
                {orderBoxCount(order)} 箱 · {shippable ? '待发货' : `${ORDER_STATUS_LABELS_WITH_DRAFT[order.status as AnyOrderStatus] ?? order.status}，只能先存单号`}
              </span>
            </div>
            <input className="input shipping-tracking-input" aria-label={`${order.orderNo}物流单号`} value={order.trackingNo} onChange={(event) => { onTrackingChange(key, event.target.value); markDirty(key, true); }} onBlur={() => { if (dirty) void saveTracking(order); }} placeholder="回填物流单号" />
            <div className="shipping-batch-actions">
              {onSaveTracking && (dirty || saving) && <button type="button" className="button button-secondary button-sm" disabled={saving || !order.trackingNo.trim()} onClick={() => { void saveTracking(order); }}>{saving ? '保存中…' : '保存单号'}</button>}
              <button type="button" className="icon-button danger" title="移出批次" aria-label={`移出批次 ${order.orderNo}`} onClick={() => onRemove(key)}><Trash2 size={14} /></button>
            </div>
          </div>;
        })}
      </div>
      <div className="shipping-sheet section-box" style={{ gap: 6 }}>
        <div className="section-box-header"><strong className="section-box-title">发货表</strong><button type="button" className="button button-secondary button-sm" onClick={() => { void copyText(text); onCopy?.(text); }} disabled={!orders.length}><Clipboard size={13} />复制</button></div>
        <textarea className="textarea" readOnly rows={Math.max(4, orders.length + 1)} value={text} placeholder="批次发货表只显示总箱数和收件信息" />
      </div>
      <div className="shipping-confirm-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {missingTracking.length > 0 && <span className="notice notice-warning">还有 {missingTracking.length} 单未填写物流单号</span>}
        {waiting > 0 && <span className="notice notice-warning">{waiting} 单未到「待发货」，本次不确认发货</span>}
        <button type="button" className="button button-primary" disabled={!ready.length || missingTracking.length > 0} onClick={onConfirm} style={{ background: ready.length && !missingTracking.length ? '#0f766e' : '#cbd5e1' }}><Send size={14} />确认批次发货</button>
      </div>
    </section>
  </div>;
}

export function isShippingStatus(status: OrderStatus): boolean { return status === 'ship_pending'; }
