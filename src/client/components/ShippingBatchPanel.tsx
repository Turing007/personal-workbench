import { Clipboard, Send, Trash2, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { copyText } from '../copy-text';
import { isUnshippedStatus, ORDER_STATUS_LABELS_WITH_DRAFT, type AnyOrderStatus } from '../../shared/domain';
import type { OrderDraft, OrderStatus } from './OrderForm';
import SearchInput from './SearchInput';

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
  const [query, setQuery] = useState('');
  const [mobilePane, setMobilePane] = useState<'queue' | 'batch'>('queue');
  const eligible = allOrders.filter((order) => isUnshippedStatus(order.status) && !orders.some((item) => item.id === order.id));
  const visibleEligible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return eligible;
    return eligible.filter((order) => [order.orderNo, order.recipientName, order.recipientInfo, order.customerName].join(' ').toLowerCase().includes(needle));
  }, [eligible, query]);
  const text = shippingText(orders);
  // 只有「待发货」的单能确认发货；更早状态的单可以先保存物流单号，等流程推进后再确认。
  const ready = orders.filter((order) => order.status === 'ship_pending');
  const waiting = orders.length - ready.length;
  const missingTracking = ready.filter((order) => !order.trackingNo.trim());
  const totalBoxes = orders.reduce((total, order) => total + orderBoxCount(order), 0);
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

  const addOrder = (order: OrderDraft) => {
    onAdd(order);
    setMobilePane('batch');
  };

  const removeOrder = (key: string) => {
    onRemove(key);
    if (orders.length <= 1) setMobilePane('queue');
  };

  const clearBatch = () => {
    onClear();
    setMobilePane('queue');
  };

  return <div className="shipping-workspace">
    <div className="shipping-mobile-tabs" role="tablist" aria-label="发货工作区切换">
      <button type="button" role="tab" aria-selected={mobilePane === 'queue'} className={mobilePane === 'queue' ? 'is-active' : undefined} onClick={() => setMobilePane('queue')}>未发货 <b>{eligible.length}</b></button>
      <button type="button" role="tab" aria-selected={mobilePane === 'batch'} className={mobilePane === 'batch' ? 'is-active' : undefined} onClick={() => setMobilePane('batch')}>当前批次 <b>{orders.length}</b></button>
    </div>

    <section className={`shipping-available${mobilePane === 'queue' ? ' is-mobile-active' : ''}`}>
      <div className="shipping-pane-head">
        <strong>未发货订单</strong>
        <span className="shipping-pane-count">{eligible.length} 条可加入</span>
      </div>
      <div className="shipping-available-search">
        <SearchInput value={query} onChange={setQuery} placeholder="搜索订单号、客户、收件人" />
      </div>
      <div className="shipping-available-list">
        {visibleEligible.map((order) => <div key={order.id} className="shipping-available-order">
          <div className="shipping-available-main">
            <div className="shipping-available-line">
              <strong className="shipping-order-number">{order.orderNo}</strong>
              <span className={`badge ${order.status === 'ship_pending' ? 'badge-warning' : 'badge-neutral'}`}>{ORDER_STATUS_LABELS_WITH_DRAFT[order.status as AnyOrderStatus] ?? order.status}</span>
            </div>
            <div className="shipping-order-recipient">{order.recipientName || '未填收件人'}</div>
            <div className="shipping-order-address">{order.recipientInfo || '未填收件信息'}</div>
          </div>
          <button type="button" className="button button-secondary button-sm shipping-add-button" onClick={() => addOrder(order)}>加入批次</button>
        </div>)}
        {!visibleEligible.length && <div className="empty-state">{query.trim() ? '没有匹配的未发货订单' : '暂无可加入的未发货订单'}</div>}
      </div>
    </section>

    <section className={`shipping-batch${mobilePane === 'batch' ? ' is-mobile-active' : ''}`}>
      <div className="shipping-pane-head">
        <Truck size={15} />
        <strong>当前发货批次</strong>
        <span className="shipping-pane-count">{orders.length} 单 / {totalBoxes} 箱</span>
        <button type="button" className="icon-button danger shipping-clear-button" title="清空批次" aria-label="清空批次" onClick={clearBatch} disabled={!orders.length}><Trash2 size={15} /></button>
      </div>
      <div className="shipping-batch-list">
        {orders.map((order) => {
          const key = orderKeyOf(order);
          const shippable = order.status === 'ship_pending';
          const dirty = dirtyKeys.includes(key);
          const saving = savingKeys.includes(key);
          return <div key={key} className="shipping-batch-order">
            <div className="shipping-order-identity">
              <strong className="shipping-order-number">{order.orderNo} · {order.recipientName}</strong>
              <span className="shipping-order-address">{order.recipientInfo || '未填收件信息'}</span>
              <span className={`shipping-order-box-count${shippable ? '' : ' is-waiting'}`}>{orderBoxCount(order)} 箱 · {shippable ? '待发货' : `${ORDER_STATUS_LABELS_WITH_DRAFT[order.status as AnyOrderStatus] ?? order.status}，只能先存单号`}</span>
            </div>
            <input className="input shipping-tracking-input" aria-label={`${order.orderNo}物流单号`} value={order.trackingNo} onChange={(event) => { onTrackingChange(key, event.target.value); markDirty(key, true); }} onBlur={() => { if (dirty) void saveTracking(order); }} placeholder="回填物流单号" />
            <div className="shipping-batch-actions">
              {onSaveTracking && (dirty || saving) && <button type="button" className="button button-secondary button-sm" disabled={saving || !order.trackingNo.trim()} onClick={() => { void saveTracking(order); }}>{saving ? '保存中…' : '保存单号'}</button>}
              <button type="button" className="icon-button danger" title="移出批次" aria-label={`移出批次 ${order.orderNo}`} onClick={() => removeOrder(key)}><Trash2 size={14} /></button>
            </div>
          </div>;
        })}
        {!orders.length && <div className="shipping-batch-empty"><Truck size={18} />从左侧「未发货订单」加入批次</div>}
      </div>
      <div className="shipping-sheet">
        <div className="shipping-sheet-head"><strong>发货表</strong><button type="button" className="button button-secondary button-sm" onClick={() => { void copyText(text); onCopy?.(text); }} disabled={!orders.length}><Clipboard size={13} />复制</button></div>
        <textarea className="textarea" readOnly rows={Math.max(3, orders.length + 1)} value={text} placeholder="批次发货表只显示总箱数和收件信息" />
      </div>
      <div className="shipping-confirm-actions">
        {missingTracking.length > 0 && <span className="notice notice-warning">还有 {missingTracking.length} 单未填写物流单号</span>}
        {waiting > 0 && <span className="notice notice-warning">{waiting} 单未到「待发货」，本次不确认发货</span>}
        <button type="button" className="button button-primary" disabled={!ready.length || missingTracking.length > 0} onClick={onConfirm}><Send size={14} />确认批次发货</button>
      </div>
    </section>
  </div>;
}

export function isShippingStatus(status: OrderStatus): boolean { return status === 'ship_pending'; }
