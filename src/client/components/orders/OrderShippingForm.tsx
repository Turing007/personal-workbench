import { Send, Truck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { isOrderPaymentCleared } from '../../../shared/finance';
import { boxesForQuantity, remainingQuantity, type PartialShipmentEntryInput } from '../../../shared/shipping';
import type { OrderDraft, OrderItemDraft } from '../OrderForm';

export interface OrderShippingFormProps {
  order: OrderDraft;
  onConfirmShipping?: (entries: PartialShipmentEntryInput[]) => Promise<{ batchId: number } | undefined>;
  onChanged?: () => Promise<void> | void;
  onNotify?: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

function orderIsPaid(order: OrderDraft): boolean {
  const receivableCents = order.financeSummary?.receivableCents ?? Math.round(Number(order.amount || 0) * 100);
  const receivedCents = order.financeSummary?.receivedCents ?? 0;
  return isOrderPaymentCleared(receivableCents, receivedCents);
}

function remainingSignature(order: OrderDraft): string {
  return order.items.map((item) => `${item.id}:${remainingQuantity(item)}`).join('|');
}

export default function OrderShippingForm({ order, onConfirmShipping, onChanged, onNotify }: OrderShippingFormProps) {
  const remainingItems = useMemo(() => order.items.filter((item) => remainingQuantity(item) > 0), [order.items]);
  const signature = remainingSignature(order);
  const [quantities, setQuantities] = useState<Record<string, number>>(() => Object.fromEntries(remainingItems.map((item) => [item.id, remainingQuantity(item)])));
  const [trackingNo, setTrackingNo] = useState(() => String(order.trackingNo ?? ''));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setQuantities(Object.fromEntries(remainingItems.map((item) => [item.id, remainingQuantity(item)])));
    setTrackingNo(String(order.trackingNo ?? ''));
  // 剩余数量或订单变化时才重置，避免输入过程中被父级刷新打断。
  }, [order.id, signature]);

  if (order.status !== 'shipping' || !remainingItems.length || !onConfirmShipping) return null;

  const selections = remainingItems
    .map((item) => ({ item, quantity: Math.min(remainingQuantity(item), Math.max(0, Math.trunc(Number(quantities[item.id] ?? 0) || 0))) }))
    .filter((entry) => entry.quantity > 0);
  const totalBoxes = selections.reduce((sum, entry) => sum + boxesForQuantity(entry.quantity, entry.item.packSize), 0);
  const paid = orderIsPaid(order);
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
    if (!order.id || disabled) {
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
      if (result) await onChanged?.();
    } finally {
      setSubmitting(false);
    }
  };

  return <section className="order-shipping-form" aria-label="本次发货">
    <div className="order-shipping-form-head">
      <strong><Truck size={14} />本次发货</strong>
      <span>本次 {selections.reduce((sum, entry) => sum + entry.quantity, 0)} 件 · {totalBoxes} 箱</span>
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
    <label className="order-shipping-tracking">
      <span>物流单号</span>
      <input aria-label={`${order.orderNo}-本次物流单号`} value={trackingNo} onChange={(event) => setTrackingNo(event.target.value)} placeholder="回填本次发货的物流单号" />
    </label>
    <div className="order-shipping-submit">
      <span className={reason ? 'order-shipping-reason is-warning' : 'order-shipping-reason'}>{reason || '剩余产品可留到下一批继续发'}</span>
      <button type="button" className="button button-primary" disabled={disabled} onClick={() => { void confirm(); }}>
        <Send size={14} />{submitting ? '提交中…' : '确认本次发货'}
      </button>
    </div>
  </section>;
}
