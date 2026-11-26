import { Clipboard, Package, PackageCheck, ListFilter, Paperclip, Plus, Printer, Save, Trash2, Truck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { autoPack } from '../../shared/packing';
import LabelEditorModal, { type CartonLabel } from '../components/LabelEditorModal';
import Modal from '../components/Modal';
import SearchInput from '../components/SearchInput';
import OrderDetailModal from '../components/OrderDetailModal';
import OrderItemCards from '../components/OrderItemCards';
import OrderForm, { type CustomerProduct, type OrderDraft, type OrderStatus } from '../components/OrderForm';
import OrderProductQuickList from '../components/orders/OrderProductQuickList';
import ShippingOrderMobileCard from '../components/orders/ShippingOrderMobileCard';
import ShippingOrderTableRow from '../components/orders/ShippingOrderTableRow';
import PromoteCustomerModal from '../components/orders/PromoteCustomerModal';
import PrintWorkspace from '../components/PrintWorkspace';
import StatusCards from '../components/StatusCards';
import { ORDER_CHANNELS, ORDER_CHANNEL_LABELS, ORDER_STATUS_LABELS_WITH_DRAFT, type OrderChannel } from '../../shared/domain';
import { getOrderNextAction, getOrderRollbackAction, isDraftOrder, isUnshippedOrder, type BatchAdvanceAction, type OrderNextAction } from '../order-workflow';
import { FINANCE_PAYMENT_STATUS_LABELS, isOrderPaymentCleared, type FinancePaymentStatus } from '../../shared/finance';
import { getOrderFinance, type ApiFinanceDetail } from '../api';
import PaymentProofEditor, { type PaymentProofEditorHandle } from '../components/finance/PaymentProofEditor';
import { OrderCostEditor, OrderItemCostEditor, OrderProfitSummaryCard } from '../components/orders/OrderProfitEditor';
import { badgeClass, errorText, money } from '../components/finance/finance-format';
import { calculateOrderProfit } from '../../shared/order-profit';
import { boxesForQuantity, buildShippingSheetLine, getOrderFulfillmentProgress, groupShippingOrders, remainingQuantity, type PartialShipmentEntryInput } from '../../shared/shipping';
import { formatDateTime } from '../../shared/formatters';
import { depositCents, normalizePaymentPolicy } from '../../shared/payment-policy';
import type { Company } from '../../shared/companies';
import type { Customer, CustomerSaveInput } from '../../shared/customers';
import { cartonLabelRequirement } from '../../shared/customers';
import { useIsNarrow } from '../use-is-narrow';
import { useHideOnScroll } from '../use-hide-on-scroll';
import { copyText } from '../copy-text';

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
  /** 跨模块跳转时指定订单页签。 */
  initialChannel?: OrderChannel;
  onInitialChannelConsumed?: () => void;
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
  onRollbackStatus?: (order: OrderDraft, status: OrderStatus) => void;
  onBatchAdvance?: (orders: OrderDraft[], action: BatchAdvanceAction) => void;
  onPublishOrder?: (order: OrderDraft) => void;
  /** 发货中：暂存物流单号，不推进状态。 */
  onSaveTracking?: (orderId: string, trackingNo: string) => Promise<boolean>;
  /** 发货中：确认本批/合并发货，返回批次 ID 用于下载清单。 */
  onConfirmShipping?: (entries: PartialShipmentEntryInput[]) => Promise<{ batchId: number } | undefined>;
  onOpenFinance?: (order: OrderDraft) => void;
  onSaveLabels?: (order: OrderDraft, labels: CartonLabel[]) => void | Promise<CartonLabel[] | undefined>;
  onMergeLabels?: (order: OrderDraft, labelIds: string[]) => Promise<CartonLabel[] | undefined> | CartonLabel[] | undefined;
  onRestoreAutoLabels?: (order: OrderDraft) => Promise<CartonLabel[] | undefined> | CartonLabel[] | undefined;
  onPrintHistory?: (labels: CartonLabel[]) => void | Promise<void>;
  /** 临时客户转正后刷新订单与客户数据。 */
  onRefreshOrders?: () => void | Promise<void>;
  onNotify?: (message: string, kind?: 'success' | 'info' | 'error') => void;
}

const statusLabels: Record<OrderStatus, string> = ORDER_STATUS_LABELS_WITH_DRAFT;

