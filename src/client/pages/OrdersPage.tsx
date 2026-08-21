import { ListFilter, Plus, Printer, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { autoPack } from '../../shared/packing';
import LabelEditorModal, { type CartonLabel } from '../components/LabelEditorModal';
import Modal from '../components/Modal';
import OrderDetailModal from '../components/OrderDetailModal';
import OrderForm, { type CustomerProduct, type OrderDraft, type OrderStatus } from '../components/OrderForm';
import PrintWorkspace from '../components/PrintWorkspace';
import StatusCards from '../components/StatusCards';
import { getOrderNextAction, isUnshippedOrder } from '../order-workflow';
import type { Customer, CustomerSaveInput } from '../../shared/customers';

export interface OrdersPageProps {
  orders: OrderDraft[];
  customers: Customer[];
  statusCounts?: Partial<Record<'all' | OrderStatus, number>>;
  labelsByOrderId?: Record<string, CartonLabel[]>;
  onSaveOrder: (order: OrderDraft) => void;
  onDeleteOrder?: (order: OrderDraft) => void;
  onSaveCustomerProduct?: (customerId: number, input: import('../../shared/customers').CustomerProductSaveInput) => Promise<import('../../shared/customers').CustomerProduct | undefined>;
  onCreateCustomer?: (input: CustomerSaveInput) => Promise<Customer>;
  onGetNextOrderNumber?: () => Promise<string | undefined>;
  onDeleteContract?: (contractId: string) => Promise<void>;
  onAdvanceStatus?: (order: OrderDraft, status: OrderStatus) => void;
  onOpenShipping?: (order: OrderDraft) => void;
  onOpenFinance?: (order: OrderDraft) => void;
  onSaveLabels?: (order: OrderDraft, labels: CartonLabel[]) => void | Promise<CartonLabel[] | undefined>;
  onMergeLabels?: (order: OrderDraft, labelIds: string[]) => Promise<CartonLabel[] | undefined> | CartonLabel[] | undefined;
  onRestoreAutoLabels?: (order: OrderDraft) => Promise<CartonLabel[] | undefined> | CartonLabel[] | undefined;
  onPrintHistory?: (labels: CartonLabel[]) => void | Promise<void>;
}

const statusLabels: Record<OrderStatus, string> = {
  label_pending: '待打印箱唛',
  pending_stock: '待备货',
  stock_reported: '已备货',
  pending_packing: '待打包',
  ship_pending: '待发货',
  shipped: '已发货',
};

function orderKey(order: OrderDraft): string { return order.id ?? order.orderNo; }

function orderBoxCount(order: OrderDraft): number {
  return order.totalBoxes && order.totalBoxes > 0
    ? order.totalBoxes
    : order.items.reduce((sum, item) => sum + item.boxes, 0);
}

export function fallbackLabels(order: OrderDraft): CartonLabel[] {
  const productTotals = new Map<string, number>();
  order.items.forEach((item) => {
    const key = `${item.name}\u0000${item.sku}\u0000${item.specification}`;
    productTotals.set(key, (productTotals.get(key) ?? 0) + Math.max(1, Math.trunc(item.quantity)));
  });
  const packed = autoPack(order.items.map((item) => ({
    id: item.id,
    orderId: orderKey(order),
    orderNo: order.orderNo,
    recipientName: order.recipientName,
    productName: item.name,
    sku: item.sku,
    spec: item.specification,
    quantity: Math.max(1, Math.trunc(item.quantity)),
    packSizes: (item.packaging?.map((pack) => Math.max(1, Math.trunc(pack.packSize))) ?? [Math.max(1, Math.trunc(item.packSize))]),
    remark: item.remark,
    orderRemark: order.orderDetail,
  })));
  return packed.map((box) => {
    const rawLines = box.tailItems?.length ? box.tailItems : [{
      sourceItemId: box.sourceItemIds[0],
      productName: box.productName,
      sku: box.sku,
      spec: box.spec,
      quantity: box.quantity,
      packSize: box.packSize,
      boxCount: box.boxCount ?? 1,
      totalQuantity: box.totalQuantity,
      remark: box.productRemark,
    }];
    return {
      id: `${orderKey(order)}-label-${box.cartonNo}-${box.id}`,
      orderId: orderKey(order),
      orderNo: order.orderNo,
      recipientName: order.recipientName,
      cartonNo: box.cartonNo,
      totalCartons: box.totalCartons,
      isTail: box.isTail,
      orderRemark: order.orderDetail,
      remark: box.remark,
      lines: rawLines.map((line, index) => ({
        id: `${box.id}-line-${index}`,
        orderItemId: line.sourceItemId == null ? null : Number(line.sourceItemId),
        sku: line.sku,
        name: line.productName,
        specification: line.spec,
        packSize: line.packSize,
        quantity: line.quantity,
        boxCount: line.boxCount,
        totalQuantity: productTotals.get(`${line.productName ?? ''}\u0000${line.sku}\u0000${line.spec}`) ?? line.totalQuantity,
        remark: line.remark,
      })),
    };
  });
}

export default function OrdersPage({ orders, customers, statusCounts, labelsByOrderId, onSaveOrder, onDeleteOrder, onSaveCustomerProduct, onCreateCustomer, onGetNextOrderNumber, onDeleteContract, onAdvanceStatus, onOpenShipping, onOpenFinance, onSaveLabels, onMergeLabels, onRestoreAutoLabels, onPrintHistory }: OrdersPageProps) {
  const [filter, setFilter] = useState<'all' | OrderStatus>('all');
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailOrder, setDetailOrder] = useState<OrderDraft>();
  const [editingOrder, setEditingOrder] = useState<OrderDraft>();
  const [creating, setCreating] = useState(false);
  const [labelOrder, setLabelOrder] = useState<OrderDraft>();
  const [labels, setLabels] = useState<CartonLabel[]>([]);
  const [printLabels, setPrintLabels] = useState<CartonLabel[]>([]);

  useEffect(() => {
    if (!detailOrder) return;
    const refreshed = orders.find((order) => orderKey(order) === orderKey(detailOrder));
    if (refreshed && refreshed !== detailOrder) setDetailOrder(refreshed);
  }, [detailOrder, orders]);

  const counts = useMemo(() => {
    const next: Partial<Record<'all' | OrderStatus, number>> = { all: orders.length };
    orders.forEach((order) => { if (order.status) next[order.status] = (next[order.status] ?? 0) + 1; });
    return { ...next, ...statusCounts };
  }, [orders, statusCounts]);

  const visibleOrders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesStatus = filter === 'all' || order.status === filter;
      const searchable = [order.orderNo, order.recipientName, ...order.items.flatMap((item) => [item.name, item.sku, item.specification])].join(' ').toLowerCase();
      return matchesStatus && (!needle || searchable.includes(needle));
    });
  }, [filter, orders, query]);

  const openLabels = (order: OrderDraft) => {
    setLabelOrder(order);
    setLabels(labelsByOrderId?.[orderKey(order)] ?? fallbackLabels(order));
  };
  const printableOrders = visibleOrders.filter((order) => order.status !== 'shipped');
  const selectedOrders = printableOrders.filter((order) => selectedIds.includes(orderKey(order)));
  const allPrintableSelected = printableOrders.length > 0 && printableOrders.every((order) => selectedIds.includes(orderKey(order)));
  const toggleAll = () => setSelectedIds((ids) => {
    const visiblePrintableIds = printableOrders.map(orderKey);
    if (allPrintableSelected) return ids.filter((id) => !visiblePrintableIds.includes(id));
    return [...new Set([...ids, ...visiblePrintableIds])];
  });
  const bulkPrint = () => setPrintLabels(selectedOrders.flatMap((order) => labelsByOrderId?.[orderKey(order)] ?? fallbackLabels(order)));
  const saveLabels = async (next: CartonLabel[]) => {
    setLabels(next);
    if (!labelOrder) return undefined;
    const saved = await onSaveLabels?.(labelOrder, next);
    return saved ?? next;
  };

  const openEdit = (order: OrderDraft) => { setDetailOrder(undefined); setEditingOrder(order); };
  const deleteOrder = (order: OrderDraft) => { if (!onDeleteOrder) return; onDeleteOrder(order); setDetailOrder(undefined); setEditingOrder(undefined); setLabelOrder(undefined); };
  const confirmDeleteOrder = (order: OrderDraft) => { if (!window.confirm(`确定删除订单“${order.orderNo}”吗？订单及其附件、箱唛数据将一并删除。`)) return; deleteOrder(order); };

  return <div className="page-shell orders-page" style={{ gap: 12, minHeight: '100%' }}>
    <div className="page-toolbar"><div><strong className="page-title">订单工作台</strong><span className="page-subtitle">跟进备货、打包、发货与箱唛打印进度</span></div></div>
    <StatusCards activeKey={filter} counts={counts} onSelect={setFilter} />
    <section className="table-panel">
      <div className="page-toolbar table-toolbar" style={{ padding: 11, minHeight: 0, flexWrap: 'wrap' }}>
        <button type="button" className="button button-primary" onClick={() => setCreating(true)}><Plus size={15} />新建订单</button>
        <div className="search-control"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索订单号、收件人、品名、SKU、规格" /></div>
        <span className="toolbar-count"><ListFilter size={14} style={{ verticalAlign: -2, marginRight: 3 }} />{visibleOrders.length} 条订单</span>
        {selectedOrders.length > 0 && <><span className="badge badge-accent">已选 {selectedOrders.length} 条</span><button type="button" className="button button-secondary button-sm" onClick={bulkPrint}><Printer size={14} />批量打印箱唛</button></>}
      </div>
      <div className="table-scroll"><table className="data-table" style={{ minWidth: 950 }}><thead><tr><th style={{ width: 38 }}><input type="checkbox" checked={allPrintableSelected} onChange={toggleAll} aria-label="选择当前列表待打印箱唛订单" /></th>{['订单号', '下单时间', '收件人', '总箱数', '金额', '状态', '物流单号', '操作'].map((title) => <th key={title}>{title}</th>)}</tr></thead><tbody>{visibleOrders.map((order) => { const id = orderKey(order); const boxCount = orderBoxCount(order); const nextAction = getOrderNextAction(order.status); const printable = isUnshippedOrder(order); return <tr key={id}><td><input type="checkbox" disabled={!printable} checked={printable && selectedIds.includes(id)} onChange={() => setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])} aria-label={`选择订单${order.orderNo}`} /></td><td className="strong-cell">{order.orderNo}</td><td>{order.orderedAt.replace('T', ' ')}</td><td>{order.recipientName}</td><td style={{ fontWeight: 650 }}>{boxCount}</td><td className="amount">¥ {order.amount || '0.00'}</td><td><span className={`badge ${order.status === 'shipped' ? 'badge-success' : order.status === 'ship_pending' ? 'badge-warning' : 'badge-neutral'}`}>{order.status ? statusLabels[order.status] : '-'}</span><div style={{ marginTop: 4, fontSize: 10, color: order.labelPrintedAt ? '#0f766e' : '#b45309' }}>{order.labelPrintedAt ? `已打印箱唛 · ${order.labelPrintedAt.replace('T', ' ').slice(0, 16)}` : '箱唛待打印'}</div></td><td>{order.trackingNo || '—'}</td><td><div className="row-actions"><button type="button" className="link-button" onClick={() => setDetailOrder(order)}>详情</button><button type="button" className="link-button" onClick={() => openEdit(order)}>编辑</button><button type="button" className="link-button" onClick={() => openLabels(order)}>箱唛</button>{nextAction?.kind === 'advance' && onAdvanceStatus && <button type="button" className="link-button muted" title={nextAction.label} onClick={() => onAdvanceStatus(order, nextAction.target)}>{nextAction.label}</button>}{nextAction?.kind === 'shipping' && onOpenShipping && <button type="button" className="link-button muted" title={nextAction.label} onClick={() => onOpenShipping(order)}>{nextAction.label}</button>}{onDeleteOrder && <button type="button" className="icon-button danger" title="删除订单" onClick={() => confirmDeleteOrder(order)}><Trash2 size={14} /></button>}</div></td></tr>; })}</tbody></table>{!visibleOrders.length && <div className="table-state">暂无符合条件的订单</div>}</div>
    </section>

    <Modal open={creating || Boolean(editingOrder)} title={editingOrder ? `编辑订单 · ${editingOrder.orderNo}` : '新建订单'} onClose={() => { setCreating(false); setEditingOrder(undefined); }} width={1080}><OrderForm key={editingOrder?.id ?? (creating ? 'new' : 'closed')} value={editingOrder} customers={customers} onSaveCustomerProduct={onSaveCustomerProduct} onCreateCustomer={onCreateCustomer} onGetNextOrderNumber={onGetNextOrderNumber} onSubmit={(order) => { onSaveOrder(order); setCreating(false); setEditingOrder(undefined); }} onCancel={() => { setCreating(false); setEditingOrder(undefined); }} /></Modal>
    <OrderDetailModal open={Boolean(detailOrder)} order={detailOrder} onClose={() => setDetailOrder(undefined)} onEditOrder={openEdit} onEditLabels={(order) => { setDetailOrder(undefined); openLabels(order); }} onPrintLabels={(order) => { setDetailOrder(undefined); setPrintLabels(labelsByOrderId?.[orderKey(order)] ?? fallbackLabels(order)); }} onDeleteContract={onDeleteContract} onDeleteOrder={onDeleteOrder ? confirmDeleteOrder : undefined} onAdvanceStatus={onAdvanceStatus} onOpenFinance={onOpenFinance} />
    <LabelEditorModal open={Boolean(labelOrder)} order={labelOrder} labels={labels} onClose={() => setLabelOrder(undefined)} onSave={saveLabels} onMerge={onMergeLabels && labelOrder ? (ids) => { void Promise.resolve(onMergeLabels(labelOrder, ids)).then((next) => { if (next) setLabels(next); }); } : undefined} onRestoreAuto={onRestoreAutoLabels && labelOrder ? () => { void Promise.resolve(onRestoreAutoLabels(labelOrder)).then((next) => { if (next) setLabels(next); }); } : undefined} onPrint={(next) => setPrintLabels(next)} />
    <PrintWorkspace open={printLabels.length > 0} labels={printLabels} onClose={() => setPrintLabels([])} onPrinted={onPrintHistory} />
  </div>;
}
