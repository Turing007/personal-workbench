import { useEffect, useMemo, useState } from 'react';
import ShippingBatchPanel from '../components/ShippingBatchPanel';
import type { OrderDraft } from '../components/OrderForm';
import type { OrderChannel } from '../../shared/domain';
import type { PartialShipmentEntryInput } from '../../shared/shipping';
import { downloadShippingBatchPdf } from '../api';
import { saveFileOrDownload } from '../file-save';

export interface ShippingPageProps {
  orders: OrderDraft[];
  initialOrder?: OrderDraft;
  initialOrders?: OrderDraft[];
  onUpdateTracking?: (orderId: string, value: string) => void;
  /** 保存批次内的物流单号，不推进状态。 */
  onSaveTracking?: (orderId: string, value: string) => Promise<boolean>;
  onConfirm?: (entries: PartialShipmentEntryInput[]) => Promise<{ batchId: number } | void> | void;
  onNotify?: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

export default function ShippingPage({ orders, initialOrder, initialOrders, onUpdateTracking, onSaveTracking, onConfirm, onNotify }: ShippingPageProps) {
  const [batch, setBatch] = useState<OrderDraft[]>([]);
  const [lastBatchId, setLastBatchId] = useState<number>();
  const [batchPdfBusy, setBatchPdfBusy] = useState(false);
  const [channel, setChannel] = useState<'all' | OrderChannel>('all');
  const eligible = useMemo(() => orders.filter((order) => order.status === 'ship_pending' && (channel === 'all' || order.channel === channel)), [orders, channel]);
  useEffect(() => {
    if (initialOrder?.status === 'ship_pending') setBatch((current) => current.some((item) => item.id === initialOrder.id) ? current : [...current, initialOrder]);
  }, [initialOrder]);
  // 批量发货入口：把所选待发货订单一次性预载进发货批次，补录物流单号后统一确认。
  useEffect(() => {
    if (!initialOrders?.length) return;
    setBatch((current) => {
      const ids = new Set(current.map((item) => item.id));
      const additions = initialOrders.filter((order) => order.id != null && order.status === 'ship_pending' && !ids.has(order.id));
      return additions.length ? [...current, ...additions] : current;
    });
  }, [initialOrders]);
  const add = (order: OrderDraft) => setBatch((current) => current.some((item) => item.id === order.id) ? current : [...current, order]);
  const remove = (id: string) => setBatch((current) => current.filter((order) => (order.id ?? order.orderNo) !== id));
  const tracking = (id: string, value: string) => {
    setBatch((current) => current.map((order) => (order.id ?? order.orderNo) === id ? { ...order, trackingNo: value } : order));
    onUpdateTracking?.(id, value);
  };
  const confirm = async (entries: PartialShipmentEntryInput[]) => {
    const result = await onConfirm?.(entries);
    setBatch([]);
    if (result?.batchId) setLastBatchId(result.batchId);
  };
  const downloadLastBatchPdf = async () => {
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
  return <div className="page-shell shipping-page">
    <div className="shipping-page-head">
      <div className="shipping-heading-copy">
        <span className="page-breadcrumb">履约 / 发货</span>
        <strong className="page-title">发货工作区</strong>
        <span className="page-subtitle">把待发货订单加入批次，回填物流单号后确认发货</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <select className="toolbar-select" aria-label="订单渠道筛选" value={channel} onChange={(event) => setChannel(event.target.value as 'all' | OrderChannel)}><option value="all">全部渠道</option><option value="online">线上订单</option><option value="offline">线下订单</option></select>
        <span className="badge badge-warning">{eligible.length} 条待发货</span>
      </div>
    </div>
    {lastBatchId && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '4px 0', color: 'var(--erp-muted)', fontSize: 11 }}>
      <span>上一批发货已确认</span>
      <button type="button" className="button button-secondary button-sm" disabled={batchPdfBusy} onClick={() => { void downloadLastBatchPdf(); }}>{batchPdfBusy ? '生成中…' : '下载本批发货清单'}</button>
    </div>}
    <section className="table-panel shipping-panel">
      <ShippingBatchPanel orders={batch} allOrders={eligible} onAdd={add} onRemove={remove} onTrackingChange={tracking} onSaveTracking={onSaveTracking} onClear={() => setBatch([])} onConfirm={confirm} />
    </section>
  </div>;
}
