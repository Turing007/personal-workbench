import { ChevronDown, ChevronUp, Package, PackageCheck, ListFilter, Plus, Printer, Trash2, Truck } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { autoPack } from '../../shared/packing';
import LabelEditorModal, { type CartonLabel } from '../components/LabelEditorModal';
import Modal from '../components/Modal';
import SearchInput from '../components/SearchInput';
import OrderDetailModal from '../components/OrderDetailModal';
import OrderItemsTable from '../components/OrderItemsTable';
import OrderForm, { type CustomerProduct, type OrderDraft, type OrderStatus } from '../components/OrderForm';
import OrderExpandPanel from '../components/orders/OrderExpandPanel';
import PrintWorkspace from '../components/PrintWorkspace';
import StatusCards from '../components/StatusCards';
import FilterRail, { FilterCheckList } from '../components/FilterRail';
import { useFilterRailOpen, useSavedFilterViews } from '../filter-views';
import { ORDER_STATUS_LABELS_WITH_DRAFT } from '../../shared/domain';
import { getOrderNextAction, isDraftOrder, isUnshippedOrder, type BatchAdvanceAction, type OrderNextAction } from '../order-workflow';
import { FINANCE_PAYMENT_STATUS_LABELS, type FinancePaymentStatus } from '../../shared/finance';
import { formatDateTime } from '../../shared/formatters';
import type { Company } from '../../shared/companies';
import type { Customer, CustomerSaveInput } from '../../shared/customers';
import { cartonLabelRequirement } from '../../shared/customers';
import { useIsNarrow } from '../use-is-narrow';
import { useHideOnScroll } from '../use-hide-on-scroll';

export interface OrdersPageProps {
  orders: OrderDraft[];
  customers: Customer[];
  companies?: Company[];
  statusCounts?: Partial<Record<'all' | OrderStatus, number>>;
  labelsByOrderId?: Record<string, CartonLabel[]>;
  initialOrderId?: number | null;
  /** 工作台跳转：直接设置状态筛选并打开新建订单。 */
  initialStatus?: OrderStatus;
  onInitialStatusConsumed?: () => void;
  startCreate?: boolean;
  onStartCreateConsumed?: () => void;
  onSaveOrder: (order: OrderDraft) => void;
  onSaveDraft?: (order: OrderDraft) => void;
  onDeleteOrder?: (order: OrderDraft) => void;
  onSaveCustomerProduct?: (customerId: number, input: import('../../shared/customers').CustomerProductSaveInput) => Promise<import('../../shared/customers').CustomerProduct | undefined>;
  onCreateCustomer?: (input: CustomerSaveInput) => Promise<Customer>;
  onGetNextOrderNumber?: () => Promise<string | undefined>;
  onDeleteContract?: (contractId: string) => Promise<void>;
  onGenerateContract?: (order: OrderDraft) => Promise<void>;
  onAdvanceStatus?: (order: OrderDraft, status: OrderStatus) => void;
  onBatchAdvance?: (orders: OrderDraft[], action: BatchAdvanceAction) => void;
  onPublishOrder?: (order: OrderDraft) => void;
  onOpenShipping?: (order: OrderDraft) => void;
  onOpenFinance?: (order: OrderDraft) => void;
  onSaveLabels?: (order: OrderDraft, labels: CartonLabel[]) => void | Promise<CartonLabel[] | undefined>;
  onMergeLabels?: (order: OrderDraft, labelIds: string[]) => Promise<CartonLabel[] | undefined> | CartonLabel[] | undefined;
  onRestoreAutoLabels?: (order: OrderDraft) => Promise<CartonLabel[] | undefined> | CartonLabel[] | undefined;
  onPrintHistory?: (labels: CartonLabel[]) => void | Promise<void>;
}

const statusLabels: Record<OrderStatus, string> = {
  draft: '草稿',
  label_pending: '待打印箱唛',
  pending_stock: '待备货',
  stock_reported: '已备货',
  pending_packing: '待打包',
  ship_pending: '待发货',
  shipped: '已发货',
};

function statusBadgeClass(status?: OrderStatus): string {
  if (status === 'draft') return 'badge badge-neutral';
  if (status === 'shipped') return 'badge badge-success';
  if (status === 'ship_pending') return 'badge badge-warning';
  return 'badge badge-neutral';
}

