import { Clipboard, Send, Trash2, Truck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { copyText } from '../copy-text';
import { ORDER_STATUS_LABELS_WITH_DRAFT, type AnyOrderStatus } from '../../shared/domain';
import { isOrderPaymentCleared } from '../../shared/finance';
import { getOrderFulfillmentProgress, type PartialShipmentEntryInput } from '../../shared/shipping';
import type { OrderDraft, OrderItemDraft, OrderStatus } from './OrderForm';
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
  onConfirm: (entries: PartialShipmentEntryInput[]) => Promise<void> | void;
  onCopy?: (text: string) => void;
}

function orderBoxCount(order: OrderDraft): number {
  return order.totalBoxes && order.totalBoxes > 0
    ? order.totalBoxes
    : order.items.reduce((total, item) => total + item.boxes, 0);
}

function isOrderPaid(order: OrderDraft): boolean {
  const receivableCents = order.financeSummary?.receivableCents ?? Math.round(Number(order.amount || 0) * 100);
  const receivedCents = order.financeSummary?.receivedCents ?? 0;
  return isOrderPaymentCleared(receivableCents, receivedCents);
}

function orderKeyOf(order: OrderDraft) { return order.id ?? order.orderNo; }

function remainingOf(item: OrderItemDraft): number {
  return Math.max(0, item.quantity - (item.shippedQuantity ?? 0));
}

function itemBoxes(item: OrderItemDraft, quantity: number): number {
  return quantity > 0 ? Math.max(1, Math.ceil(quantity / Math.max(1, item.packSize))) : 0;
}

function selectedBoxes(order: OrderDraft, quantities: Record<string, number>): number {
  return order.items.reduce((sum, item) => sum + itemBoxes(item, quantities[item.id] ?? 0), 0);
}

function shippingText(orders: OrderDraft[], selected: Record<string, Record<string, number>>) {
  return orders.map((order) => {
    const quantities = selected[orderKeyOf(order)] ?? {};
    const boxes = selectedBoxes(order, quantities);
    return `${boxes}箱 ${order.recipientInfo || order.recipientName}`;
  }).join('\n');
}

