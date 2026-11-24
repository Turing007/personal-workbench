import { useEffect, useMemo, useState } from 'react';
import { isOrderPaymentCleared } from '../../../shared/finance';
import { boxesForQuantity, remainingQuantity, type PartialShipmentEntryInput } from '../../../shared/shipping';
import { normalizePaymentPolicy } from '../../../shared/payment-policy';
import type { OrderDraft, OrderItemDraft } from '../OrderForm';

export interface UseShippingDraftOptions {
  order: OrderDraft;
  onConfirmShipping?: (entries: PartialShipmentEntryInput[]) => Promise<{ batchId: number } | undefined>;
  onSaveTracking?: (orderId: string, trackingNo: string) => Promise<boolean>;
  onRefresh?: () => Promise<void> | void;
  onNotify?: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

function remainingSignature(order: OrderDraft): string {
  return order.items.map((item) => `${item.id}:${remainingQuantity(item)}`).join('|');
}

/** 发货中订单的本次数量、物流单号和收款校验，桌面表格行与手机卡片共用。 */
export function useShippingDraft({ order, onConfirmShipping, onSaveTracking, onRefresh, onNotify }: UseShippingDraftOptions) {
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

  // 账期客户可以先发货；其余付款方式确认发货前必须收齐全款。
  const requiresPayment = normalizePaymentPolicy(order.paymentPolicy) !== 'credit';
  const payableCents = order.financeSummary?.receivableCents ?? Math.round(Number(order.amount || 0) * 100);
  const receivedCents = order.financeSummary?.receivedCents ?? 0;
  const paid = isOrderPaymentCleared(payableCents, receivedCents);
  const paymentStatus = order.financeSummary?.paymentStatus ?? 'unpaid';
  const selections = remainingItems
    .map((item) => ({ item, quantity: Math.min(remainingQuantity(item), Math.max(0, Math.trunc(Number(quantities[item.id] ?? 0) || 0))) }))
    .filter((entry) => entry.quantity > 0);
  const totalQuantity = selections.reduce((sum, entry) => sum + entry.quantity, 0);
  const totalBoxes = selections.reduce((sum, entry) => sum + boxesForQuantity(entry.quantity, entry.item.packSize), 0);
  const reason = !selections.length
    ? '本次未选数量'
    : !trackingNo.trim()
      ? '缺物流单号'
      : requiresPayment && !paid
        ? '未收齐全款，暂不能发货'
        : '';
  const disabled = submitting || Boolean(reason);

  const setQuantity = (item: OrderItemDraft, value: number) => {
    const quantity = Math.min(remainingQuantity(item), Math.max(0, Math.trunc(Number(value) || 0)));
    setQuantities((current) => ({ ...current, [item.id]: quantity }));
  };

  const saveTracking = async () => {
    const value = trackingNo.trim();
    if (!onSaveTracking || !order.id || !value || value === String(order.trackingNo ?? '').trim()) return;
    await onSaveTracking(String(order.id), value);
  };

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

  return {
    remainingItems,
    quantities,
    setQuantity,
    trackingNo,
    setTrackingNo,
    saveTracking,
    paid,
    paymentStatus,
    selections,
    totalQuantity,
    totalBoxes,
    reason,
    disabled,
    submitting,
    confirm,
  };
}
