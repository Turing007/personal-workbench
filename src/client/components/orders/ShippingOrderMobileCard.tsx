import { Download, FileText, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PartialShipmentEntryInput } from '../../../shared/shipping';
import type { OrderDraft, OrderStatus } from '../OrderForm';
import ShippingProductEditor from './ShippingProductEditor';
import { downloadOrderShippingList } from './download-order-shipping-list';
import { useShippingDraft } from './use-shipping-draft';

export interface ShippingOrderMobileCardProps {
  order: OrderDraft;
  selected?: boolean;
  onToggleSelect?: () => void;
  onQuantitiesChange?: (orderKey: string, quantities: Record<string, number>) => void;
  onOpenDetail?: (order: OrderDraft) => void;
  onEditLabels?: (order: OrderDraft) => void;
  onEditRecipient?: (order: OrderDraft) => void;
  onRollbackStatus?: (order: OrderDraft, status: OrderStatus) => void;
  onConfirmShipping?: (entries: PartialShipmentEntryInput[]) => Promise<{ batchId: number } | undefined>;
  onSaveTracking?: (orderId: string, trackingNo: string) => Promise<boolean>;
  onRefresh?: () => Promise<void> | void;
  onNotify?: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

export default function ShippingOrderMobileCard({ order, selected = false, onToggleSelect, onQuantitiesChange, onOpenDetail, onEditLabels, onEditRecipient, onRollbackStatus, onConfirmShipping, onSaveTracking, onRefresh, onNotify }: ShippingOrderMobileCardProps) {
  const draft = useShippingDraft({ order, onConfirmShipping, onSaveTracking, onRefresh, onNotify });
  const hasShipments = order.items.some((item) => (item.shippedQuantity ?? 0) > 0);
  const boxCount = Number(order.totalBoxes ?? 0) || order.items.reduce((sum, item) => sum + (Number(item.boxes) || 0), 0);
  const [sheetBusy, setSheetBusy] = useState(false);

  useEffect(() => {
    onQuantitiesChange?.(order.id ?? order.orderNo, draft.quantities);
  }, [draft.quantities]);

  const downloadSheet = async () => {
    setSheetBusy(true);
    try {
      const fileName = await downloadOrderShippingList(
        order,
        draft.selections.map(({ item, quantity }) => ({ orderItemId: Number(item.id), quantity })),
        draft.trackingNo.trim(),
      );
      onNotify?.(`已生成 ${fileName}`, 'success');
    } catch (error) {
      onNotify?.(error instanceof Error ? error.message : '发货清单生成失败', 'error');
    } finally {
      setSheetBusy(false);
    }
  };

  return <article className="order-card orders-shipping-mobile-card" aria-label={`发货中订单 ${order.orderNo}`}>
    <div className="order-card-head">
      <input type="checkbox" className="orders-shipping-mobile-check" checked={selected} onChange={onToggleSelect} aria-label={`选择发货中订单${order.orderNo}`} />
      <div className="order-card-title">
        <strong>{order.orderNo}</strong>
        <span>
          {order.customerId == null && order.customerName?.trim() ? '临时 · ' : ''}{order.customerName || '未填客户'} · {order.orderedAt.replace('T', ' ')} ·{' '}
          {onEditRecipient
            ? <button type="button" className="order-recipient-link" title="编辑收件人信息" onClick={() => onEditRecipient(order)}>{order.recipientName || '未填收件人'}</button>
            : order.recipientName || '未填收件人'}
        </span>
      </div>
      <span className="badge badge-info">发货中</span>{order.paymentPolicy === 'credit' && <span className="badge badge-neutral">账期</span>}
    </div>

    <div className="orders-shipping-mobile-meta">
      <button type="button" className="order-box-link" title="编辑/打印箱唛" onClick={() => onEditLabels?.(order)}>{boxCount} 箱</button>
      {!draft.paid && <span className="badge badge-danger">{draft.paymentStatus === 'partial' ? '部分收款' : '未收款'}</span>}
    </div>

    <ShippingProductEditor orderNo={order.orderNo} items={draft.remainingItems} quantities={draft.quantities} onQuantityChange={draft.setQuantity} />

    <label className="orders-shipping-mobile-tracking">
      <span>物流单号</span>
      <input className="input" aria-label={`${order.orderNo}物流单号`} value={draft.trackingNo} onChange={(event) => draft.setTrackingNo(event.target.value)} onBlur={() => { void draft.saveTracking(); }} placeholder="回填物流单号" />
    </label>
    {draft.reason && <span className="orders-shipping-row-reason">{draft.reason}</span>}

    <div className="orders-shipping-mobile-actions">
      <div className="orders-shipping-row-links">
        {onOpenDetail && <button type="button" className="link-button" onClick={() => onOpenDetail(order)}><FileText size={13} />详情</button>}
        <button type="button" className="link-button" disabled={sheetBusy || !draft.selections.length} title={draft.selections.length ? '按当前填写的本次数量生成发货清单，可随包打印' : '先填写本次发货数量'} onClick={() => { void downloadSheet(); }}><Download size={13} />{sheetBusy ? '生成中…' : '发货清单'}</button>
        {!hasShipments && onRollbackStatus && <button type="button" className="link-button muted" onClick={() => onRollbackStatus(order, 'ship_pending')}><Undo2 size={13} />回退</button>}
      </div>
      <button type="button" className="button button-primary" disabled={draft.disabled} title={draft.reason || '确认本次发货'} onClick={() => { void draft.confirm(); }}>{draft.submitting ? '提交中…' : '确认发货'}</button>
    </div>
  </article>;
}
