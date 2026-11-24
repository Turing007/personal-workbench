import { FileText, Printer, Send, Truck, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { isOrderPaymentCleared } from '../../../shared/finance';
import { boxesForQuantity, getOrderFulfillmentProgress, remainingQuantity, type PartialShipmentEntryInput } from '../../../shared/shipping';
import type { OrderDraft, OrderItemDraft, OrderStatus } from '../OrderForm';

export interface OrderShippingCardProps {
  order: OrderDraft;
  onOpenDetail?: (order: OrderDraft) => void;
  onEditLabels?: (order: OrderDraft) => void;
  onEditRecipient?: (order: OrderDraft) => void;
  onRollbackStatus?: (order: OrderDraft, status: OrderStatus) => void;
  onConfirmShipping?: (entries: PartialShipmentEntryInput[]) => Promise<{ batchId: number } | undefined>;
  onRefresh?: () => Promise<void> | void;
  onNotify?: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

function remainingSignature(order: OrderDraft): string {
  return order.items.map((item) => `${item.id}:${remainingQuantity(item)}`).join('|');
}

export default function OrderShippingCard({ order, onOpenDetail, onEditLabels, onEditRecipient, onRollbackStatus, onConfirmShipping, onRefresh, onNotify }: OrderShippingCardProps) {
  const progress = getOrderFulfillmentProgress(order.items);
  const hasShipments = order.items.some((item) => (item.shippedQuantity ?? 0) > 0);
  const receivableCents = order.financeSummary?.receivableCents ?? Math.round(Number(order.amount || 0) * 100);
  const receivedCents = order.financeSummary?.receivedCents ?? 0;
  const paid = isOrderPaymentCleared(receivableCents, receivedCents);
  const paymentStatus = order.financeSummary?.paymentStatus ?? 'unpaid';
  const remainingItems = useMemo(() => order.items.filter((item) => remainingQuantity(item) > 0), [order.items]);
  const signature = remainingSignature(order);
  const [quantities, setQuantities] = useState<Record<string, number>>(() => Object.fromEntries(remainingItems.map((item) => [item.id, remainingQuantity(item)])));
  const [trackingNo, setTrackingNo] = useState(() => String(order.trackingNo ?? ''));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setQuantities(Object.fromEntries(remainingItems.map((item) => [item.id, remainingQuantity(item)])));
    setTrackingNo(String(order.trackingNo ?? ''));
  // 只在订单或剩余数量变化时重置，避免输入过程中被父级刷新打断。
  }, [order.id, signature]);

  const selections = remainingItems
    .map((item) => ({ item, quantity: Math.min(remainingQuantity(item), Math.max(0, Math.trunc(Number(quantities[item.id] ?? 0) || 0))) }))
    .filter((entry) => entry.quantity > 0);
  const totalQuantity = selections.reduce((sum, entry) => sum + entry.quantity, 0);
  const totalBoxes = selections.reduce((sum, entry) => sum + boxesForQuantity(entry.quantity, entry.item.packSize), 0);
  const reason = !selections.length
    ? '本次未选数量'
    : !trackingNo.trim()
      ? '缺物流单号'
      : !paid
        ? '未收齐全款，暂不能发货'
        : '';
  const disabled = submitting || Boolean(reason);

  const setQuantity = (item: OrderItemDraft, value: number) => {
    const quantity = Math.min(remainingQuantity(item), Math.max(0, Math.trunc(Number(value) || 0)));
    setQuantities((current) => ({ ...current, [item.id]: quantity }));
  };

  const fillAll = () => setQuantities(Object.fromEntries(remainingItems.map((item) => [item.id, remainingQuantity(item)])));
  const clearAll = () => setQuantities(Object.fromEntries(remainingItems.map((item) => [item.id, 0])));

  const confirm = async () => {
    if (!order.id || !onConfirmShipping || disabled) {
      if (reason) onNotify?.(reason, 'error');
      return;
    }
    const entry: PartialShipmentEntryInput = {
      orderId: Number(order.id),
      trackingNo: trackingNo.trim(),
      items: selections.map(({ item, quantity }) => ({ orderItemId: Number(item.id), quantity })),
    };
    setSubmitting(true);
    try {
      const result = await onConfirmShipping([entry]);
      if (result) await onRefresh?.();
    } finally {
      setSubmitting(false);
    }
  };

  return <article className="orders-shipping-card" aria-label={`发货中订单 ${order.orderNo}`}>
    <header className="orders-shipping-card-head">
      <div className="orders-shipping-card-info">
        <div className="orders-shipping-card-title">
          <strong>{order.orderNo}</strong>
          <span>{order.customerName || '未填客户'} · {order.orderedAt.replace('T', ' ')}</span>
        </div>
        <div className="orders-shipping-card-state">
          <span className="badge badge-info">发货中</span>
          {!paid && <span className="badge badge-danger">{paymentStatus === 'partial' ? '部分收款' : '未收款'}</span>}
          <span className="orders-shipping-progress">已发 {progress.shippedQuantity}/{progress.totalQuantity} 件 · 剩余 {progress.remainingQuantity} 件</span>
        </div>
        <div className="orders-shipping-recipient">
          <span className="orders-shipping-recipient-label">收件人</span>
          {onEditRecipient
            ? <button type="button" className="order-recipient-link" title="编辑收件人信息" onClick={() => onEditRecipient(order)}>{order.recipientName || '未填'}</button>
            : <strong>{order.recipientName || '未填'}</strong>}
          <span className="orders-shipping-recipient-info" title={order.recipientInfo || undefined}>{order.recipientInfo || '未填收件信息'}</span>
        </div>
      </div>

      <div className="orders-shipping-ship-box">
        <label className="order-shipping-tracking">
          <span>物流单号</span>
          <input aria-label={`${order.orderNo}-本次物流单号`} value={trackingNo} onChange={(event) => setTrackingNo(event.target.value)} placeholder="回填本次发货的物流单号" />
        </label>
        <button type="button" className="button button-primary" disabled={disabled} onClick={() => { void confirm(); }}>
          <Send size={14} />{submitting ? '提交中…' : '确认本次发货'}
        </button>
        <span className={reason ? 'order-shipping-reason is-warning' : 'order-shipping-reason'}>{reason || '剩余产品可留到下一批继续发'}</span>
      </div>
    </header>

    {remainingItems.length > 0 && <section className="order-shipping-form" aria-label="本次发货">
      <div className="order-shipping-form-head">
        <strong><Truck size={14} />本次发货</strong>
        <span>本次 {totalQuantity} 件 · {totalBoxes} 箱</span>
      </div>
      <div className="order-shipping-items">
        {remainingItems.map((item) => {
          const remaining = remainingQuantity(item);
          const quantity = Math.min(remaining, Math.max(0, Math.trunc(Number(quantities[item.id] ?? 0) || 0)));
          const boxes = boxesForQuantity(quantity, item.packSize);
          return <div className="order-shipping-item" key={item.id}>
            <span className="order-shipping-item-copy">
              <strong title={item.name}>{item.name || '未填产品'}</strong>
              <span>{item.specification || '—'} · 剩余 {remaining} 件 · {item.packSize} 件/箱</span>
            </span>
            <input type="number" min={0} max={remaining} inputMode="numeric" aria-label={`${order.orderNo}-${item.name || '产品'}-本次发货数量`} value={quantity} onChange={(event) => setQuantity(item, Number(event.target.value))} />
            <span className="order-shipping-item-boxes">{quantity > 0 ? `${boxes} 箱` : '—'}</span>
          </div>;
        })}
      </div>
      <div className="order-shipping-actions">
        <button type="button" className="button button-ghost button-sm" onClick={fillAll}>本次全发</button>
        <button type="button" className="button button-ghost button-sm" onClick={clearAll}>清空数量</button>
      </div>
    </section>}

    <footer className="orders-shipping-card-actions">
      {onOpenDetail && <button type="button" className="link-button" onClick={() => onOpenDetail(order)}><FileText size={13} />详情</button>}
      {onEditLabels && <button type="button" className="link-button" onClick={() => onEditLabels(order)}><Printer size={13} />箱唛</button>}
      {!hasShipments && onRollbackStatus && <button type="button" className="link-button muted" onClick={() => onRollbackStatus(order, 'ship_pending')}><Undo2 size={13} />回退</button>}
    </footer>
  </article>;
}