function orderKey(order: OrderDraft): string { return order.id ?? order.orderNo; }

function orderPaymentStatus(order: OrderDraft): FinancePaymentStatus { return order.financeSummary?.paymentStatus ?? 'unpaid'; }

const paymentBadgeClass: Record<FinancePaymentStatus, string> = {
  unpaid: 'badge badge-neutral',
  partial: 'badge badge-warning',
  paid: 'badge badge-success',
  overpaid: 'badge badge-info',
};

const paymentStatusColor: Record<FinancePaymentStatus, string> = {
  unpaid: 'var(--tone-text-soft)',
  partial: 'var(--color-warning-text)',
  paid: 'var(--color-success)',
  overpaid: 'var(--color-info)',
};

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
    remark: cartonLabelRequirement(item),
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

export default function OrdersPage({ orders, customers, companies = [], statusCounts, labelsByOrderId, initialOrderId, initialStatus, onInitialStatusConsumed, startCreate, onStartCreateConsumed, onSaveOrder, onSaveDraft, onDeleteOrder, onSaveCustomerProduct, onCreateCustomer, onGetNextOrderNumber, onDeleteContract, onGenerateContract, onAdvanceStatus, onBatchAdvance, onPublishOrder, onOpenShipping, onOpenFinance, onSaveLabels, onMergeLabels, onRestoreAutoLabels, onPrintHistory }: OrdersPageProps) {
  const [statusFilters, setStatusFilters] = useState<OrderStatus[]>([]);
  const [customerFilters, setCustomerFilters] = useState<number[]>([]);
  const [companyFilters, setCompanyFilters] = useState<number[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [detailOrder, setDetailOrder] = useState<OrderDraft>();
  const [productsOrder, setProductsOrder] = useState<OrderDraft>();
  const [editingOrder, setEditingOrder] = useState<OrderDraft>();
  const [creating, setCreating] = useState(false);
  const [labelOrder, setLabelOrder] = useState<OrderDraft>();
  const [labels, setLabels] = useState<CartonLabel[]>([]);
  const [printLabels, setPrintLabels] = useState<CartonLabel[]>([]);
  const consumedInitialOrderId = useRef<number | null>(null);
  useEffect(() => {
    if (!initialStatus) return;
    setStatusFilters([initialStatus]);
    onInitialStatusConsumed?.();
  }, [initialStatus, onInitialStatusConsumed]);
  useEffect(() => {
    if (!startCreate) return;
    setCreating(true);
    onStartCreateConsumed?.();
  }, [startCreate, onStartCreateConsumed]);
  const narrow = useIsNarrow();
  const [searchFocused, setSearchFocused] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  // 手机端搜索框悬浮在顶部：连续下滑收起，回滑展开；输入时锁住展开避免打字途中消失。
  const searchHidden = useHideOnScroll(narrow && !searchFocused);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!detailOrder) return;
    const refreshed = orders.find((order) => orderKey(order) === orderKey(detailOrder));
    if (refreshed && refreshed !== detailOrder) setDetailOrder(refreshed);
  }, [detailOrder, orders]);

  useEffect(() => {
    if (initialOrderId == null || consumedInitialOrderId.current === initialOrderId) return;
    const order = orders.find((item) => String(item.id) === String(initialOrderId));
    if (order) {
      consumedInitialOrderId.current = initialOrderId;
      setDetailOrder(order);
    }
  }, [initialOrderId, orders]);

  const counts = useMemo(() => {
    const next: Partial<Record<'all' | OrderStatus, number>> = { all: orders.length };
    orders.forEach((order) => { if (order.status) next[order.status] = (next[order.status] ?? 0) + 1; });
    return { ...next, ...statusCounts };
  }, [orders, statusCounts]);

  const filterState = useMemo(() => ({
    statuses: statusFilters,
    customers: customerFilters,
    companies: companyFilters,
    from: dateFrom,
    to: dateTo,
  }), [statusFilters, customerFilters, companyFilters, dateFrom, dateTo]);
  const applyFilterState = (next: typeof filterState) => {
    setStatusFilters(next.statuses);
    setCustomerFilters(next.customers);
    setCompanyFilters(next.companies);
    setDateFrom(next.from);
    setDateTo(next.to);
  };
  const savedFilters = useSavedFilterViews('orders', filterState, applyFilterState);
  const filterRail = useFilterRailOpen('orders');
  // 展开行 colspan 必须和当前实际可见列一致；否则多出的 colspan 会挤窄产品列。
  const orderTableColSpan = viewportWidth <= 900
    ? 10
    : viewportWidth <= 1199 ? 7
      : viewportWidth <= 1419 ? 8
        : (viewportWidth <= 1601 && filterRail.open) ? 8 : 10;

  const visibleOrders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesStatus = !statusFilters.length || (order.status != null && statusFilters.includes(order.status));
      const matchesCustomer = !customerFilters.length || (order.customerId != null && customerFilters.includes(order.customerId));
      const matchesCompany = !companyFilters.length || companyFilters.includes(order.companyId ?? -1);
      const orderDate = order.orderedAt.slice(0, 10);
      const matchesDate = (!dateFrom || orderDate >= dateFrom) && (!dateTo || orderDate <= dateTo);
      const searchable = [order.orderNo, order.customerName, order.recipientName, ...order.items.flatMap((item) => [item.name, item.sku, item.specification])].join(' ').toLowerCase();
      return matchesStatus && matchesCustomer && matchesCompany && matchesDate && (!needle || searchable.includes(needle));
    });
  }, [statusFilters, customerFilters, companyFilters, dateFrom, dateTo, orders, query]);

  const openLabels = (order: OrderDraft) => {
    setLabelOrder(order);
    setLabels(labelsByOrderId?.[orderKey(order)] ?? fallbackLabels(order));
  };
  const printableOrders = visibleOrders.filter((order) => order.status !== 'shipped' && !isDraftOrder(order));
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

  // 草稿发布是不可逆的正式流程入口：桌面行内链接与手机胶囊共用同一确认文案。
  const publishOrder = (order: OrderDraft) => {
    if (!onPublishOrder) return;
    if (!window.confirm(`确定发布草稿订单“${order.orderNo}”吗？发布后将进入待备货流程。`)) return;
    onPublishOrder(order);
  };

  // 手机卡片把状态胶囊本身做成「一键推进」按钮：胶囊上直接写着下一步动作，点一下完成本步。
  // 缺对应回调时返回 undefined，让胶囊退回只读徽章，避免出现「点了没反应」的按钮。
  const cardStatusAction = (order: OrderDraft) => {
    const nextAction = getOrderNextAction(order.status);
    if (!nextAction) return undefined;
    const available = nextAction.kind === 'advance'
      ? Boolean(onAdvanceStatus)
      : nextAction.kind === 'shipping' ? Boolean(onOpenShipping) : Boolean(onPublishOrder);
    return available ? nextAction : undefined;
  };

  const runCardStatusAction = (order: OrderDraft, nextAction: OrderNextAction) => {
    if (nextAction.kind === 'advance') onAdvanceStatus?.(order, nextAction.target);
    else if (nextAction.kind === 'shipping') onOpenShipping?.(order);
    else publishOrder(order);
  };

  const renderCardStatus = (order: OrderDraft) => {
    const nextAction = cardStatusAction(order);
    const label = order.status ? statusLabels[order.status] : '-';
    if (!nextAction) return <span className={statusBadgeClass(order.status)}>{label}</span>;
    return <button type="button" className={`status-action-pill tone-${(order.status ?? 'draft').replace(/_/g, '-')}`} aria-label={`${label}，一键${nextAction.label}`} title={`一键${nextAction.label}`} onClick={() => runCardStatusAction(order, nextAction)}><span className="status-action-pill-current">{label}</span><span className="status-action-pill-next">{nextAction.label}</span></button>;
  };

  // 桌面表格行与手机卡片共用的操作按钮。草稿订单不显示箱唛/流程推进，改为发布入口。
  // 手机卡片里状态胶囊已承担「下一步」，用 hideNextAction 去掉重复的小字入口。
  const renderOrderActions = (order: OrderDraft, options?: { hideNextAction?: boolean }) => {
    const nextAction = getOrderNextAction(order.status);
    const showNextAction = !options?.hideNextAction;
    return <div className="row-actions"><button type="button" className="link-button" onClick={() => setDetailOrder(order)}>详情</button><button type="button" className="link-button" onClick={() => openEdit(order)}>编辑</button>{order.status === 'draft'
      ? showNextAction && onPublishOrder && <button type="button" className="link-button muted" title="校验并发布草稿订单，进入正式流程" onClick={() => publishOrder(order)}>发布</button>
      : <><button type="button" className="link-button" onClick={() => openLabels(order)}>箱唛</button>{showNextAction && nextAction?.kind === 'advance' && onAdvanceStatus && <button type="button" className="link-button muted" title={nextAction.label} onClick={() => onAdvanceStatus(order, nextAction.target)}>{nextAction.label}</button>}{showNextAction && nextAction?.kind === 'shipping' && onOpenShipping && <button type="button" className="link-button muted" title={nextAction.label} onClick={() => onOpenShipping(order)}>{nextAction.label}</button>}</>}{onDeleteOrder && <button type="button" className="icon-button danger" title="删除订单" onClick={() => confirmDeleteOrder(order)}><Trash2 size={14} /></button>}</div>;
  };

  const toggleExpanded = (id: string) => setExpandedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  const renderExpandPanel = (order: OrderDraft) => <OrderExpandPanel
    order={order}
    onOpenDetail={() => setDetailOrder(order)}
    onEdit={() => openEdit(order)}
    onOpenFinance={onOpenFinance ? () => onOpenFinance(order) : undefined}
    onOpenLabels={order.status === 'draft' ? undefined : () => openLabels(order)}
    onPublish={order.status === 'draft' && onPublishOrder ? () => publishOrder(order) : undefined}
  />;
  const expandToggle = (order: OrderDraft, className?: string) => {
    const expanded = expandedIds.includes(orderKey(order));
    return <button
      type="button"
      className={className ? `icon-button order-expand-toggle ${className}` : 'icon-button order-expand-toggle'}
      aria-expanded={expanded}
      aria-label={`${expanded ? '收起' : '展开'}订单 ${order.orderNo}`}
      title={expanded ? '收起明细' : '展开明细'}
      onClick={() => toggleExpanded(orderKey(order))}
    >{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>;
  };

  const statusFilterOptions = (Object.keys(statusLabels) as OrderStatus[]).map((value) => ({
    value,
    label: statusLabels[value],
    count: counts[value] ?? 0,
  }));
  const orderCustomerIds = new Set(orders.map((order) => order.customerId).filter((id): id is number => id != null));
  const customerOptions = customers
    .filter((customer) => orderCustomerIds.has(customer.id))
    .map((customer) => ({ value: customer.id, label: customer.name }));
  const companyOptions = [
    ...companies.map((company) => ({ value: company.id, label: company.fullName || company.shortName })),
    { value: -1, label: '未分配公司', count: orders.filter((order) => order.companyId == null).length },
  ];
  const resetAllFilters = () => {
    applyFilterState({ statuses: [], customers: [], companies: [], from: '', to: '' });
    savedFilters.clearActive();
  };

  return <div className="page-shell orders-page">
    <div className="filter-rail-layout">
      <FilterRail
        open={filterRail.open}
        onToggle={filterRail.toggle}
        views={savedFilters.views}
        activeViewId={savedFilters.activeViewId}
        modified={savedFilters.modified}
        onApplyView={savedFilters.applyView}
        onClearActive={savedFilters.clearActive}
        onSaveView={savedFilters.saveView}
        onUpdateView={savedFilters.updateView}
        onRenameView={savedFilters.renameView}
        onDeleteView={savedFilters.deleteView}
        onReset={resetAllFilters}
      >
        <FilterCheckList title="订单状态" options={statusFilterOptions} selected={statusFilters} onChange={setStatusFilters} searchable={false} />
        <FilterCheckList title="客户" options={customerOptions} selected={customerFilters} onChange={setCustomerFilters} />
        <FilterCheckList title="公司" options={companyOptions} selected={companyFilters} onChange={setCompanyFilters} searchable={companyOptions.length > 7} />
        <section className="filter-rail-section">
          <div className="filter-rail-section-head"><strong>下单日期</strong>{(dateFrom || dateTo) && <button type="button" onClick={() => { setDateFrom(''); setDateTo(''); }}>清空</button>}</div>
          <div className="filter-rail-date-range">
            <span>从</span>
            <input type="date" aria-label="下单日期起" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            <span>到</span>
            <input type="date" aria-label="下单日期止" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </div>
        </section>
      </FilterRail>
      <div className="filter-rail-main">
    <div className="page-toolbar orders-page-heading">
      <div className="orders-heading-copy">
        <span className="page-breadcrumb">业务 / 订单</span>
        <strong className="page-title">订单工作台</strong>
        <span className="page-subtitle">跟进备货、打包、发货与箱唛打印进度</span>
      </div>
    </div>
    <section className="table-panel orders-panel">
      <div className="page-toolbar table-toolbar orders-table-toolbar">
        <SearchInput value={query} onChange={setQuery} className={searchHidden ? 'is-scroll-hidden' : undefined} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} placeholder="搜索订单号、客户、收件人、品名、SKU、规格" />
        <StatusCards activeKey={statusFilters.length === 1 ? statusFilters[0] : 'all'} counts={counts} onSelect={(key) => setStatusFilters(key === 'all' ? [] : [key])} />
        <span className="toolbar-count"><ListFilter size={14} />{visibleOrders.length} 条订单</span>
        <button type="button" className="button button-primary orders-create-button" onClick={() => setCreating(true)}><Plus size={15} />新建订单</button>
      </div>
      <div className="table-scroll orders-table-desktop">
        <table className="data-table orders-data-table">
          <thead><tr><th className="order-check-cell"><input type="checkbox" checked={allPrintableSelected} onChange={toggleAll} aria-label="选择当前列表待打印箱唛订单" /></th>{[
            ['订单号', 'order-no-cell'],
            ['客户 / 收件人', 'order-customer-cell'],
            ['下单时间', 'order-date-cell'],
            ['产品详情', 'order-product-cell'],
            ['总箱数', 'order-box-cell'],
            ['金额', 'order-amount-cell is-right'],
            ['状态', 'order-status-cell'],
            ['物流单号', 'order-tracking-cell'],
            ['操作', 'order-ops-cell'],
          ].map(([title, className]) => <th key={title} className={className}>{title}</th>)}</tr></thead>
          <tbody>{visibleOrders.map((order) => {
            const id = orderKey(order); const boxCount = orderBoxCount(order); const productSummary = order.items.map((item) => item.name).filter(Boolean).join('、'); const paymentStatus = orderPaymentStatus(order);
            const expanded = expandedIds.includes(id);
            return <Fragment key={id}>
              <tr className={expanded ? 'is-expanded' : undefined}>
                <td className="order-check-cell"><input type="checkbox" disabled={!isUnshippedOrder(order) || isDraftOrder(order)} checked={isUnshippedOrder(order) && !isDraftOrder(order) && selectedIds.includes(id)} onChange={() => setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])} aria-label={`选择订单${order.orderNo}`} /></td>
                <td className="strong-cell order-no-cell"><div className="order-no-wrap">{expandToggle(order)}<span>{order.orderNo}</span></div></td>
                <td className="order-customer-cell"><div className="order-party"><strong className="order-party-customer" title={order.customerName || undefined}>{order.customerName || '未填客户'}</strong><span className="order-party-recipient" title={order.recipientName || undefined}>收件人：{order.recipientName || '—'}</span></div></td>
                <td>{order.orderedAt.replace('T', ' ')}</td>
                <td className="order-product-cell"><button type="button" className="link-button order-product-link" title={productSummary} onClick={() => setProductsOrder(order)}>{productSummary || '查看明细'}</button></td>
                <td className="order-box-cell">{boxCount}</td>
                <td className="amount order-amount-cell"><div>¥ {order.amount || '0.00'}</div><div className="payment-sub" style={{ color: paymentStatusColor[paymentStatus] }}>{FINANCE_PAYMENT_STATUS_LABELS[paymentStatus]}{paymentStatus === 'partial' && order.financeSummary ? ` · 已收 ¥${(order.financeSummary.receivedCents / 100).toFixed(2)}` : ''}</div></td>
                <td className="order-status-cell"><span className={statusBadgeClass(order.status)}>{order.status ? statusLabels[order.status] : '-'}</span><div className={`status-sub ${order.labelPrintedAt ? 'is-printed' : 'is-pending'}`}>{order.status === 'draft' ? '草稿订单，发布后进入流程' : order.labelPrintedAt ? `已打印箱唛 · ${formatDateTime(order.labelPrintedAt)}` : '箱唛待打印'}</div></td>
                <td className="order-tracking-cell">{order.trackingNo || '—'}</td>
                <td className="order-ops-cell">{renderOrderActions(order)}</td>
              </tr>
              {expanded && <tr className="order-expand-row"><td colSpan={orderTableColSpan}>{renderExpandPanel(order)}</td></tr>}
            </Fragment>;
          })}</tbody>
        </table>
        {!visibleOrders.length && <div className="table-state">暂无符合条件的订单</div>}
      </div>
      <div className="orders-card-list" aria-label="订单卡片列表">{visibleOrders.map((order) => {
        const boxCount = orderBoxCount(order); const productSummary = order.items.map((item) => item.name).filter(Boolean).join('、'); const paymentStatus = orderPaymentStatus(order);
        const expanded = expandedIds.includes(orderKey(order));
        return <article key={orderKey(order)} className={`order-card${expanded ? ' is-expanded' : ''}`}>
          <div className="order-card-head">
            {expandToggle(order, 'order-card-expand')}
            <div className="order-card-title"><strong>{order.orderNo}</strong><span>{order.customerName || '未填客户'} · {order.orderedAt.replace('T', ' ')} · {order.recipientName || '未填收件人'}</span></div>
            {renderCardStatus(order)}
          </div>
          <div className="order-card-mid">
            <button type="button" className="order-card-products" title={productSummary} onClick={() => setProductsOrder(order)}>{productSummary || '查看产品明细'}</button>
            <strong className="order-card-amount">¥ {order.amount || '0.00'}</strong>
          </div>
          <div className="order-card-meta">
            <span>{boxCount} 箱</span>
            <span style={{ color: paymentStatusColor[paymentStatus] }}>{FINANCE_PAYMENT_STATUS_LABELS[paymentStatus]}{paymentStatus === 'partial' && order.financeSummary ? ` · 已收 ¥${(order.financeSummary.receivedCents / 100).toFixed(2)}` : ''}</span>
            <span>{order.status === 'draft' ? '草稿未发布' : order.labelPrintedAt ? '箱唛已打印' : '箱唛待打印'}</span>
            {order.trackingNo && <span>物流 {order.trackingNo}</span>}
          </div>
          {expanded && renderExpandPanel(order)}
          {renderOrderActions(order, { hideNextAction: true })}
        </article>;
      })}{!visibleOrders.length && <div className="table-state">暂无符合条件的订单</div>}</div>
      {selectedOrders.length > 0 && <div className="orders-bulk-bar" role="region" aria-label="批量操作">
        <span className="badge badge-accent">已选 {selectedOrders.length} 条</span>
        <button type="button" className="button button-secondary button-sm" title="将所选待备货订单标记为已备货" onClick={() => onBatchAdvance?.(selectedOrders, 'stock')}><PackageCheck size={14} />一键备货</button>
        <button type="button" className="button button-secondary button-sm" title="将所选已备货/待打包订单完成打包，推进到待发货" onClick={() => onBatchAdvance?.(selectedOrders, 'pack')}><Package size={14} />一键打包</button>
        <button type="button" className="button button-secondary button-sm" title="将所选待发货订单（已填物流单号）标记为已发货" onClick={() => onBatchAdvance?.(selectedOrders, 'ship')}><Truck size={14} />一键发货</button>
        <button type="button" className="button button-secondary button-sm" onClick={bulkPrint}><Printer size={14} />批量打印箱唛</button>
        <button type="button" className="button button-ghost button-sm" onClick={() => setSelectedIds([])}>取消选择</button>
      </div>}
    </section>

    <Modal open={creating || Boolean(editingOrder)} title={editingOrder ? `编辑订单 · ${editingOrder.orderNo}` : '新建订单'} onClose={() => { setCreating(false); setEditingOrder(undefined); }} width={1040}><OrderForm key={editingOrder?.id ?? (creating ? 'new' : 'closed')} value={editingOrder} customers={customers} companies={companies} onSaveCustomerProduct={onSaveCustomerProduct} onCreateCustomer={onCreateCustomer} onGetNextOrderNumber={onGetNextOrderNumber} onSubmit={(order) => { onSaveOrder(order); setCreating(false); setEditingOrder(undefined); }} onSaveDraft={onSaveDraft ? (order) => { onSaveDraft(order); setCreating(false); setEditingOrder(undefined); } : undefined} onCancel={() => { setCreating(false); setEditingOrder(undefined); }} /></Modal>
    <OrderDetailModal open={Boolean(detailOrder)} order={detailOrder} onClose={() => setDetailOrder(undefined)} onEditOrder={openEdit} onEditLabels={(order) => { setDetailOrder(undefined); openLabels(order); }} onPrintLabels={(order) => { setDetailOrder(undefined); setPrintLabels(labelsByOrderId?.[orderKey(order)] ?? fallbackLabels(order)); }} onDeleteContract={onDeleteContract} onDeleteOrder={onDeleteOrder ? confirmDeleteOrder : undefined} onAdvanceStatus={onAdvanceStatus} onPublishOrder={onPublishOrder} onOpenFinance={onOpenFinance} />
    <Modal open={Boolean(productsOrder)} title={productsOrder ? `产品明细 · ${productsOrder.orderNo}` : '产品明细'} onClose={() => setProductsOrder(undefined)} width={920}>{productsOrder && <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'repeat(2, minmax(0, 1fr))' : 'repeat(6, minmax(0, 1fr))', gap: 12, padding: 12, background: 'var(--tone-surface-frost)', border: '1px solid var(--tone-border-soft)', borderRadius: 'var(--radius-ui)' }}>
        <div style={{ display: 'grid', gap: 4, minWidth: 0 }}><span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>订单号</span><strong style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{productsOrder.orderNo}</strong></div>
        <div style={{ display: 'grid', gap: 4, minWidth: 0 }}><span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>收件人</span><strong style={{ fontSize: 13 }}>{productsOrder.recipientName || '未填写'}</strong></div>
        <div style={{ display: 'grid', gap: 4, minWidth: 0 }}><span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>总箱数</span><strong style={{ fontSize: 13 }}>{orderBoxCount(productsOrder)}</strong></div>
        <div style={{ display: 'grid', gap: 4, minWidth: 0 }}><span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>品项数</span><strong style={{ fontSize: 13 }}>{productsOrder.items.length}</strong></div>
        <div style={{ display: 'grid', gap: 4, minWidth: 0 }}><span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>订单金额</span><strong style={{ fontSize: 13, color: 'var(--tone-accent-text)' }}>{`¥ ${productsOrder.amount || '0.00'}`}</strong></div>
        <div style={{ display: 'grid', gap: 4, minWidth: 0, alignItems: 'start' }}><span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>付款状态</span><span className={paymentBadgeClass[orderPaymentStatus(productsOrder)]} style={{ justifySelf: 'start' }}>{FINANCE_PAYMENT_STATUS_LABELS[orderPaymentStatus(productsOrder)]}{orderPaymentStatus(productsOrder) === 'partial' && productsOrder.financeSummary ? ` · 已收 ¥${(productsOrder.financeSummary.receivedCents / 100).toFixed(2)}` : ''}</span></div>
      </div>
      <OrderItemsTable order={productsOrder} />
    </div>}</Modal>
    <LabelEditorModal open={Boolean(labelOrder)} order={labelOrder} labels={labels} onClose={() => setLabelOrder(undefined)} onSave={saveLabels} onMerge={onMergeLabels && labelOrder ? (ids) => { void Promise.resolve(onMergeLabels(labelOrder, ids)).then((next) => { if (next) setLabels(next); }); } : undefined} onRestoreAuto={onRestoreAutoLabels && labelOrder ? () => { void Promise.resolve(onRestoreAutoLabels(labelOrder)).then((next) => { if (next) setLabels(next); }); } : undefined} onPrint={(next) => setPrintLabels(next)} />
    <PrintWorkspace open={printLabels.length > 0} labels={printLabels} onClose={() => setPrintLabels([])} onPrinted={onPrintHistory} />
      </div>
    </div>
  </div>;
}
