import { Clipboard, Send, SplitSquareHorizontal, Truck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { downloadShippingBatchPdf } from '../../api';
import { copyText } from '../../copy-text';
import { saveFileOrDownload } from '../../file-save';
import { isOrderPaymentCleared } from '../../../shared/finance';
import {
  boxesForQuantity,
  buildShippingSheetLine,
  getOrderFulfillmentProgress,
  groupShippingOrders,
  normalizeRecipientKey,
  remainingQuantity,
  type PartialShipmentEntryInput,
  type ShippingAddressGroup,
} from '../../../shared/shipping';
import type { OrderDraft, OrderItemDraft } from '../OrderForm';

export interface ShippingInProgressPanelProps {
  /** 当前渠道下的全部发货中订单。 */
  orders: OrderDraft[];
  query: string;
  /** 只暂存单号、不推进状态；返回是否保存成功。 */
  onSaveTracking?: (orderId: string, trackingNo: string) => Promise<boolean>;
  onConfirm?: (entries: PartialShipmentEntryInput[]) => Promise<{ batchId: number } | undefined>;
  onOpenDetail?: (order: OrderDraft) => void;
  onNotify?: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

interface SelectedItem {
  item: OrderItemDraft;
  quantity: number;
  boxes: number;
}

interface OrderSelection {
  order: OrderDraft;
  selectedItems: SelectedItem[];
  boxes: number;
  pieces: number;
}

interface GroupView {
  group: ShippingAddressGroup<OrderDraft>;
  trackingValue: string;
  trackingConflict: boolean;
  saving: boolean;
  selections: OrderSelection[];
  activeSelections: OrderSelection[];
  entries: PartialShipmentEntryInput[];
  boxChain: string;
  pieceChain: string;
  totalBoxes: number;
  totalPieces: number;
  unpaidOrders: OrderDraft[];
  invalidReason: string;
  invalid: boolean;
  sheetLine: string;
}

function orderKeyOf(order: OrderDraft): string {
  return String(order.id ?? order.orderNo);
}

function isOrderPaid(order: OrderDraft): boolean {
  const receivableCents = order.financeSummary?.receivableCents ?? Math.round(Number(order.amount || 0) * 100);
  const receivedCents = order.financeSummary?.receivedCents ?? 0;
  return isOrderPaymentCleared(receivableCents, receivedCents);
}

function orderSearchText(order: OrderDraft): string {
  return [order.orderNo, order.customerName, order.recipientName, order.recipientInfo, ...order.items.flatMap((item) => [item.name, item.sku, item.specification])]
    .join(' ')
    .toLowerCase();
}

export default function ShippingInProgressPanel({ orders, query, onSaveTracking, onConfirm, onOpenDetail, onNotify }: ShippingInProgressPanelProps) {
  const [quantities, setQuantities] = useState<Record<string, Record<string, number>>>({});
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [savingKeys, setSavingKeys] = useState<string[]>([]);
  const [splitAddressKeys, setSplitAddressKeys] = useState<Set<string>>(new Set());
  const [selectedGroupKeys, setSelectedGroupKeys] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<string>();
  const [lastBatchId, setLastBatchId] = useState<number>();
  const [batchPdfBusy, setBatchPdfBusy] = useState(false);

  const groups = useMemo(() => groupShippingOrders(orders, splitAddressKeys), [orders, splitAddressKeys]);

  // 新订单/新行默认发剩余数量；已存在的行保留用户这次输入，只按最新剩余量收口。
  useEffect(() => {
    setQuantities((current) => {
      const next: Record<string, Record<string, number>> = {};
      for (const order of orders) {
        const key = orderKeyOf(order);
        const previous = current[key] ?? {};
        next[key] = {};
        for (const item of order.items) {
          const remaining = remainingQuantity(item);
          const previousValue = previous[item.id];
          next[key][item.id] = previousValue == null ? remaining : Math.min(remaining, Math.max(0, Math.trunc(previousValue)));
        }
      }
      return next;
    });
    setTracking((current) => {
      const next = { ...current };
      for (const order of orders) {
        const key = orderKeyOf(order);
        if (next[key] === undefined) next[key] = String(order.trackingNo ?? '');
      }
      return next;
    });
  }, [orders]);

  const groupViews = useMemo<GroupView[]>(() => {
    return groups.map((group) => {
      const keys = group.orders.map(orderKeyOf);
      const trackingValues = keys.map((key) => tracking[key] ?? '');
      const firstTracking = trackingValues[0] ?? '';
      const trackingConflict = trackingValues.some((value) => value !== firstTracking);
      const trackingValue = trackingConflict ? '' : firstTracking;
      const saving = keys.some((key) => savingKeys.includes(key));
      const selections = group.orders.map((order) => {
        const selected = quantities[orderKeyOf(order)] ?? {};
        let boxes = 0;
        let pieces = 0;
        const selectedItems: SelectedItem[] = [];
        for (const item of order.items) {
          const quantity = Math.min(remainingQuantity(item), Math.max(0, Math.trunc(Number(selected[item.id] ?? 0))));
          if (quantity <= 0) continue;
          const itemBoxes = boxesForQuantity(quantity, item.packSize);
          boxes += itemBoxes;
          pieces += quantity;
          selectedItems.push({ item, quantity, boxes: itemBoxes });
        }
        return { order, selectedItems, boxes, pieces };
      });
      const activeSelections = selections.filter((selection) => selection.selectedItems.length > 0);
      const entries: PartialShipmentEntryInput[] = activeSelections
        .filter((selection) => Number.isSafeInteger(Number(selection.order.id)))
        .map((selection) => ({
          orderId: Number(selection.order.id),
          trackingNo: trackingValue.trim(),
          items: selection.selectedItems.map(({ item, quantity }) => ({ orderItemId: Number(item.id), quantity })),
        }));
      const totalBoxes = activeSelections.reduce((sum, selection) => sum + selection.boxes, 0);
      const totalPieces = activeSelections.reduce((sum, selection) => sum + selection.pieces, 0);
      const boxChain = activeSelections.map((selection) => `${selection.boxes}箱`).join(' + ');
      const pieceChain = activeSelections.map((selection) => `${selection.pieces}件`).join(' + ');
      const unpaidOrders = activeSelections.filter((selection) => !isOrderPaid(selection.order)).map((selection) => selection.order);
      const reasons: string[] = [];
      if (!activeSelections.length) reasons.push('本次未选数量');
      if (!trackingValue.trim()) reasons.push('缺物流单号');
      if (unpaidOrders.length) reasons.push(`未收款：${unpaidOrders.map((order) => order.orderNo).join('、')}`);
      return {
        group,
        trackingValue,
        trackingConflict,
        saving,
        selections,
        activeSelections,
        entries,
        boxChain,
        pieceChain,
        totalBoxes,
        totalPieces,
        unpaidOrders,
        invalidReason: reasons.join('；'),
        invalid: reasons.length > 0 || entries.length === 0,
        sheetLine: buildShippingSheetLine({
          recipientName: group.recipientName,
          recipientInfo: group.recipientInfo,
          entries: selections.map((selection) => ({ boxes: selection.boxes, quantity: selection.pieces })),
        }),
      };
    });
  }, [groups, quantities, tracking, savingKeys]);

  // 地址组拆开/合并后，旧的勾选键失效，及时收口避免批量条残留。
  useEffect(() => {
    setSelectedGroupKeys((current) => {
      if (!current.size) return current;
      const valid = new Set(groups.map((group) => group.key));
      const next = new Set([...current].filter((key) => valid.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [groups]);

  const addressOrderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const order of orders) {
      const addressKey = normalizeRecipientKey(order.recipientInfo);
      if (addressKey) counts.set(addressKey, (counts.get(addressKey) ?? 0) + 1);
    }
    return counts;
  }, [orders]);

  const needle = query.trim().toLowerCase();
  const visibleViews = needle
    ? groupViews.filter((view) => view.group.orders.some((order) => orderSearchText(order).includes(needle)))
    : groupViews;
  const visibleOrderCount = visibleViews.reduce((sum, view) => sum + view.group.orders.length, 0);
  const selectedViews = groupViews.filter((view) => selectedGroupKeys.has(view.group.key));
  const selectedOrderCount = selectedViews.reduce((sum, view) => sum + view.group.orders.length, 0);
  const batchErrors = selectedViews.filter((view) => view.invalid).map((view) => `${view.group.orders.map((order) => order.orderNo).join('、')}：${view.invalidReason}`);
  const sheetSource = selectedViews.length ? selectedViews : visibleViews;
  const sheetLines = sheetSource.map((view) => view.sheetLine).filter(Boolean);
  const sheetText = sheetLines.join('\n');

  const setItemQuantity = (order: OrderDraft, item: OrderItemDraft, value: number) => {
    const quantity = Math.min(remainingQuantity(item), Math.max(0, Math.trunc(Number(value) || 0)));
    const key = orderKeyOf(order);
    setQuantities((current) => ({ ...current, [key]: { ...(current[key] ?? {}), [item.id]: quantity } }));
  };

  const fillGroup = (group: ShippingAddressGroup<OrderDraft>) => {
    setQuantities((current) => {
      const next = { ...current };
      for (const order of group.orders) {
        const key = orderKeyOf(order);
        next[key] = Object.fromEntries(order.items.map((item) => [item.id, remainingQuantity(item)]));
      }
      return next;
    });
  };

  const clearGroup = (group: ShippingAddressGroup<OrderDraft>) => {
    setQuantities((current) => {
      const next = { ...current };
      for (const order of group.orders) {
        const key = orderKeyOf(order);
        next[key] = Object.fromEntries(order.items.map((item) => [item.id, 0]));
      }
      return next;
    });
  };

  const changeGroupTracking = (group: ShippingAddressGroup<OrderDraft>, value: string) => {
    setTracking((current) => {
      const next = { ...current };
      for (const order of group.orders) next[orderKeyOf(order)] = value;
      return next;
    });
  };

  const saveGroupTracking = async (group: ShippingAddressGroup<OrderDraft>, value: string) => {
    if (!onSaveTracking) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const pending = group.orders.filter((order) => trimmed !== String(order.trackingNo ?? '').trim());
    if (!pending.length) return;
    const keys = pending.map(orderKeyOf);
    setSavingKeys((current) => [...new Set([...current, ...keys])]);
    try {
      await Promise.all(pending.map((order) => onSaveTracking(orderKeyOf(order), trimmed)));
    } finally {
      setSavingKeys((current) => current.filter((key) => !keys.includes(key)));
    }
  };

  const splitGroup = (group: ShippingAddressGroup<OrderDraft>) => {
    if (!group.addressKey) return;
    setSplitAddressKeys((current) => new Set([...current, group.addressKey]));
    setSelectedGroupKeys(new Set());
  };

  const mergeGroup = (group: ShippingAddressGroup<OrderDraft>) => {
    if (!group.addressKey) return;
    setSplitAddressKeys((current) => {
      const next = new Set(current);
      next.delete(group.addressKey);
      return next;
    });
    setSelectedGroupKeys(new Set());
  };

  const resetConfirmedQuantities = (entries: PartialShipmentEntryInput[]) => {
    const byOrder = new Map(entries.map((entry) => [String(entry.orderId), entry]));
    setQuantities((current) => {
      const next = { ...current };
      for (const order of orders) {
        const entry = byOrder.get(String(order.id));
        if (!entry) continue;
        const submitted = new Map(entry.items.map((item) => [String(item.orderItemId), item.quantity]));
        const key = orderKeyOf(order);
        next[key] = Object.fromEntries(order.items.map((item) => [item.id, Math.max(0, remainingQuantity(item) - (submitted.get(String(item.id)) ?? 0))]));
      }
      return next;
    });
  };

  const confirmGroup = async (view: GroupView) => {
    if (!onConfirm || view.invalid || confirming) {
      if (view.invalid) onNotify?.(view.invalidReason, 'error');
      return;
    }
    setConfirming(view.group.key);
    try {
      const result = await onConfirm(view.entries);
      if (!result?.batchId) return;
      setLastBatchId(result.batchId);
      resetConfirmedQuantities(view.entries);
      setSelectedGroupKeys((current) => {
        if (!current.has(view.group.key)) return current;
        const next = new Set(current);
        next.delete(view.group.key);
        return next;
      });
    } finally {
      setConfirming(undefined);
    }
  };

  const confirmSelected = async () => {
    if (!onConfirm || !selectedViews.length || confirming) return;
    if (batchErrors.length) {
      onNotify?.(batchErrors[0]!, 'error');
      return;
    }
    const entries = selectedViews.flatMap((view) => view.entries);
    if (!entries.length) return;
    setConfirming('batch');
    try {
      const result = await onConfirm(entries);
      if (!result?.batchId) return;
      setLastBatchId(result.batchId);
      resetConfirmedQuantities(entries);
      setSelectedGroupKeys(new Set());
    } finally {
      setConfirming(undefined);
    }
  };

  const copyLine = async (text: string) => {
    if (!text) return;
    const ok = await copyText(text);
    if (ok) onNotify?.('已复制收件信息与发货件数', 'success');
    else onNotify?.('复制失败，请手动选择文本复制', 'error');
  };

  const copySheet = async () => {
    if (!sheetText) return;
    const ok = await copyText(sheetText);
    if (ok) onNotify?.(`已复制发货表（${sheetLines.length} 个地址）`, 'success');
    else onNotify?.('复制失败，请手动选择文本复制', 'error');
  };

  const downloadLastBatch = async () => {
    if (!lastBatchId || batchPdfBusy) return;
    setBatchPdfBusy(true);
    try {
      await saveFileOrDownload(await downloadShippingBatchPdf(lastBatchId), `发货清单-${lastBatchId}.pdf`);
    } catch (error) {
      onNotify?.(error instanceof Error ? error.message : '发货清单生成失败', 'error');
    } finally {
      setBatchPdfBusy(false);
    }
  };

  return <div className="shipping-progress">
    <div className="shipping-progress-head">
      <div className="shipping-progress-title"><Truck size={15} /><strong>发货中</strong><span>{visibleViews.length} 个地址 · {visibleOrderCount} 单</span></div>
      <span className="shipping-progress-hint">同地址自动合并；箱数按每单拆解</span>
    </div>

    {lastBatchId && <div className="shipping-progress-last-batch">
      <span>上一批发货已确认</span>
      <button type="button" className="button button-secondary button-sm" disabled={batchPdfBusy} onClick={() => { void downloadLastBatch(); }}>{batchPdfBusy ? '生成中…' : '下载本批发货清单'}</button>
    </div>}

    <div className="shipping-progress-list">
      {visibleViews.map((view) => {
        const { group } = view;
        const multi = group.orders.length > 1;
        const canSplit = multi && !group.split;
        const canMerge = group.split && Boolean(group.addressKey) && (addressOrderCounts.get(group.addressKey) ?? 0) > 1;
        const checked = selectedGroupKeys.has(group.key);
        const unpaidCount = group.orders.filter((order) => !isOrderPaid(order)).length;
        const originalTrackings = [...new Set(group.orders.map((order) => String(order.trackingNo ?? '').trim()).filter(Boolean))];
        const boxSummary = view.activeSelections.length
          ? `${view.boxChain}${view.activeSelections.length > 1 ? ` = ${view.totalBoxes}箱` : ''}`
          : '0箱';
        const pieceSummary = view.activeSelections.length
          ? `${view.pieceChain}${view.activeSelections.length > 1 ? ` = ${view.totalPieces}件` : ''}`
          : '0件';
        return <article className={`shipping-address-group${checked ? ' is-selected' : ''}`} key={group.key} data-address-key={group.addressKey || undefined}>
          <header className="shipping-address-head">
            <input type="checkbox" aria-label={`选择地址组 ${group.recipientInfo || group.recipientName || group.key}`} checked={checked} onChange={() => setSelectedGroupKeys((current) => {
              const next = new Set(current);
              if (next.has(group.key)) next.delete(group.key);
              else next.add(group.key);
              return next;
            })} />
            <div className="shipping-address-party">
              <strong>{group.recipientName || '未填收件人'}</strong>
              <span title={group.recipientInfo || undefined}>{group.recipientInfo || '未填收件信息'}</span>
            </div>
            <div className="shipping-address-totals">
              <span>箱数 <b>{boxSummary}</b></span>
              <span>件数 <b>{pieceSummary}</b></span>
              <button type="button" className="button button-ghost button-sm" disabled={!view.sheetLine} title="复制本地址组的箱数、件数和收件信息" onClick={() => { void copyLine(view.sheetLine); }}><Clipboard size={13} />复制</button>
            </div>
            {(multi || canMerge) && <div className="shipping-address-badges">
              {multi && <span className="badge badge-neutral">{group.orders.length} 单</span>}
              {multi && unpaidCount > 0 && <span className="badge badge-danger">{unpaidCount} 单未收款</span>}
              {canSplit && <button type="button" className="button button-ghost button-sm" title="拆开后分别填单号、分别确认" onClick={() => splitGroup(group)}><SplitSquareHorizontal size={13} />拆开</button>}
              {canMerge && <button type="button" className="button button-ghost button-sm" title="重新并回同一个地址组" onClick={() => mergeGroup(group)}><SplitSquareHorizontal size={13} />合并地址</button>}
            </div>}
          </header>

          <div className="shipping-address-tracking">
            <input
              className="input shipping-tracking-input"
              aria-label={multi ? `合并物流单号-${group.recipientName || '同地址'}` : `${group.orders[0]?.orderNo ?? ''}物流单号`}
              value={view.trackingValue}
              onChange={(event) => changeGroupTracking(group, event.target.value)}
              onBlur={(event) => { void saveGroupTracking(group, event.target.value); }}
              placeholder={multi ? '合并发货统一物流单号' : '回填物流单号'}
            />
            {view.trackingConflict && <span className="shipping-address-hint is-warning">组内单号不一致{originalTrackings.length ? `（${originalTrackings.join(' / ')}）` : ''}，请输入本次统一单号</span>}
            {view.saving && <span className="shipping-address-hint">保存中…</span>}
          </div>

          <div className="shipping-address-orders">
            {view.selections.map((selection) => {
              const order = selection.order;
              const remainingItems = order.items.filter((item) => remainingQuantity(item) > 0);
              const paid = isOrderPaid(order);
              const progress = getOrderFulfillmentProgress(order.items);
              return <section className="shipping-address-order" key={orderKeyOf(order)}>
                <div className="shipping-address-order-head">
                  <strong>{order.orderNo}</strong>
                  <span>{order.customerName || '未填客户'}</span>
                  {!paid && <span className="badge badge-danger">未收款</span>}
                  {progress.shippedQuantity > 0 && <span className="shipping-address-order-progress">已发 {progress.shippedQuantity}/{progress.totalQuantity} 件 · 剩余 {progress.remainingQuantity} 件</span>}
                  {onOpenDetail && <button type="button" className="link-button" title="查看该订单的发货记录、撤销和清单" onClick={() => onOpenDetail(order)}>发货记录</button>}
                </div>
                <div className="shipping-batch-item-list">
                  {remainingItems.map((item) => {
                    const quantity = Math.min(remainingQuantity(item), Math.max(0, Math.trunc(Number((quantities[orderKeyOf(order)] ?? {})[item.id] ?? 0))));
                    return <div className="shipping-batch-item" key={item.id}>
                      <input type="checkbox" aria-label={`选择${order.orderNo}-${item.name}`} checked={quantity > 0} onChange={(event) => setItemQuantity(order, item, event.target.checked ? remainingQuantity(item) : 0)} />
                      <span className="shipping-batch-item-copy">
                        <strong title={item.name}>{item.name || '未填产品'}</strong>
                        <span title={`${item.specification || '—'} · 剩余 ${remainingQuantity(item)} 件`}>{item.specification || '—'} · 剩余 {remainingQuantity(item)} 件</span>
                      </span>
                      <input type="number" min={0} max={remainingQuantity(item)} aria-label={`${order.orderNo}-${item.name}-本次数量`} value={quantity} onChange={(event) => setItemQuantity(order, item, Number(event.target.value))} />
                      <span className="shipping-batch-item-boxes">{quantity > 0 ? `${boxesForQuantity(quantity, item.packSize)} 箱` : '—'}</span>
                    </div>;
                  })}
                  {!remainingItems.length && <div className="shipping-address-hint">该订单已全部发完</div>}
                </div>
              </section>;
            })}
          </div>

          <footer className="shipping-address-footer">
            <div className="shipping-address-footer-actions">
              <button type="button" className="button button-ghost button-sm" onClick={() => fillGroup(group)}>本次全发</button>
              <button type="button" className="button button-ghost button-sm" onClick={() => clearGroup(group)}>清空数量</button>
            </div>
            <span className="shipping-address-invalid">{view.invalidReason}</span>
            <button type="button" className="button button-primary button-sm" disabled={view.invalid || Boolean(confirming)} title={view.invalidReason || undefined} onClick={() => { void confirmGroup(view); }}>
              <Send size={13} />{confirming === group.key ? '提交中…' : multi ? '确认合并发货' : '确认本次发货'}
            </button>
          </footer>
        </article>;
      })}
      {!visibleViews.length && <div className="table-state">{needle ? '没有匹配的发货中订单' : '暂无发货中订单，去待发货点「发货」'}</div>}
    </div>

    <section className="shipping-progress-sheet">
      <div className="shipping-sheet-head">
        <strong>发货表</strong>
        <span className="shipping-address-hint">{sheetLines.length} 个地址 · 箱数按每单拆解</span>
        <button type="button" className="button button-secondary button-sm" disabled={!sheetText} onClick={() => { void copySheet(); }}><Clipboard size={13} />复制发货表</button>
      </div>
      <textarea className="textarea" readOnly rows={Math.max(3, Math.min(8, sheetLines.length + 1))} value={sheetText} aria-label="发货表" placeholder="本次有数量后，这里按地址组生成可复制的收件信息与发货件数" />
    </section>

    {selectedViews.length > 0 && <div className="shipping-progress-bulk" role="region" aria-label="发货中批量操作">
      <span className="badge badge-accent">已选 {selectedViews.length} 个地址 · {selectedOrderCount} 单</span>
      {batchErrors.length > 0 && <span className="notice notice-warning" title={batchErrors.join('\n')}>{batchErrors[0]}{batchErrors.length > 1 ? ` 等 ${batchErrors.length} 项` : ''}</span>}
      <button type="button" className="button button-primary button-sm" disabled={Boolean(confirming) || batchErrors.length > 0} onClick={() => { void confirmSelected(); }}><Send size={13} />{confirming === 'batch' ? '提交中…' : '确认选中发货'}</button>
      <button type="button" className="button button-ghost button-sm" onClick={() => setSelectedGroupKeys(new Set())}>取消选择</button>
    </div>}
  </div>;
}
