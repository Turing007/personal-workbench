import { Download, Truck, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ShipmentRecord } from '../../../shared/shipping';
import { downloadShipmentPdf, getOrderShipments, voidShipment } from '../../api';
import { saveFileOrDownload } from '../../file-save';
import type { OrderDraft } from '../OrderForm';

export interface OrderShipmentsPanelProps {
  order: OrderDraft;
  onChanged?: () => Promise<void> | void;
  onNotify?: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

function formatDateTime(value: string) {
  return value ? value.replace('T', ' ').slice(0, 16) : '';
}

export default function OrderShipmentsPanel({ order, onChanged, onNotify }: OrderShipmentsPanelProps) {
  const [shipments, setShipments] = useState<ShipmentRecord[]>([]);
  const [busyId, setBusyId] = useState<number>();

  const reload = async () => {
    if (!order.id) return;
    try {
      setShipments(await getOrderShipments(order.id));
    } catch (error) {
      onNotify?.(error instanceof Error ? error.message : '发货记录加载失败', 'error');
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, order.status, order.items.map((item) => item.shippedQuantity ?? 0).join(',')]);

  if (!shipments.length) return null;

  const exportPdf = async (shipment: ShipmentRecord) => {
    setBusyId(shipment.id);
    try {
      const blob = await downloadShipmentPdf(shipment.id);
      await saveFileOrDownload(blob, `${shipment.shipmentNo || shipment.orderNo}-发货清单.pdf`);
    } catch (error) {
      onNotify?.(error instanceof Error ? error.message : '发货清单生成失败', 'error');
    } finally {
      setBusyId(undefined);
    }
  };

  const undo = async (shipment: ShipmentRecord) => {
    if (!window.confirm(`确定撤销发货记录「${shipment.shipmentNo || shipment.trackingNo}」吗？对应产品数量会恢复为未发货。`)) return;
    setBusyId(shipment.id);
    try {
      await voidShipment(shipment.id);
      await reload();
      await onChanged?.();
      onNotify?.('发货记录已撤销，订单数量已恢复', 'success');
    } catch (error) {
      onNotify?.(error instanceof Error ? error.message : '撤销发货失败', 'error');
    } finally {
      setBusyId(undefined);
    }
  };

  return <section style={{ display: 'grid', gap: 8, padding: 12, border: '1px solid var(--tone-border-soft)', borderRadius: 'var(--radius-ui)', background: 'var(--tone-surface-frost)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Truck size={15} />
      <strong style={{ fontSize: 13 }}>发货记录</strong>
      <span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>（{shipments.length} 次）</span>
    </div>
    <div style={{ display: 'grid', gap: 8 }}>
      {shipments.map((shipment) => <div key={shipment.id} style={{ display: 'grid', gap: 5, padding: '8px 9px', border: '1px solid var(--tone-border-soft)', borderRadius: 'var(--radius-ui)', background: 'var(--color-surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ color: 'var(--tone-text-strong)', fontSize: 12 }}>{shipment.shipmentNo}</strong>
          <span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>{formatDateTime(shipment.shippedAt)}</span>
          <span style={{ color: 'var(--tone-accent-text)', fontSize: 11 }}>{shipment.trackingNo}</span>
          <span style={{ marginLeft: 'auto', color: 'var(--tone-text-faint)', fontSize: 11 }}>{shipment.totalBoxes} 箱</span>
        </div>
        <div style={{ color: 'var(--tone-text-soft)', fontSize: 11, lineHeight: 1.55 }}>
          {shipment.items.map((item) => `${item.name} ×${item.quantity}（剩 ${item.remainingAfter}）`).join('；')}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button type="button" className="button button-secondary button-sm" disabled={busyId === shipment.id} onClick={() => { void exportPdf(shipment); }}><Download size={13} />发货清单</button>
          <button type="button" className="button button-ghost button-sm" disabled={busyId === shipment.id} onClick={() => { void undo(shipment); }}><Undo2 size={13} />撤销本次</button>
        </div>
      </div>)}
    </div>
  </section>;
}