export default function ShippingBatchPanel({ orders, allOrders = [], onAdd, onRemove, onTrackingChange, onSaveTracking, onClear, onConfirm, onCopy }: ShippingBatchPanelProps) {
  const [dirtyKeys, setDirtyKeys] = useState<string[]>([]);
  const [savingKeys, setSavingKeys] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [mobilePane, setMobilePane] = useState<'queue' | 'batch'>('queue');
  const [selected, setSelected] = useState<Record<string, Record<string, number>>>({});
  const [confirming, setConfirming] = useState(false);
  const eligible = allOrders.filter((order) => order.status === 'ship_pending' && !orders.some((item) => item.id === order.id));
  const visibleEligible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return eligible;
    return eligible.filter((order) => [order.orderNo, order.recipientName, order.recipientInfo, order.customerName].join(' ').toLowerCase().includes(needle));
  }, [eligible, query]);
  const text = shippingText(orders, selected);
  const ready = orders.filter((order) => order.status === 'ship_pending');
  const waiting = orders.length - ready.length;
  const missingTracking = ready.filter((order) => !order.trackingNo.trim());
  const unpaid = ready.filter((order) => !isOrderPaid(order));
  const readyWithItems = ready.filter((order) => order.items.some((item) => (selected[orderKeyOf(order)]?.[item.id] ?? 0) > 0));
  const ordersWithoutSelection = ready.filter((order) => !order.items.some((item) => (selected[orderKeyOf(order)]?.[item.id] ?? 0) > 0));
  const totalBoxes = orders.reduce((total, order) => total + selectedBoxes(order, selected[orderKeyOf(order)] ?? {}), 0);
  const totalQuantity = orders.reduce((total, order) => total + Object.values(selected[orderKeyOf(order)] ?? {}).reduce((sum, value) => sum + value, 0), 0);

  useEffect(() => {
    setSelected((current) => {
      const next: Record<string, Record<string, number>> = {};
      for (const order of orders) {
        const key = orderKeyOf(order);
        const existing = current[key] ?? {};
        next[key] = Object.fromEntries(order.items.map((item) => [item.id, Math.min(remainingOf(item), Math.max(0, Math.trunc(existing[item.id] ?? 0)))]));
      }
      return next;
    });
  }, [orders]);

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

  const setQuantity = (order: OrderDraft, item: OrderItemDraft, value: number) => {
    const key = orderKeyOf(order);
    const quantity = Math.min(remainingOf(item), Math.max(0, Math.trunc(Number(value) || 0)));
    setSelected((current) => ({ ...current, [key]: { ...(current[key] ?? {}), [item.id]: quantity } }));
  };

  const selectAll = (order: OrderDraft) => {
    const key = orderKeyOf(order);
    setSelected((current) => ({ ...current, [key]: Object.fromEntries(order.items.map((item) => [item.id, remainingOf(item)])) }));
  };

  const clearSelection = (order: OrderDraft) => {
    setSelected((current) => ({ ...current, [orderKeyOf(order)]: {} }));
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
    setSelected({});
    setMobilePane('queue');
  };

  const confirm = async () => {
    if (confirming) return;
    const entries: PartialShipmentEntryInput[] = ready.map((order) => ({
      orderId: Number(order.id),
      trackingNo: order.trackingNo.trim(),
      items: order.items
        .filter((item) => (selected[orderKeyOf(order)]?.[item.id] ?? 0) > 0)
        .map((item) => ({ orderItemId: Number(item.id), quantity: selected[orderKeyOf(order)]![item.id]! })),
    })).filter((entry) => entry.items.length > 0);
    if (!entries.length) return;
    setConfirming(true);
    try {
      await onConfirm(entries);
      setSelected({});
    } finally {
      setConfirming(false);
    }
  };

  return <div className="shipping-workspace">
    <div className="shipping-mobile-tabs" role="tablist" aria-label="发货工作区切换">
      <button type="button" role="tab" aria-selected={mobilePane === 'queue'} className={mobilePane === 'queue' ? 'is-active' : undefined} onClick={() => setMobilePane('queue')}>待发货 <b>{eligible.length}</b></button>
      <button type="button" role="tab" aria-selected={mobilePane === 'batch'} className={mobilePane === 'batch' ? 'is-active' : undefined} onClick={() => setMobilePane('batch')}>当前批次 <b>{orders.length}</b></button>
    </div>

    <section className={`shipping-available${mobilePane === 'queue' ? ' is-mobile-active' : ''}`}>
      <div className="shipping-pane-head">
        <strong>待发货订单</strong>
        <span className="shipping-pane-count">{eligible.length} 条待发货</span>
      </div>
      <div className="shipping-available-search">
        <SearchInput value={query} onChange={setQuery} placeholder="搜索订单号、客户、收件人、品名" />
      </div>
      <div className="shipping-available-list">
        {visibleEligible.map((order) => {
          const progress = getOrderFulfillmentProgress(order.items);
          return <div key={order.id} className="shipping-available-order">
            <div className="shipping-available-main">
              <div className="shipping-available-line">
                <strong className="shipping-order-number">{order.orderNo}</strong>
                <span className={`badge ${order.status === 'ship_pending' ? 'badge-warning' : 'badge-neutral'}`}>{ORDER_STATUS_LABELS_WITH_DRAFT[order.status as AnyOrderStatus] ?? order.status}</span>
                {progress.isPartiallyShipped && <span className="badge badge-accent" title={`已发 ${progress.shippedQuantity}/${progress.totalQuantity} 件`}>部分发货</span>}
                {order.status === 'ship_pending' && !isOrderPaid(order) && <span className="badge badge-danger">未收款</span>}
              </div>
              <div className="shipping-order-recipient">{order.recipientName || '未填收件人'}</div>
              <div className="shipping-order-address">{order.recipientInfo || '未填收件信息'}</div>
              <div className="shipping-order-address">已发 {progress.shippedQuantity}/{progress.totalQuantity} 件 · 剩余 {progress.remainingQuantity} 件</div>
            </div>
            <button type="button" className="button button-secondary button-sm shipping-add-button" onClick={() => addOrder(order)}>加入批次</button>
          </div>;
        })}
        {!visibleEligible.length && <div className="empty-state">{query.trim() ? '没有匹配的待发货订单' : '暂无可加入的待发货订单'}</div>}
      </div>
    </section>

    <section className={`shipping-batch${mobilePane === 'batch' ? ' is-mobile-active' : ''}`}>
      <div className="shipping-pane-head">
        <Truck size={15} />
        <strong>当前发货批次</strong>
        <span className="shipping-pane-count">{orders.length} 单 / 本次 {totalQuantity} 件 / {totalBoxes} 箱</span>
        <button type="button" className="icon-button danger shipping-clear-button" title="清空批次" aria-label="清空批次" onClick={clearBatch} disabled={!orders.length}><Trash2 size={15} /></button>
      </div>
      <div className="shipping-batch-list">
        {orders.map((order) => {
          const key = orderKeyOf(order);
          const shippable = order.status === 'ship_pending';
          const dirty = dirtyKeys.includes(key);
          const saving = savingKeys.includes(key);
          const progress = getOrderFulfillmentProgress(order.items);
          const quantities = selected[key] ?? {};
          return <div key={key} className="shipping-batch-order">
            <div className="shipping-order-identity">
              <strong className="shipping-order-number">{order.orderNo} · {order.recipientName}</strong>
              <span className="shipping-order-address">{order.recipientInfo || '未填收件信息'}</span>
              <span className={`shipping-order-box-count${shippable ? '' : ' is-waiting'}`}>已发 {progress.shippedQuantity}/{progress.totalQuantity} 件 · 剩余 {progress.remainingQuantity} 件 · 本次 {selectedBoxes(order, quantities)} 箱</span>
              {progress.isPartiallyShipped && <span className="badge badge-accent">部分发货</span>}
              {shippable && !isOrderPaid(order) && <span className="badge badge-danger">未收款</span>}
            </div>
            <input className="input shipping-tracking-input" aria-label={`${order.orderNo}物流单号`} value={order.trackingNo} onChange={(event) => { onTrackingChange(key, event.target.value); markDirty(key, true); }} onBlur={() => { if (dirty) void saveTracking(order); }} placeholder="回填物流单号" />
            <div className="shipping-batch-item-list">
              {order.items.filter((item) => remainingOf(item) > 0).map((item) => {
                const quantity = quantities[item.id] ?? 0;
                return <div className="shipping-batch-item" key={item.id}>
                  <input type="checkbox" aria-label={`选择${item.name}`} checked={quantity > 0} onChange={(event) => setQuantity(order, item, event.target.checked ? remainingOf(item) : 0)} />
                  <span className="shipping-batch-item-copy">
                    <strong>{item.name || '未填产品'}</strong>
                    <span>{item.specification || '—'} · 剩余 {remainingOf(item)} 件</span>
                  </span>
                  <input type="number" min={0} max={remainingOf(item)} aria-label={`${order.orderNo}-${item.name}-本次数量`} value={quantity} onChange={(event) => setQuantity(order, item, Number(event.target.value))} />
                  <span className="shipping-batch-item-boxes">{itemBoxes(item, quantity) ? `${itemBoxes(item, quantity)} 箱` : '—'}</span>
                </div>;
              })}
              {!order.items.some((item) => remainingOf(item) > 0) && <div className="shipping-order-address">该订单已全部发完</div>}
            </div>
            <div className="shipping-batch-actions">
              <button type="button" className="button button-ghost button-sm" onClick={() => selectAll(order)}>本次全发</button>
              <button type="button" className="button button-ghost button-sm" onClick={() => clearSelection(order)}>清空数量</button>
              {onSaveTracking && (dirty || saving) && <button type="button" className="button button-secondary button-sm" disabled={saving || !order.trackingNo.trim()} onClick={() => { void saveTracking(order); }}>{saving ? '保存中…' : '保存单号'}</button>}
              <button type="button" className="icon-button danger" title="移出批次" aria-label={`移出批次 ${order.orderNo}`} onClick={() => removeOrder(key)}><Trash2 size={14} /></button>
            </div>
          </div>;
        })}
        {!orders.length && <div className="shipping-batch-empty"><Truck size={18} />从左侧「待发货订单」加入批次</div>}
      </div>
      <div className="shipping-sheet">
        <div className="shipping-sheet-head"><strong>发货表</strong><button type="button" className="button button-secondary button-sm" onClick={() => { void copyText(text); onCopy?.(text); }} disabled={!orders.length}><Clipboard size={13} />复制</button></div>
        <textarea className="textarea" readOnly rows={Math.max(3, orders.length + 1)} value={text} placeholder="批次发货表只显示本次箱数和收件信息" />
      </div>
      <div className="shipping-confirm-actions">
        {missingTracking.length > 0 && <span className="notice notice-warning">还有 {missingTracking.length} 单未填写物流单号</span>}
        {unpaid.length > 0 && <span className="notice notice-warning">{unpaid.length} 单未确认收到货款，需先在订单金额里上传并审核水单</span>}
        {waiting > 0 && <span className="notice notice-warning">{waiting} 单未到「待发货」，本次不确认发货</span>}
        {ordersWithoutSelection.length > 0 && <span className="notice notice-warning">{ordersWithoutSelection.length} 单还没有选择本次发货数量</span>}
        <button type="button" className="button button-primary" disabled={!readyWithItems.length || missingTracking.length > 0 || unpaid.length > 0 || confirming} onClick={() => { void confirm(); }}><Send size={14} />{confirming ? '提交中…' : '确认本次发货'}</button>
      </div>
    </section>
  </div>;
}

export function isShippingStatus(status: OrderStatus): boolean { return status === 'ship_pending'; }