function statusBadgeClass(status?: OrderStatus): string {
  if (status === 'draft') return 'badge badge-neutral';
  if (status === 'shipped') return 'badge badge-success';
  if (status === 'shipping') return 'badge badge-info';
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

/** 先款后货的付款门槛：未达门槛时返回拦截原因，用于按钮置灰和提示。 */
function paymentGateReason(order: OrderDraft, target: OrderStatus): string {
  if (normalizePaymentPolicy(order.paymentPolicy) !== 'prepay') return '';
  const receivableCents = order.financeSummary?.receivableCents ?? Math.round(Number(order.amount || 0) * 100);
  const receivedCents = order.financeSummary?.receivedCents ?? 0;
  if (target === 'pending_stock') {
    const percent = Math.max(0, Math.min(100, order.depositPercent ?? 0));
    const requiredCents = percent > 0 ? depositCents(receivableCents, percent) : receivableCents;
    if (receivedCents >= requiredCents) return '';
    return percent > 0
      ? `先款后货：收齐定金 ¥${(requiredCents / 100).toFixed(2)}（已收 ¥${(receivedCents / 100).toFixed(2)}）才能发布`
      : `先款后货：收齐全款 ¥${(requiredCents / 100).toFixed(2)}（已收 ¥${(receivedCents / 100).toFixed(2)}）才能发布`;
  }
  if (target === 'stock_reported' && receivedCents < receivableCents) {
    return `先款后货：已收 ¥${(receivedCents / 100).toFixed(2)} / 应收 ¥${(receivableCents / 100).toFixed(2)}，收齐全款才能确认已备货`;
  }
  return '';
}

function orderBoxCount(order: OrderDraft): number {
  return order.totalBoxes && order.totalBoxes > 0
    ? order.totalBoxes
    : order.items.reduce((sum, item) => sum + item.boxes, 0);
}

/** 手机端悬浮搜索框：下滑收起、回滑展开。收起状态只重渲染这个小组件，不牵动整页订单列表。 */
function OrdersSearchBar({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const narrow = useIsNarrow();
  const [focused, setFocused] = useState(false);
  const hidden = useHideOnScroll(narrow && !focused);
  return <SearchInput
    value={value}
    onChange={onChange}
    className={hidden ? 'is-scroll-hidden' : undefined}
    onFocus={() => setFocused(true)}
    onBlur={() => setFocused(false)}
    placeholder="搜索订单号、客户、收件人、品名、SKU、规格"
  />;
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

const ORDERS_CHANNEL_STORAGE_KEY = 'workbench:orders-channel';

export default function OrdersPage({ orders, customers, companies = [], labelsByOrderId, initialOrderId, initialStatus, onInitialStatusConsumed, initialChannel, onInitialChannelConsumed, startCreate, onStartCreateConsumed, onSaveOrder, onSaveDraft, onDeleteOrder, onSaveCustomerProduct, onCreateCustomer, onGetNextOrderNumber, onDeleteContract, onGenerateContract, onAdvanceStatus, onRollbackStatus, onBatchAdvance, onPublishOrder, onSaveTracking, onConfirmShipping, onOpenFinance, onSaveLabels, onMergeLabels, onRestoreAutoLabels, onPrintHistory, onRefreshOrders, onNotify }: OrdersPageProps) {
  const [activeChannel, setActiveChannel] = useState<OrderChannel>(() => {
    try {
      const saved = localStorage.getItem(ORDERS_CHANNEL_STORAGE_KEY);
      return saved === 'online' || saved === 'offline' ? saved : 'online';
    } catch { return 'online'; }
  });
  const selectChannel = (channel: OrderChannel) => {
    setActiveChannel(channel);
    setSelectedIds([]);
    try { localStorage.setItem(ORDERS_CHANNEL_STORAGE_KEY, channel); } catch { /* localStorage 不可用时仅当前页生效 */ }
  };
  const [statusFilters, setStatusFilters] = useState<OrderStatus[]>([]);
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailOrder, setDetailOrder] = useState<OrderDraft>();
  const [productsOrder, setProductsOrder] = useState<OrderDraft>();
  const [editingOrder, setEditingOrder] = useState<OrderDraft>();
  const [creating, setCreating] = useState(false);
  const [labelOrder, setLabelOrder] = useState<OrderDraft>();
  const [labels, setLabels] = useState<CartonLabel[]>([]);
  const [printLabels, setPrintLabels] = useState<CartonLabel[]>([]);
  const [promoteName, setPromoteName] = useState<string | null>(null);
  const [financeOrder, setFinanceOrder] = useState<OrderDraft>();
  const [financeDetail, setFinanceDetail] = useState<ApiFinanceDetail>();
  const [financeLoading, setFinanceLoading] = useState(false);
  const financeEditorRef = useRef<PaymentProofEditorHandle>(null);
  const [costOrder, setCostOrder] = useState<OrderDraft>();
  const [remarkOrder, setRemarkOrder] = useState<OrderDraft>();
  const [remarkDraft, setRemarkDraft] = useState('');
  const [recipientOrder, setRecipientOrder] = useState<OrderDraft>();
  const [recipientNameDraft, setRecipientNameDraft] = useState('');
  const [recipientInfoDraft, setRecipientInfoDraft] = useState('');
  const [selectedShippingKeys, setSelectedShippingKeys] = useState<string[]>([]);
  const [shippingQuantities, setShippingQuantities] = useState<Record<string, Record<string, number>>>({});
  const [shippingSheetOpen, setShippingSheetOpen] = useState(false);
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

  useEffect(() => {
    if (!detailOrder) return;
    const refreshed = orders.find((order) => orderKey(order) === orderKey(detailOrder));
    if (refreshed && refreshed !== detailOrder) setDetailOrder(refreshed);
  }, [detailOrder, orders]);

  useEffect(() => {
    if (!initialChannel) return;
    setActiveChannel(initialChannel);
    setSelectedIds([]);
    try { localStorage.setItem(ORDERS_CHANNEL_STORAGE_KEY, initialChannel); } catch { /* ignore */ }
    onInitialChannelConsumed?.();
  }, [initialChannel, onInitialChannelConsumed]);

  useEffect(() => {
    if (initialOrderId == null || consumedInitialOrderId.current === initialOrderId) return;
    const order = orders.find((item) => String(item.id) === String(initialOrderId));
    if (order) {
      consumedInitialOrderId.current = initialOrderId;
      selectChannel(order.channel ?? 'offline');
      setDetailOrder(order);
    }
  }, [initialOrderId, orders]);

  const channelOrders = useMemo(() => orders.filter((order) => (order.channel ?? 'offline') === activeChannel), [orders, activeChannel]);
  const channelCounts = useMemo(() => ({
    online: orders.filter((order) => (order.channel ?? 'offline') === 'online').length,
    offline: orders.filter((order) => (order.channel ?? 'offline') === 'offline').length,
  }), [orders]);
  const counts = useMemo(() => {
    const next: Partial<Record<'all' | OrderStatus, number>> = { all: channelOrders.length };
    channelOrders.forEach((order) => { if (order.status) next[order.status] = (next[order.status] ?? 0) + 1; });
    return next;
  }, [channelOrders]);

  const visibleOrders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return channelOrders.filter((order) => {
      const matchesStatus = !statusFilters.length || (order.status != null && statusFilters.includes(order.status));
      const searchable = [order.orderNo, order.customerName, order.recipientName, ...order.items.flatMap((item) => [item.name, item.sku, item.specification])].join(' ').toLowerCase();
      return matchesStatus && (!needle || searchable.includes(needle));
    });
  }, [statusFilters, channelOrders, query]);
  const activeStatusKey = statusFilters.length === 1 ? statusFilters[0] : 'all';
  const showCreateOrder = activeStatusKey === 'all' || activeStatusKey === 'draft';
  const shippingViewActive = activeStatusKey === 'shipping';
  useEffect(() => {
    if (shippingViewActive) setSelectedIds([]);
  }, [shippingViewActive]);
  useEffect(() => {
    setSelectedShippingKeys([]);
    setShippingSheetOpen(false);
  }, [shippingViewActive, activeChannel]);

  const selectedShippingOrders = useMemo(
    () => visibleOrders.filter((order) => selectedShippingKeys.includes(orderKey(order))),
    [visibleOrders, selectedShippingKeys],
  );
  const allShippingSelected = visibleOrders.length > 0 && visibleOrders.every((order) => selectedShippingKeys.includes(orderKey(order)));
  const toggleShippingSelection = (order: OrderDraft) => {
    const key = orderKey(order);
    setSelectedShippingKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };
  const toggleAllShipping = () => {
    setSelectedShippingKeys(allShippingSelected ? [] : visibleOrders.map(orderKey));
  };
  const updateShippingQuantities = (key: string, quantities: Record<string, number>) => {
    setShippingQuantities((current) => current[key] === quantities ? current : { ...current, [key]: quantities });
  };
  const shippingSheetLines = useMemo(() => {
    const groups = groupShippingOrders(selectedShippingOrders);
    return groups.map((group) => {
      const entries = group.orders.map((order) => {
        const quantities = shippingQuantities[orderKey(order)]
          ?? Object.fromEntries(order.items.map((item) => [item.id, remainingQuantity(item)]));
        const boxes = order.items.reduce((sum, item) => {
          const quantity = Math.min(remainingQuantity(item), Math.max(0, Math.trunc(Number(quantities[item.id] ?? 0) || 0)));
          return sum + boxesForQuantity(quantity, item.packSize);
        }, 0);
        return { boxes };
      }).filter((entry) => entry.boxes > 0);
      if (!entries.length) return '';
      return buildShippingSheetLine({ recipientName: group.recipientName, recipientInfo: group.recipientInfo, entries });
    }).filter(Boolean);
  }, [selectedShippingOrders, shippingQuantities]);
  const shippingSheetText = shippingSheetLines.join('\n\n');
  const copyShippingSheet = async () => {
    if (!shippingSheetText) {
      onNotify?.('勾选的订单还没有可复制的发货表内容', 'error');
      return;
    }
    if (await copyText(shippingSheetText)) onNotify?.(`已复制发货表（${shippingSheetLines.length} 个地址）`, 'success');
    else onNotify?.('复制失败，请手动选择文本复制', 'error');
  };
  const showAttachmentColumn = visibleOrders.some((order) => (order.contracts?.length ?? 0) > 0 || (order.stickerAttachments?.length ?? 0) > 0);

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
  const openFinanceModal = async (order: OrderDraft) => {
    if (!order.id) return;
    setFinanceOrder(order);
    setFinanceDetail(undefined);
    setFinanceLoading(true);
    try {
      setFinanceDetail(await getOrderFinance(order.id));
    } catch (error) {
      onNotify?.(errorText(error, '财务与水单加载失败'), 'error');
      setFinanceOrder(undefined);
    } finally {
      setFinanceLoading(false);
    }
  };
  const refreshFinance = async () => {
    if (!financeOrder?.id) return;
    setFinanceDetail(await getOrderFinance(financeOrder.id));
    await onRefreshOrders?.();
  };
  const saveFinanceModal = async () => {
    const shouldClose = await financeEditorRef.current?.savePending() ?? true;
    if (!shouldClose) return;
    setFinanceOrder(undefined);
    setFinanceDetail(undefined);
  };
  const openCostModal = (order: OrderDraft) => setCostOrder({ ...order, items: order.items.map((item) => ({ ...item })) });
  const updateCostItem = (id: string, patch: Partial<OrderDraft['items'][number]>) => {
    setCostOrder((current) => current ? { ...current, items: current.items.map((item) => item.id === id ? { ...item, ...patch } : item) } : current);
  };
  const saveCosts = () => {
    if (!costOrder) return;
    onSaveOrder(costOrder);
    setCostOrder(undefined);
  };
  const openRemarkModal = (order: OrderDraft) => {
    setRemarkOrder(order);
    setRemarkDraft(order.remark ?? '');
  };
  const saveRemark = () => {
    if (!remarkOrder) return;
    onSaveOrder({ ...remarkOrder, remark: remarkDraft });
    setRemarkOrder(undefined);
  };
  const openRecipientModal = (order: OrderDraft) => {
    if (order.status === 'shipped') return;
    setRecipientOrder(order);
    setRecipientNameDraft(order.recipientName ?? '');
    setRecipientInfoDraft(order.recipientInfo ?? '');
  };
  const saveRecipient = () => {
    if (!recipientOrder) return;
    if (!recipientNameDraft.trim()) {
      onNotify?.('收件人名称不能为空', 'error');
      return;
    }
    onSaveOrder({ ...recipientOrder, recipientName: recipientNameDraft.trim(), recipientInfo: recipientInfoDraft.trim() });
    setRecipientOrder(undefined);
  };
  const copyRecipientInfo = async () => {
    const name = recipientNameDraft.trim();
    const info = recipientInfoDraft.trim();
    const text = !info ? name : !name || info.includes(name) ? info : `${name} ${info}`;
    if (!text) {
      onNotify?.('收件信息为空，无法复制', 'error');
      return;
    }
    if (await copyText(text)) onNotify?.('已复制收件信息', 'success');
    else onNotify?.('复制失败，请手动选择文本复制', 'error');
  };
  const deleteOrder = (order: OrderDraft) => { if (!onDeleteOrder) return; onDeleteOrder(order); setDetailOrder(undefined); setEditingOrder(undefined); setLabelOrder(undefined); };
  const confirmDeleteOrder = (order: OrderDraft) => { if (!window.confirm(`确定删除订单“${order.orderNo}”吗？订单及其附件、箱唛数据将一并删除。`)) return; deleteOrder(order); };

  // 草稿发布是不可逆的正式流程入口：桌面行内链接与手机胶囊共用同一确认文案。
  const publishOrder = (order: OrderDraft) => {
    if (!onPublishOrder) return;
    if (!window.confirm(`确定发布草稿订单“${order.orderNo}”吗？发布后将进入待备货流程。`)) return;
    onPublishOrder(order);
  };

  // 进入发货中页签：本次发货直接在该页签的订单卡片里编辑。
  const openShippingView = () => {
    setDetailOrder(undefined);
    setSelectedIds([]);
    setStatusFilters(['shipping']);
  };

  // 手机卡片把状态胶囊本身做成「一键推进」按钮：胶囊上直接写着下一步动作，点一下完成本步。
  // 缺对应回调时返回 undefined，让胶囊退回只读徽章，避免出现「点了没反应」的按钮。
  const cardStatusAction = (order: OrderDraft) => {
    const nextAction = getOrderNextAction(order.status);
    if (!nextAction) return undefined;
    const available = nextAction.kind === 'advance'
      ? Boolean(onAdvanceStatus)
      : nextAction.kind === 'shipping-view' ? true : Boolean(onPublishOrder);
    return available ? nextAction : undefined;
  };

  const runCardStatusAction = (order: OrderDraft, nextAction: OrderNextAction) => {
    if (nextAction.kind === 'advance') onAdvanceStatus?.(order, nextAction.target);
    else if (nextAction.kind === 'shipping-view') openShippingView();
    else publishOrder(order);
  };

  const renderCardStatus = (order: OrderDraft) => {
    const nextAction = cardStatusAction(order);
    const progress = getOrderFulfillmentProgress(order.items);
    const label = order.status ? statusLabels[order.status] : '-';
    const progressText = order.status === 'shipping' ? `已发 ${progress.shippedQuantity}/${progress.totalQuantity} 件 · 剩余 ${progress.remainingQuantity} 件` : undefined;
    if (!nextAction) return <span className={statusBadgeClass(order.status)} title={progressText}>{label}</span>;
    const nextLabel = nextAction.label;
    const gate = nextAction.kind === 'advance' ? paymentGateReason(order, nextAction.target) : nextAction.kind === 'shipping-view' ? '' : paymentGateReason(order, 'pending_stock');
    return <button type="button" className={`status-action-pill tone-${(order.status ?? 'draft').replace(/_/g, '-')}`} aria-label={`${label}，一键${nextLabel}`} title={gate || `一键${nextLabel}${progressText ? ` · ${progressText}` : ''}`} disabled={Boolean(gate)} onClick={() => runCardStatusAction(order, nextAction)}><span className="status-action-pill-next">{nextLabel}</span></button>;
  };

  // 桌面表格行与手机卡片共用的操作按钮。草稿订单不显示箱唛/流程推进，改为发布入口。
  // 手机卡片里状态胶囊已承担「下一步」，用 hideNextAction 去掉重复的小字入口。
  const renderOrderActions = (order: OrderDraft, options?: { hideNextAction?: boolean; twoLine?: boolean }) => {
    const nextAction = getOrderNextAction(order.status);
    const rollbackAction = getOrderRollbackAction(order.status);
    const showNextAction = !options?.hideNextAction;
    const detailButton = <button type="button" className="link-button" onClick={() => setDetailOrder(order)}>详情</button>;
    const editButton = <button type="button" className="link-button" onClick={() => openEdit(order)}>编辑</button>;
    const publishGate = paymentGateReason(order, 'pending_stock');
    const publishButton = order.status === 'draft' && showNextAction && onPublishOrder
      ? <button type="button" className="link-button muted" disabled={Boolean(publishGate)} title={publishGate || '校验并发布草稿订单，进入正式流程'} onClick={() => publishOrder(order)}>发布</button>
      : null;
    const advanceGate = nextAction?.kind === 'advance' ? paymentGateReason(order, nextAction.target) : '';
    const advanceButton = order.status !== 'draft' && showNextAction
      ? nextAction?.kind === 'advance' && onAdvanceStatus
        ? <button type="button" className="link-button muted" disabled={Boolean(advanceGate)} title={advanceGate || nextAction.label} onClick={() => onAdvanceStatus(order, nextAction.target)}>{nextAction.label}</button>
        : nextAction?.kind === 'shipping-view'
          ? <button type="button" className="link-button muted" title="切到发货中页签直接填写本次发货" onClick={() => openShippingView()}>{nextAction.label}</button>
          : null
      : null;
    const hasShipments = order.items.some((item) => (item.shippedQuantity ?? 0) > 0);
    const rollbackButton = order.status !== 'draft' && rollbackAction && onRollbackStatus && !hasShipments
      ? <button type="button" className="link-button muted" title={`${rollbackAction.label}（保留物流、附件与收款数据）`} onClick={() => onRollbackStatus(order, rollbackAction.target)}>{order.status === 'shipped' ? rollbackAction.label : '回退'}</button>
      : null;
    const deleteButton = onDeleteOrder && !hasShipments
      ? <button type="button" className="icon-button danger" title="删除订单" onClick={() => confirmDeleteOrder(order)}><Trash2 size={14} /></button>
      : null;
    if (options?.twoLine) {
      return <div className="row-actions is-two-line">
        <div className="row-actions-row is-top">
          <div className="row-actions-cell is-top">{detailButton}</div>
          <div className="row-actions-cell is-top">{editButton}</div>
        </div>
        <div className="row-actions-row is-bottom">
          <div className="row-actions-cell is-bottom">{publishButton ?? advanceButton}</div>
          <div className="row-actions-cell is-bottom">{rollbackButton}</div>
          <div className="row-actions-cell is-bottom">{deleteButton}</div>
        </div>
      </div>;
    }
    return <div className="row-actions">{detailButton}{editButton}{order.status === 'draft' ? publishButton : <>{advanceButton}{rollbackButton}</>}{deleteButton}</div>;
  };

  return <div className={`page-shell orders-page${(shippingViewActive ? selectedShippingOrders.length : selectedOrders.length) > 0 ? ' has-bulk-bar' : ''}`}>
    <div className="orders-channel-tabs" role="tablist" aria-label="订单渠道">
      {ORDER_CHANNELS.map((channel) => <button key={channel} type="button" role="tab" aria-selected={activeChannel === channel} className={activeChannel === channel ? 'is-active' : undefined} onClick={() => selectChannel(channel)}>{ORDER_CHANNEL_LABELS[channel]}订单<b>{channelCounts[channel]}</b></button>)}
    </div>
    <section className="table-panel orders-panel">
      <div className="page-toolbar table-toolbar orders-table-toolbar">
        <OrdersSearchBar value={query} onChange={setQuery} />
        <StatusCards activeKey={activeStatusKey} counts={counts} onSelect={(key) => setStatusFilters(key === 'all' ? [] : [key])} />
        <span className="toolbar-count"><ListFilter size={14} />{visibleOrders.length} 条订单</span>
        {showCreateOrder && <button type="button" className="button button-primary orders-create-button" onClick={() => setCreating(true)}><Plus size={15} />新建订单</button>}
      </div>
      {shippingViewActive ? <>
      <div className="table-scroll orders-table-desktop orders-shipping-table-wrap">
        <table className="data-table orders-data-table orders-shipping-table">
          <thead><tr>
            <th className="order-check-cell"><input type="checkbox" checked={allShippingSelected} onChange={toggleAllShipping} aria-label="选择当前列表发货中订单" /></th>
            <th className="order-no-cell">订单号</th>
            <th className="order-customer-cell">客户 / 收件人</th>
            <th className="order-product-cell">产品详情</th>
            <th className="order-box-cell">总箱数</th>
            <th className="order-status-cell">状态</th>
            <th className="order-tracking-cell">物流单号</th>
            <th className="order-ops-cell">操作</th>
          </tr></thead>
          <tbody>{visibleOrders.map((order) => <ShippingOrderTableRow
            key={orderKey(order)}
            order={order}
            selected={selectedShippingKeys.includes(orderKey(order))}
            onToggleSelect={() => toggleShippingSelection(order)}
            onQuantitiesChange={updateShippingQuantities}
            onOpenDetail={setDetailOrder}
            onEditLabels={openLabels}
            onEditRecipient={openRecipientModal}
            onRollbackStatus={onRollbackStatus}
            onConfirmShipping={onConfirmShipping}
            onSaveTracking={onSaveTracking}
            onRefresh={onRefreshOrders}
            onNotify={onNotify}
          />)}</tbody>
        </table>
        {!visibleOrders.length && <div className="table-state">暂无符合条件的发货中订单</div>}
      </div>
      <div className="orders-card-list orders-shipping-mobile-list" aria-label="发货中订单">
        {visibleOrders.map((order) => <ShippingOrderMobileCard
          key={orderKey(order)}
          order={order}
          selected={selectedShippingKeys.includes(orderKey(order))}
          onToggleSelect={() => toggleShippingSelection(order)}
          onQuantitiesChange={updateShippingQuantities}
          onOpenDetail={setDetailOrder}
          onEditLabels={openLabels}
          onEditRecipient={openRecipientModal}
          onRollbackStatus={onRollbackStatus}
          onConfirmShipping={onConfirmShipping}
          onSaveTracking={onSaveTracking}
          onRefresh={onRefreshOrders}
          onNotify={onNotify}
        />)}
        {!visibleOrders.length && <div className="table-state">暂无符合条件的发货中订单</div>}
      </div>
      {selectedShippingOrders.length > 0 && <div className="orders-bulk-bar orders-shipping-bulk-bar" role="region" aria-label="发货表批量操作">
        <span className="badge badge-accent">已选 {selectedShippingOrders.length} 单</span>
        <button type="button" className="button button-primary button-sm" onClick={() => setShippingSheetOpen(true)}>查看发货表</button>
        <button type="button" className="button button-ghost button-sm" onClick={() => setSelectedShippingKeys([])}>取消选择</button>
      </div>}
      </> : <>
      <div className="table-scroll orders-table-desktop">
        <table className="data-table orders-data-table orders-normal-table">
          <thead><tr><th className="order-check-cell"><input type="checkbox" checked={allPrintableSelected} onChange={toggleAll} aria-label="选择当前列表待打印箱唛订单" /></th>{[
            ['订单号', 'order-no-cell'],
            ['客户 / 收件人', 'order-customer-cell'],
            ['产品详情', 'order-product-cell'],
            ['总箱数', 'order-box-cell'],
            ...(showAttachmentColumn ? [['附件', 'order-attachment-cell']] : []),
            ['备注', 'order-remark-cell'],
            ['金额', 'order-amount-cell is-right'],
            ['状态', 'order-status-cell'],
            ['操作', 'order-ops-cell'],
          ].map(([title, className]) => <th key={title} className={className}>{title}</th>)}</tr></thead>
          <tbody>{visibleOrders.map((order) => {
            const id = orderKey(order); const boxCount = orderBoxCount(order);
            const receivableCents = order.financeSummary?.receivableCents ?? Math.round(Number(order.amount || 0) * 100);
            const receivedCents = order.financeSummary?.receivedCents ?? 0;
            const paymentCleared = isOrderPaymentCleared(receivableCents, receivedCents);
            const attachmentCount = order.contracts?.length ?? 0;
            const profit = calculateOrderProfit({
              amountCents: Math.round(Number(order.amount || 0) * 100),
              items: order.items,
              logisticsCostCents: order.logisticsCostCents,
              labelCostCents: order.labelCostCents,
              otherCostCents: order.otherCostCents,
              costConfirmed: order.costConfirmed,
            });
            return <tr key={id}>
                <td className="order-check-cell"><input type="checkbox" disabled={!isUnshippedOrder(order) || isDraftOrder(order)} checked={isUnshippedOrder(order) && !isDraftOrder(order) && selectedIds.includes(id)} onChange={() => setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])} aria-label={`选择订单${order.orderNo}`} /></td>
                <td className="strong-cell order-no-cell"><div className="order-no-stack"><span title={order.orderNo}>{order.orderNo}</span><span className="order-no-date">{order.orderedAt.replace('T', ' ')}</span></div></td>
                <td className="order-customer-cell"><div className="order-party"><strong className="order-party-customer" title={order.customerName || undefined}>{order.customerName || '未填客户'}{order.customerId == null && order.customerName?.trim() && <span className="badge badge-neutral" style={{ marginLeft: 5 }}>临时</span>}</strong>{order.status === 'shipped' ? <span className="order-party-recipient" title={order.recipientName || undefined}>收件人：{order.recipientName || '—'}</span> : <button type="button" className="order-party-recipient order-recipient-link" title="编辑收件人信息" onClick={() => openRecipientModal(order)}>收件人：{order.recipientName || '未填'}</button>}</div></td>
                <td className="order-product-cell"><OrderProductQuickList order={order} onOpen={() => setProductsOrder(order)} /></td>
                <td className="order-box-cell"><button type="button" className="order-box-link" title="编辑/打印箱唛" aria-label={`编辑或打印订单${order.orderNo}箱唛`} onClick={() => openLabels(order)}>{boxCount}</button></td>
                {showAttachmentColumn && <td className="order-attachment-cell">{(attachmentCount > 0 || (order.stickerAttachments?.length ?? 0) > 0) && <div className="order-extra-files">{(order.stickerAttachments ?? []).map((sticker) => <a key={`sticker-${sticker.customerProductId}`} href={`/files/${sticker.file}`} target="_blank" rel="noreferrer" className={sticker.remaining < sticker.required ? 'is-short' : undefined} title={`标贴：${sticker.name}（剩 ${sticker.remaining}，本单需 ${sticker.required}）`}><span>标贴 · {sticker.name}</span><Printer size={10} /></a>)}{(order.contracts ?? []).map((contract) => <a key={contract.id} href={contract.url} target="_blank" rel="noreferrer" title={contract.name}><span>{contract.name}</span><Printer size={10} /></a>)}</div>}</td>}
                <td className="order-remark-cell"><button type="button" className={`order-remark-full order-remark-edit${order.remark?.trim() ? '' : ' is-empty'}`} title={order.remark?.trim() ? order.remark : '点击添加备注'} aria-label={`编辑订单${order.orderNo}备注`} onClick={() => openRemarkModal(order)}>{order.remark?.trim() || '点击添加'}</button></td>
                <td className="amount order-amount-cell"><button type="button" className="order-amount-link" title="查看/编辑财务与水单" aria-label={`查看订单${order.orderNo}财务与水单`} onClick={() => void openFinanceModal(order)}>¥ {order.amount || '0.00'}</button><div className="payment-sub" style={{ color: paymentCleared ? 'var(--color-success)' : 'var(--color-danger)' }}>已收 {money(receivedCents)}</div><button type="button" className={`order-profit-sub ${profit.costComplete ? (profit.profitCents ?? 0) < 0 ? 'is-loss' : 'is-profit' : 'is-pending'}`} title={profit.costComplete ? `毛利 ${(profit.profitCents ?? 0) / 100} · 毛利率 ${profit.marginPercent ?? '—'}%（点击调整成本）` : `成本待补：${profit.missingItemCount} 行产品未确认（点击补录成本）`} aria-label={`补录或调整订单${order.orderNo}成本`} onClick={() => openCostModal(order)}>{profit.costComplete ? `毛利 ¥${((profit.profitCents ?? 0) / 100).toFixed(2)}` : '成本待补'}</button></td>
                <td className="order-status-cell"><span className={statusBadgeClass(order.status)}>{order.status ? statusLabels[order.status] : '-'}</span>{order.status !== 'shipped' && <div className={`status-sub ${order.labelPrintedAt ? 'is-printed' : 'is-pending'}`} title={order.labelPrintedAt ? `箱唛打印时间：${formatDateTime(order.labelPrintedAt)}` : undefined}>{order.status === 'draft' ? '草稿订单，发布后进入流程' : order.labelPrintedAt ? '已打印箱唛' : '箱唛待打印'}</div>}</td>
                <td className="order-ops-cell">{renderOrderActions(order, { twoLine: true })}</td>
              </tr>;
          })}</tbody>
        </table>
        {!visibleOrders.length && <div className="table-state">暂无符合条件的订单</div>}
      </div>
      <div className="orders-card-list" aria-label="订单卡片列表">{visibleOrders.map((order) => {
        const boxCount = orderBoxCount(order);
        const receivableCents = order.financeSummary?.receivableCents ?? Math.round(Number(order.amount || 0) * 100);
        const receivedCents = order.financeSummary?.receivedCents ?? 0;
        const paymentCleared = isOrderPaymentCleared(receivableCents, receivedCents);
        const attachmentCount = order.contracts?.length ?? 0;
        const profit = calculateOrderProfit({
          amountCents: Math.round(Number(order.amount || 0) * 100),
          items: order.items,
          logisticsCostCents: order.logisticsCostCents,
          labelCostCents: order.labelCostCents,
          otherCostCents: order.otherCostCents,
          costConfirmed: order.costConfirmed,
        });
        return <article key={orderKey(order)} className="order-card">
          <div className="order-card-head">
            <div className="order-card-title"><strong>{order.orderNo}</strong><span>{order.customerId == null && order.customerName?.trim() ? '临时 · ' : ''}{order.customerName || '未填客户'} · {order.orderedAt.replace('T', ' ')} · {order.status === 'shipped' ? order.recipientName || '未填收件人' : <button type="button" className="order-recipient-link" title="编辑收件人信息" onClick={() => openRecipientModal(order)}>{order.recipientName || '未填收件人'}</button>}</span></div>
            <button type="button" className="order-box-link" title="编辑/打印箱唛" aria-label={`编辑或打印订单${order.orderNo}箱唛`} onClick={() => openLabels(order)}>{boxCount} 箱</button>
            {renderCardStatus(order)}
          </div>
          <div className="order-card-mid">
            <OrderProductQuickList order={order} className="order-card-products" onOpen={() => setProductsOrder(order)} />
            <div className="order-card-money">
              <button type="button" className="order-card-amount" title="查看/编辑财务与水单" aria-label={`查看订单${order.orderNo}财务与水单`} onClick={() => void openFinanceModal(order)}>¥ {order.amount || '0.00'}</button>
              <span className="order-card-payment" style={{ color: paymentCleared ? 'var(--color-success)' : 'var(--color-danger)' }}>已收 {money(receivedCents)}</span>
              <button type="button" className={`order-card-profit-link ${profit.costComplete ? (profit.profitCents ?? 0) < 0 ? 'finance-warning' : 'finance-positive' : 'finance-warning'}`} title={profit.costComplete ? '点击调整成本' : '点击补录成本'} aria-label={`补录或调整订单${order.orderNo}成本`} onClick={() => openCostModal(order)}>{profit.costComplete ? `毛利 ¥${((profit.profitCents ?? 0) / 100).toFixed(2)}` : '成本待补'}</button>
            </div>
          </div>
          {order.status !== 'shipped' && <div className="order-card-meta">
            <span>{order.status === 'draft' ? '草稿未发布' : order.labelPrintedAt ? '箱唛已打印' : '箱唛待打印'}</span>
          </div>}
          <div className="order-card-extra">
            {(attachmentCount > 0 || (order.stickerAttachments?.length ?? 0) > 0) && <div className="order-extra-section">
              <span className="order-extra-label"><Paperclip size={11} />附件</span>
              <div className="order-extra-files">{(order.stickerAttachments ?? []).map((sticker) => <a key={`sticker-${sticker.customerProductId}`} href={`/files/${sticker.file}`} target="_blank" rel="noreferrer" className={sticker.remaining < sticker.required ? 'is-short' : undefined} title={`标贴：${sticker.name}（剩 ${sticker.remaining}，本单需 ${sticker.required}）`}><span>标贴 · {sticker.name}</span><Printer size={10} /></a>)}{(order.contracts ?? []).map((contract) => <a key={contract.id} href={contract.url} target="_blank" rel="noreferrer" title={contract.name}><span>{contract.name}</span><Printer size={10} /></a>)}</div>
            </div>}
            <div className="order-extra-section">
              <span className="order-extra-label">备注</span>
              <button type="button" className={`order-remark-full order-remark-edit${order.remark?.trim() ? '' : ' is-empty'}`} title={order.remark?.trim() ? order.remark : '点击添加备注'} aria-label={`编辑订单${order.orderNo}备注`} onClick={() => openRemarkModal(order)}>{order.remark?.trim() || '点击添加'}</button>
            </div>
          </div>
          {renderOrderActions(order, { hideNextAction: true })}
        </article>;
      })}{!visibleOrders.length && <div className="table-state">暂无符合条件的订单</div>}</div>
      {selectedOrders.length > 0 && <div className="orders-bulk-bar" role="region" aria-label="批量操作">
        <span className="badge badge-accent">已选 {selectedOrders.length} 条</span>
        <button type="button" className="button button-secondary button-sm" title="将所选待备货订单标记为已备货" onClick={() => onBatchAdvance?.(selectedOrders, 'stock')}><PackageCheck size={14} />一键备货</button>
        <button type="button" className="button button-secondary button-sm" title="将所选已备货/待打包订单完成打包，推进到待发货" onClick={() => onBatchAdvance?.(selectedOrders, 'pack')}><Package size={14} />一键打包</button>
        <button type="button" className="button button-secondary button-sm" title="将所选待发货订单推进到发货中，之后在发货中回填单号并确认" onClick={() => onBatchAdvance?.(selectedOrders, 'ship')}><Truck size={14} />进入发货中</button>
        <button type="button" className="button button-secondary button-sm" onClick={bulkPrint}><Printer size={14} />批量打印箱唛</button>
        <button type="button" className="button button-ghost button-sm" onClick={() => setSelectedIds([])}>取消选择</button>
      </div>}
      </>}
    </section>

    <Modal open={creating || Boolean(editingOrder)} title={editingOrder ? `编辑订单 · ${editingOrder.orderNo}` : '新建订单'} onClose={() => { setCreating(false); setEditingOrder(undefined); }} width={1040}><OrderForm key={editingOrder?.id ?? (creating ? `new-${activeChannel}` : 'closed')} value={editingOrder} defaultChannel={activeChannel} customers={customers} companies={companies} onSaveCustomerProduct={onSaveCustomerProduct} onCreateCustomer={onCreateCustomer} onGetNextOrderNumber={onGetNextOrderNumber} onSubmit={(order) => { onSaveOrder(order); setCreating(false); setEditingOrder(undefined); }} onSaveDraft={onSaveDraft ? (order) => { onSaveDraft(order); setCreating(false); setEditingOrder(undefined); } : undefined} onCancel={() => { setCreating(false); setEditingOrder(undefined); }} /></Modal>
    <Modal open={Boolean(remarkOrder)} title={remarkOrder ? `订单备注 · ${remarkOrder.orderNo}` : '订单备注'} onClose={() => setRemarkOrder(undefined)} width={520}>
      <div style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>备注内容</span>
          <textarea aria-label="备注内容" rows={5} autoFocus value={remarkDraft} onChange={(event) => setRemarkDraft(event.target.value)} placeholder="填写付款阶段、特殊要求等" style={{ width: '100%', minHeight: 110, padding: 8, border: '1px solid var(--color-border-control)', borderRadius: 'var(--radius-ui)', font: 'inherit', resize: 'vertical' }} />
        </label>
        <div className="order-form-actions">
          <button type="button" className="button button-secondary" onClick={() => setRemarkOrder(undefined)}>取消</button>
          <button type="button" className="button button-primary" onClick={saveRemark}>保存备注</button>
        </div>
      </div>
    </Modal>
    <Modal open={shippingSheetOpen} title="发货表" onClose={() => setShippingSheetOpen(false)} width={560} variant="drawer" className="orders-shipping-sheet-modal">
      <div className="orders-shipping-sheet-drawer">
        <div className="orders-shipping-sheet-head">
          <span>{shippingSheetLines.length} 个地址 · {selectedShippingOrders.length} 单</span>
          <button type="button" className="button button-primary" disabled={!shippingSheetText} onClick={() => { void copyShippingSheet(); }}>复制发货表</button>
        </div>
        <textarea className="textarea" readOnly rows={Math.max(6, Math.min(18, shippingSheetLines.length * 2))} value={shippingSheetText} aria-label="发货表" placeholder="勾选订单并填写本次数量后生成发货表" />
      </div>
    </Modal>
    <Modal open={Boolean(recipientOrder)} title={recipientOrder ? `收件人信息 · ${recipientOrder.orderNo}` : '收件人信息'} onClose={() => setRecipientOrder(undefined)} width={520} compact>
      <div style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>收件人姓名</span>
          <input aria-label="收件人姓名" autoFocus value={recipientNameDraft} onChange={(event) => setRecipientNameDraft(event.target.value)} placeholder="填写收件人姓名" style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--color-border-control)', borderRadius: 'var(--radius-ui)', font: 'inherit' }} />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>收件信息</span>
          <textarea aria-label="收件信息" rows={4} value={recipientInfoDraft} onChange={(event) => setRecipientInfoDraft(event.target.value)} placeholder="电话、地址等完整收件信息" style={{ width: '100%', minHeight: 96, padding: 8, border: '1px solid var(--color-border-control)', borderRadius: 'var(--radius-ui)', font: 'inherit', resize: 'vertical' }} />
        </label>
        <div className="order-form-actions">
          <button type="button" className="button button-secondary" onClick={() => { void copyRecipientInfo(); }}><Clipboard size={14} />复制收件信息</button>
          <button type="button" className="button button-ghost" onClick={() => setRecipientOrder(undefined)}>取消</button>
          <button type="button" className="button button-primary" onClick={saveRecipient}>保存</button>
        </div>
      </div>
    </Modal>
    <Modal open={Boolean(costOrder)} title={costOrder ? `成本与利润 · ${costOrder.orderNo}` : '成本与利润'} onClose={() => setCostOrder(undefined)} width={860}>
      {costOrder && <div className="order-profit-editor-modal">
        <p className="order-cost-hint">成本会随订单一起保存；勾选“已核对”的行和整单费用才计入毛利。</p>
        <OrderProfitSummaryCard order={costOrder} />
        <OrderCostEditor order={costOrder} onChange={(patch) => setCostOrder((current) => current ? { ...current, ...patch } : current)} />
        <section className="order-item-cost-list">
          <div className="order-item-cost-list-head">
            <div><strong>产品单件成本</strong><span>逐行核对机头、电池、充电器、包装、配件和标贴</span></div>
            <span>{costOrder.items.length} 行</span>
          </div>
          {costOrder.items.map((item) => <div className="order-item-cost-row" key={item.id}>
            <div className="order-item-cost-row-head">
              <strong>{item.name || '未填产品'}</strong>
              <span>{item.specification || '未填规格'} · {item.quantity} 件</span>
            </div>
            <OrderItemCostEditor item={item} onChange={(patch) => updateCostItem(item.id, patch)} />
          </div>)}
          {!costOrder.items.length && <div className="table-state">先添加产品，再填写成本。</div>}
        </section>
        <div className="order-form-actions">
          <button type="button" className="button button-secondary" onClick={() => setCostOrder(undefined)}>取消</button>
          <button type="button" className="button button-primary" onClick={saveCosts}>保存成本</button>
        </div>
      </div>}
    </Modal>
    <Modal open={Boolean(financeOrder)} title={financeOrder ? `财务与水单 · ${financeOrder.orderNo}` : '财务与水单'} onClose={() => { setFinanceOrder(undefined); setFinanceDetail(undefined); }} width={860} footer={financeDetail ? <button type="button" className="button button-primary" onClick={() => { void saveFinanceModal(); }}><Save size={14} />保存</button> : undefined}>
      {financeLoading && <div className="table-state">正在加载财务数据...</div>}
      {financeDetail && <div className="finance-detail">
        <div className="finance-detail-summary">
          <div><span>应收金额</span><strong>{money(financeDetail.finance.receivableCents)}</strong></div>
          <div><span>已收金额</span><strong className="finance-positive">{money(financeDetail.finance.receivedCents)}</strong></div>
          <div><span>未收金额</span><strong className={financeDetail.finance.outstandingCents > 0 ? 'finance-warning' : 'finance-positive'}>{money(financeDetail.finance.outstandingCents)}</strong></div>
          <div><span>付款状态</span><b className={badgeClass(financeDetail.finance.paymentStatus)}>{FINANCE_PAYMENT_STATUS_LABELS[financeDetail.finance.paymentStatus]}</b></div>
        </div>
        {!isOrderPaymentCleared(financeDetail.finance.receivableCents, financeDetail.finance.receivedCents) && <div className="notice notice-warning">该订单尚未收齐全额货款；上传水单并审核通过后才能确认发货。</div>}
        <PaymentProofEditor ref={financeEditorRef} mode="order-modal" detail={financeDetail} onRefresh={refreshFinance} onNotify={onNotify} />
        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 11 }}>发票编辑请从订单详情的“打开财务详情”进入财务页。</p>
      </div>}
    </Modal>
    <OrderDetailModal open={Boolean(detailOrder)} order={detailOrder} onClose={() => setDetailOrder(undefined)} onEditOrder={openEdit} onEditLabels={(order) => { setDetailOrder(undefined); openLabels(order); }} onPrintLabels={(order) => { setDetailOrder(undefined); setPrintLabels(labelsByOrderId?.[orderKey(order)] ?? fallbackLabels(order)); }} onDeleteContract={onDeleteContract} onDeleteOrder={onDeleteOrder ? confirmDeleteOrder : undefined} onAdvanceStatus={onAdvanceStatus} onRollbackStatus={onRollbackStatus} onPublishOrder={onPublishOrder} onOpenFinance={onOpenFinance} onPromoteCustomer={(order) => setPromoteName(order.customerName?.trim() ?? '')} onShipmentChanged={async () => { await onRefreshOrders?.(); }} onNotify={onNotify} />
    <Modal open={Boolean(productsOrder)} title={productsOrder ? `产品明细 · ${productsOrder.orderNo}` : '产品明细'} onClose={() => setProductsOrder(undefined)} width={920}>{productsOrder && <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'repeat(2, minmax(0, 1fr))' : 'repeat(6, minmax(0, 1fr))', gap: 12, padding: 12, background: 'var(--tone-surface-frost)', border: '1px solid var(--tone-border-soft)', borderRadius: 'var(--radius-ui)' }}>
        <div style={{ display: 'grid', gap: 4, minWidth: 0 }}><span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>订单号</span><strong style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{productsOrder.orderNo}</strong></div>
        <div style={{ display: 'grid', gap: 4, minWidth: 0 }}><span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>收件人</span><strong style={{ fontSize: 13 }}>{productsOrder.recipientName || '未填写'}</strong></div>
        <div style={{ display: 'grid', gap: 4, minWidth: 0 }}><span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>总箱数</span><strong style={{ fontSize: 13 }}>{orderBoxCount(productsOrder)}</strong></div>
        <div style={{ display: 'grid', gap: 4, minWidth: 0 }}><span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>品项数</span><strong style={{ fontSize: 13 }}>{productsOrder.items.length}</strong></div>
        <div style={{ display: 'grid', gap: 4, minWidth: 0 }}><span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>订单金额</span><strong style={{ fontSize: 13, color: 'var(--tone-accent-text)' }}>{`¥ ${productsOrder.amount || '0.00'}`}</strong></div>
        <div style={{ display: 'grid', gap: 4, minWidth: 0, alignItems: 'start' }}><span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>付款状态</span><span className={paymentBadgeClass[orderPaymentStatus(productsOrder)]} style={{ justifySelf: 'start' }}>{FINANCE_PAYMENT_STATUS_LABELS[orderPaymentStatus(productsOrder)]}{orderPaymentStatus(productsOrder) === 'partial' && productsOrder.financeSummary ? ` · 已收 ¥${(productsOrder.financeSummary.receivedCents / 100).toFixed(2)}` : ''}</span></div>
      </div>
      <OrderItemCards order={productsOrder} showPackaging={false} />
    </div>}</Modal>
    <LabelEditorModal open={Boolean(labelOrder)} order={labelOrder} labels={labels} onClose={() => setLabelOrder(undefined)} onSave={saveLabels} onMerge={onMergeLabels && labelOrder ? (ids) => { void Promise.resolve(onMergeLabels(labelOrder, ids)).then((next) => { if (next) setLabels(next); }); } : undefined} onRestoreAuto={onRestoreAutoLabels && labelOrder ? () => { void Promise.resolve(onRestoreAutoLabels(labelOrder)).then((next) => { if (next) setLabels(next); }); } : undefined} onPrint={(next) => setPrintLabels(next)} />
    <PrintWorkspace open={printLabels.length > 0} labels={printLabels} onClose={() => setPrintLabels([])} onPrinted={onPrintHistory} />
    <PromoteCustomerModal name={promoteName ?? ''} open={Boolean(promoteName)} onClose={() => setPromoteName(null)} onPromoted={async ({ customer, linkedCount }) => { setPromoteName(null); setDetailOrder(undefined); await onRefreshOrders?.(); onNotify?.(`已转正为客户「${customer.name}」，挂接 ${linkedCount} 个订单`, 'success'); }} />
  </div>;
}
