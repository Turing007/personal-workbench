import { Download, FileText, Printer, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PartialShipmentEntryInput } from '../../../shared/shipping';
import type { OrderDraft, OrderStatus } from '../OrderForm';
import ShippingProductEditor from './ShippingProductEditor';
import { downloadOrderShippingList } from './download-order-shipping-list';
import { useShippingDraft } from './use-shipping-draft';

export interface ShippingOrderTableRowProps {
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

export default function ShippingOrderTableRow({ order, selected = false, onToggleSelect, onQuantitiesChange, onOpenDetail, onEditLabels, onEditRecipient, onRollbackStatus, onConfirmShipping, onSaveTracking, onRefresh, onNotify }: ShippingOrderTableRowProps) {
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

  return <tr className="orders-shipping-row">
    <td className="order-check-cell"><input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`选择发货中订单${order.orderNo}`} /></td>
    <td className="strong-cell order-no-cell"><div className="order-no-stack"><span title={order.orderNo}>{order.orderNo}</span><span className="order-no-date">{order.orderedAt.replace('T', ' ')}</span></div></td>
    <td className="order-customer-cell"><div className="order-party">
      <strong className="order-party-customer" title={order.customerName || undefined}>{order.customerName || '未填客户'}{order.customerId == null && order.customerName?.trim() && <span className="badge badge-neutral" style={{ marginLeft: 5 }}>临时</span>}</strong>
      {onEditRecipient
        ? <button type="button" className="order-party-recipient order-recipient-link" title="编辑收件人信息" onClick={() => onEditRecipient(order)}>收件人：{order.recipientName || '未填'}</button>
        : <span className="order-party-recipient">收件人：{order.recipientName || '—'}</span>}
    </div></td>
    <td className="order-product-cell"><ShippingProductEditor orderNo={order.orderNo} items={draft.remainingItems} quantities={draft.quantities} onQuantityChange={draft.setQuantity} /></td>
    <td className="order-box-cell"><button type="button" className="order-box-link" title="编辑/打印箱唛" onClick={() => onEditLabels?.(order)}>{boxCount}</button></td>
    <td className="order-status-cell">
      <span className="badge badge-info">发货中</span>{order.paymentPolicy === 'credit' && <span className="badge badge-neutral">账期</span>}
      {!draft.paid && <span className="badge badge-danger">{draft.paymentStatus === 'partial' ? '部分收款' : '未收款'}</span>}
    </td>
    <td className="order-tracking-cell">
      <input className="input orders-shipping-tracking-input" aria-label={`${order.orderNo}物流单号`} value={draft.trackingNo} onChange={(event) => draft.setTrackingNo(event.target.value)} onBlur={() => { void draft.saveTracking(); }} placeholder="回填物流单号" />
      {draft.reason && <span className="orders-shipping-row-reason">{draft.reason}</span>}
    </td>
    <td className="order-ops-cell">
      <div className="orders-shipping-row-actions">
        <div className="orders-shipping-row-links">
          {onOpenDetail && <button type="button" className="link-button" onClick={() => onOpenDetail(order)}><FileText size={13} />详情</button>}
          {onEditLabels && <button type="button" className="link-button" onClick={() => onEditLabels(order)}><Printer size={13} />箱唛</button>}
          <button type="button" className="link-button" disabled={sheetBusy || !draft.selections.length} title={draft.selections.length ? '按当前填写的本次数量生成发货清单，可随包打印' : '先填写本次发货数量'} onClick={() => { void downloadSheet(); }}><Download size={13} />{sheetBusy ? '生成中…' : '发货清单'}</button>
          {!hasShipments && onRollbackStatus && <button type="button" className="link-button muted" onClick={() => onRollbackStatus(order, 'ship_pending')}><Undo2 size={13} />回退</button>}
        </div>
        <button type="button" className="button button-primary button-sm orders-shipping-confirm" disabled={draft.disabled} title={draft.reason || '确认本次发货'} onClick={() => { void draft.confirm(); }}>{draft.submitting ? '提交中…' : '确认发货'}</button>
      </div>
    </td>
  </tr>;
}
