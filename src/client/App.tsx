import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CompanySnapshot } from '../shared/documents';
import AuthGate from './components/auth/AuthGate';
import EnvironmentShell from './components/EnvironmentShell';
import { productUploadQueue, type UploadBatch } from './product-upload-queue';
import { startUploadKeepAlive, stopUploadKeepAlive, updateUploadKeepAlive, registerFileSaveFailureHandler } from './app-bridge';
import { saveFileOrDownload } from './file-save';
import Sidebar from './components/Sidebar';
import { navigationKeys, type NavigationKey } from './navigation';
import { loadMobileTabs, saveMobileTabs } from './mobile-tabs';
import { initNavigationHistory, pushPageKey, registerCloseLayer, setCurrentPageKey, unregisterCloseLayer } from './navigation-history';
import MobileTabBar from './components/MobileTabBar';
import Toast, { type ToastMessage } from './components/Toast';
import type { CartonLabel } from './components/LabelEditorModal';
import type { OrderContractDraft, OrderDraft, OrderItemDraft, OrderStatus } from './components/OrderForm';
import type { ProductRecord } from './components/ProductEditor';
import type { Customer } from '../shared/customers';
import { normalizePaymentPolicy } from '../shared/payment-policy';
import type { Company } from '../shared/companies';
import OrdersPage, { fallbackLabels, type OrdersListQuery } from './pages/OrdersPage';
import { getBatchAdvancePlan, getOrderRollbackAction, type BatchAdvanceAction } from './order-workflow';
import ProductsPage from './pages/ProductsPage';
import CatalogPage from './pages/CatalogPage';
import CustomerProductsPage from './pages/CustomerProductsPage';
import DashboardPage from './pages/DashboardPage';
import SettingsPage, { type SettingsSectionKey } from './pages/SettingsPage';
import QuotationPage from './pages/QuotationPage';
import SalesDocumentsPage from './pages/SalesDocumentsPage';
import LibraryPage from './pages/LibraryPage';
import FinancePage from './pages/FinancePage';
import WaterSlipPage from './pages/WaterSlipPage';
import StockPage from './pages/StockPage';
import {
  advanceOrderStatus,
  rollbackOrderStatus,
  createBackup,
  getAutoBackupStatus,
  deleteProduct,
  exportProducts,
  downloadProductImportTemplate,
  getCustomers,
  listCompanies,
  getCompanyProfile,
  createCustomer,
  getOrderDetail,
  getNextOrderNumber,
  getOrders,
  getOrderStats,
  getProducts,
  getProduct,
  mergeLabels,
  mapProductRecord,
  recordPrintHistory,
  restoreBackup,
  saveLabels,
  saveOrder,
  saveCustomerProduct,
  saveProduct,
  setProductStatus,
  deleteOrderContract,
  generateOrderContractPdf,
  deleteOrder,
  previewBackup,
  publishOrder,
  uploadPaymentProof,
  uploadOrderContract,
  uploadOrderDetailImage,
  updateProductImage,
  deleteProductImage,
  deleteProductVideo,
  updateProductAttachmentCategory,
  deleteProductAttachment,
  updateProduct,
  importProducts,
  updateOrderTracking,
  confirmPartialShipments,
} from './api';
import type { ApiOrderDetail, ApiOrderRow, AuthUser, OrderListStats } from './api';
import type { PaymentProofStatus } from '../shared/finance';
import { normalizeOrderChannel, type OrderChannel } from '../shared/domain';
import type { PartialShipmentEntryInput } from '../shared/shipping';

function createId(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }

function asNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function mapOrderItem(row: Record<string, unknown>): OrderItemDraft {
  const quantity = Math.max(1, Math.trunc(asNumber(row.quantity ?? row.total_count, 1)));
  const packSize = Math.max(1, Math.trunc(asNumber(row.pack_count ?? row.packCount, 1)));
  const customerProductId = row.customer_product_id == null ? undefined : Number(row.customer_product_id);
  const productId = row.product_id == null ? undefined : Number(row.product_id);
  const unitPriceCents = Math.max(0, Math.trunc(asNumber(row.unit_price_cents ?? row.unitPriceCents, 0)));
  const amountCents = Math.max(0, Math.trunc(asNumber(row.amount_cents ?? row.amountCents, quantity * unitPriceCents)));
  const rawPackaging = Array.isArray(row.packaging) ? row.packaging : [];
  const packaging = rawPackaging.map((raw) => {
    const item = raw as Record<string, unknown>;
    return {
      id: String(item.id ?? createId('packaging')),
      name: String(item.name ?? ''),
      innerSize: String(item.innerSize ?? ''),
      innerWeight: String(item.innerWeight ?? ''),
      outerSize: String(item.outerSize ?? ''),
      outerWeight: String(item.outerWeight ?? ''),
      packSize: Math.max(1, Math.trunc(asNumber(item.packCount ?? item.pack_count, packSize))),
      purchasePrice: '',
      length: String(item.outerLength ?? item.outer_length ?? ''),
      width: String(item.outerWidth ?? item.outer_width ?? ''),
      height: String(item.outerHeight ?? item.outer_height ?? ''),
    };
  });
  const rawRequirementAttachments = Array.isArray(row.requirementAttachments) ? row.requirementAttachments : [];
  const nullableCents = (key: string) => row[key] == null && row[key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())] == null
    ? null
    : Math.max(0, Math.trunc(asNumber(row[key] ?? row[key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())], 0)));
  return { id: String(row.id ?? createId('item')), customerProductId, productId: productId == null ? undefined : String(productId), shippedQuantity: Math.max(0, Math.trunc(asNumber(row.shipped_quantity ?? row.shippedQuantity, 0))), name: String(row.name ?? row.product_name ?? ''), sku: String(row.sku ?? ''), specification: String(row.specification ?? row.spec ?? ''), quantity, packSize, boxes: Math.ceil(quantity / packSize), unitPriceCents, amountCents, freightPerBoxCents: Math.max(0, Math.trunc(asNumber(row.freight_per_box_cents ?? row.freightPerBoxCents, 0))), machineCostCents: nullableCents('machine_cost_cents'), batteryCostCents: nullableCents('battery_cost_cents'), chargerCostCents: nullableCents('charger_cost_cents'), packagingCostCents: nullableCents('packaging_cost_cents'), accessoryCostCents: nullableCents('accessory_cost_cents'), otherCostCents: nullableCents('other_cost_cents'), costConfirmed: Boolean(row.cost_confirmed ?? row.costConfirmed), remark: String(row.remark ?? ''), labelRequirement: String(row.label_requirement ?? row.labelRequirement ?? ''), customerProductAttachments: rawRequirementAttachments.map((raw) => { const item = raw as Record<string, unknown>; const relativePath = String(item.relative_path ?? item.relativePath ?? ''); return { id: Number(item.id), customerProductId: customerProductId ?? 0, relativePath, originalName: String(item.original_name ?? item.originalName ?? '客户产品资料'), mimeType: String(item.mime_type ?? item.mimeType ?? ''), size: asNumber(item.size ?? item.size_bytes), createdAt: String(item.created_at ?? item.createdAt ?? ''), url: String(item.url ?? (relativePath ? `/files/${relativePath}` : '')), category: (['label', 'instruction', 'packaging', 'other'].includes(String(item.category)) ? String(item.category) : 'other') as import('../shared/customers').CustomerProductAttachmentCategory }; }), packaging };
}

function mapOrderDetail(row: ApiOrderDetail | ApiOrderRow): OrderDraft {
  const raw = row as unknown as Record<string, unknown>;
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const rawItemImages = raw.itemImages && typeof raw.itemImages === 'object'
    ? raw.itemImages as Record<string, Array<{ url?: string }>>
    : {};
  const rawContracts = Array.isArray(raw.contracts) ? raw.contracts : [];
  const rawDetailImages = Array.isArray(raw.orderDetailImages) ? raw.orderDetailImages : Array.isArray(raw.order_detail_images) ? raw.order_detail_images : [];
  const mappedContracts = rawContracts.map((contract): OrderContractDraft => { const item = contract as Record<string, unknown>; const relativePath = String(item.relative_path ?? item.relativePath ?? ''); const sourceCustomerProductId = item.source_customer_product_id ?? item.sourceCustomerProductId; return { id: String(item.id), name: String(item.original_name ?? item.originalName ?? '订单附件'), url: String(item.url ?? (relativePath ? `/files/${relativePath}` : '')), mimeType: String(item.mime_type ?? item.mimeType ?? ''), size: asNumber(item.size ?? item.size_bytes), createdAt: String(item.created_at ?? item.createdAt ?? ''), category: String(item.category ?? 'other'), sourceCustomerProductId: sourceCustomerProductId == null ? null : Number(sourceCustomerProductId) }; });
  const rawFinance = (raw.financeSummary ?? raw.finance_summary) as Record<string, unknown> | null | undefined;
  return {
      id: String(raw.id), orderNo: String(raw.order_no ?? ''), orderedAt: String(raw.ordered_at ?? '').slice(0, 10), customerId: raw.customer_id == null ? null : Number(raw.customer_id), customerName: String(raw.customer_name ?? ''), customerContactName: String(raw.customer_contact_name ?? ''), customerContactPhone: String(raw.customer_contact_phone ?? ''), customerShippingInfo: String(raw.customer_shipping_info ?? ''), channel: normalizeOrderChannel(raw.channel, 'offline'), settlementType: raw.settlement_type === 'personal' ? 'personal' : 'corporate', paymentPolicy: normalizePaymentPolicy(raw.payment_policy ?? raw.paymentPolicy), depositPercent: Math.max(0, Math.trunc(asNumber(raw.deposit_percent ?? raw.depositPercent))), creditDays: Math.max(0, Math.trunc(asNumber(raw.credit_days ?? raw.creditDays))), stickerConsumedCount: Math.max(0, Math.trunc(asNumber(raw.sticker_consumed_count ?? raw.stickerConsumedCount))), stickerAttachments: (() => { try { const parsed = typeof raw.sticker_json === 'string' ? JSON.parse(raw.sticker_json) : raw.sticker_json; return Array.isArray(parsed) ? parsed.map((entry) => { const row = entry as Record<string, unknown>; return { customerProductId: Number(row.customerProductId ?? 0), name: String(row.name ?? ''), file: String(row.file ?? ''), remaining: Math.trunc(asNumber(row.remaining)), required: Math.trunc(asNumber(row.required)) }; }).filter((entry) => entry.customerProductId > 0 && entry.file) : []; } catch { return []; } })(), companyId: raw.company_id == null ? null : Number(raw.company_id), companyName: String(raw.company_name ?? ''), orderDetail: String(raw.order_detail ?? raw.orderDetail ?? ''), orderDetailImages: rawDetailImages.map((image) => { const item = image as Record<string, unknown>; const relativePath = String(item.relative_path ?? item.relativePath ?? ''); return { id: String(item.id), name: String(item.original_name ?? item.originalName ?? '订单详情图片'), url: String(item.url ?? (relativePath ? `/files/${relativePath}` : '')), mimeType: String(item.mime_type ?? item.mimeType ?? ''), size: asNumber(item.size ?? item.size_bytes) }; }), recipientName: String(raw.recipient_name ?? ''), recipientInfo: String(raw.recipient_info ?? ''), amount: asNumber(raw.amount).toFixed(2), shippingCents: Math.max(0, Math.trunc(asNumber(raw.shipping_cents ?? raw.shippingCents))), logisticsCostCents: raw.logistics_cost_cents == null && raw.logisticsCostCents == null ? null : Math.max(0, Math.trunc(asNumber(raw.logistics_cost_cents ?? raw.logisticsCostCents))), labelCostCents: raw.label_cost_cents == null && raw.labelCostCents == null ? null : Math.max(0, Math.trunc(asNumber(raw.label_cost_cents ?? raw.labelCostCents))), otherCostCents: raw.other_cost_cents == null && raw.otherCostCents == null ? null : Math.max(0, Math.trunc(asNumber(raw.other_cost_cents ?? raw.otherCostCents))), otherCostNote: String(raw.other_cost_note ?? raw.otherCostNote ?? ''), costConfirmed: Boolean(raw.cost_confirmed ?? raw.costConfirmed), trackingNo: String(raw.tracking_no ?? ''), paymentNote: String(raw.payment_note ?? raw.paymentNote ?? ''), paymentProofs: (Array.isArray(raw.paymentProofs) ? raw.paymentProofs : Array.isArray(raw.payment_proofs) ? raw.payment_proofs : []).map((proof) => { const item = proof as Record<string, unknown>; const relativePath = String(item.relative_path ?? item.relativePath ?? ''); return { id: String(item.id), name: String(item.original_name ?? item.originalName ?? '付款凭证'), url: String(item.url ?? (relativePath ? `/files/${relativePath}` : '')), note: String(item.note ?? ''), mimeType: String(item.mime_type ?? item.mimeType ?? ''), size: asNumber(item.size ?? item.size_bytes), createdAt: String(item.created_at ?? item.createdAt ?? '') }; }), contracts: mappedContracts, labels: Array.isArray(raw.labels) ? raw.labels as Array<Record<string, unknown>> : [], remark: String(raw.remark ?? ''), items: rawItems.map((item) => { const mapped = mapOrderItem(item as Record<string, unknown>); const imageUrl = rawItemImages[Number(mapped.id)]?.[0]?.url; return imageUrl?.startsWith('/files/') ? { ...mapped, imageRelativePath: imageUrl.slice('/files/'.length) } : mapped; }), totalBoxes: Math.max(0, Math.trunc(asNumber(raw.total_boxes))), status: String(raw.status ?? 'pending_stock') as OrderStatus, labelPrintedAt: raw.label_printed_at == null ? undefined : String(raw.label_printed_at),
      financeSummary: rawFinance ? {
        orderId: Math.trunc(asNumber(rawFinance.orderId ?? rawFinance.order_id)),
        receivableCents: Math.max(0, Math.trunc(asNumber(rawFinance.receivableCents ?? rawFinance.receivable_cents))),
        receivedCents: Math.max(0, Math.trunc(asNumber(rawFinance.receivedCents ?? rawFinance.received_cents))),
        outstandingCents: Math.trunc(asNumber(rawFinance.outstandingCents ?? rawFinance.outstanding_cents)),
        refundedCents: Math.max(0, Math.trunc(asNumber(rawFinance.refundedCents ?? rawFinance.refunded_cents))),
        overpaidCents: Math.max(0, Math.trunc(asNumber(rawFinance.overpaidCents ?? rawFinance.overpaid_cents))),
        paymentStatus: String(rawFinance.paymentStatus ?? rawFinance.payment_status ?? 'unpaid'),
        proofStatus: String(rawFinance.proofStatus ?? rawFinance.proof_status ?? 'none'),
        invoiceStatus: String(rawFinance.invoiceStatus ?? rawFinance.invoice_status ?? 'not_requested'),
        updatedAt: String(rawFinance.updatedAt ?? rawFinance.updated_at ?? ''),
      } as import('./../shared/finance').OrderFinanceLite : null,
      createdBy: String(raw.created_by ?? raw.createdBy ?? '') || undefined,
  };
}

function labelFromApi(raw: Record<string, unknown>, order: OrderDraft): CartonLabel {
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const productTotals = new Map<string, number>();
  order.items.forEach((item) => {
    const key = `${item.name}\u0000${item.sku}\u0000${item.specification}`;
    productTotals.set(key, (productTotals.get(key) ?? 0) + Math.max(1, Math.trunc(item.quantity)));
  });
  return { id: String(raw.id), orderId: order.id ?? '', orderNo: order.orderNo, recipientName: order.recipientName, cartonNo: asNumber(raw.box_no ?? raw.boxNo, 1), totalCartons: asNumber(raw.total_boxes ?? raw.totalBoxes, 1), isTail: Boolean(raw.is_tail ?? raw.isTail) || rawItems.length > 1 || rawItems.some((rawLine) => { const line = rawLine as Record<string, unknown>; return asNumber(line.total_count ?? line.totalCount, 0) < asNumber(line.pack_count ?? line.packCount, 0); }), remark: String(raw.remark ?? ''), orderRemark: String(raw.order_remark ?? raw.orderRemark ?? order.orderDetail ?? ''), lines: rawItems.map((rawLine, index) => { const line = rawLine as Record<string, unknown>; const name = String(line.name ?? line.product_name ?? ''); const sku = String(line.sku ?? ''); const specification = String(line.specification ?? line.spec ?? ''); return { id: String(line.id ?? `${raw.id}-line-${index}`), orderItemId: line.order_item_id == null && line.orderItemId == null ? null : asNumber(line.order_item_id ?? line.orderItemId), sku, name, specification, packSize: Math.max(1, Math.trunc(asNumber(line.pack_count ?? line.packCount, 1))), quantity: Math.max(1, Math.trunc(asNumber(line.total_count ?? line.totalCount, 1))), boxCount: Math.max(1, Math.trunc(asNumber(line.box_count ?? line.boxCount, 1))), totalQuantity: productTotals.get(`${name}\u0000${sku}\u0000${specification}`) ?? Math.max(1, Math.trunc(asNumber(line.total_quantity ?? line.totalQuantity ?? line.total_count ?? line.totalCount, 1))), remark: String(line.remark ?? '') }; }) };
}

function orderKey(order: OrderDraft) { return order.id ?? order.orderNo; }

const ACTIVE_NAV_STORAGE_KEY = 'workbench:active-nav';

/** 要删的图片或附件已经不在服务端（404）时，结果就是我们要的状态：让它过，别把后面的上传新图打断。 */
async function deleteIfStillThere(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if ((error as { code?: string }).code !== 'NOT_FOUND') throw error;
  }
}

function initialActiveNav(): NavigationKey {
  try {
    const saved = window.localStorage.getItem(ACTIVE_NAV_STORAGE_KEY);
    if (saved && navigationKeys.includes(saved as NavigationKey)) return saved as NavigationKey;
  } catch { /* localStorage 不可用时回退到默认模块 */ }
  return 'dashboard';
}

const ORDERS_CHANNEL_STORAGE_KEY = 'workbench:orders-channel';
/** 订单列表走服务端分页：每页条数小一些，详情按页批量取。 */
const ORDERS_PAGE_SIZE = 30;

function initialOrdersQuery(): OrdersListQuery {
  let channel: OrderChannel = 'online';
  try {
    const saved = window.localStorage.getItem(ORDERS_CHANNEL_STORAGE_KEY);
    if (saved === 'online' || saved === 'offline') channel = saved;
  } catch { /* localStorage 不可用时默认线上 */ }
  return { channel, statuses: [], q: '', page: 1, pageSize: ORDERS_PAGE_SIZE };
}

interface WorkbenchProps {
  user: AuthUser;
  onLogout: () => void;
}

/** 登录后的工作台主体：数据加载必须发生在会话就绪之后，所以独立成组件。 */
function Workbench({ user, onLogout }: WorkbenchProps) {
  const [active, setActive] = useState<NavigationKey>(initialActiveNav);
  const [orders, setOrders] = useState<OrderDraft[]>([]);
  /** 订单列表查询条件（渠道/状态/搜索/页码）由 App 持有，OrdersPage 只负责展示与发起变更。 */
  const [ordersQuery, setOrdersQuery] = useState<OrdersListQuery>(initialOrdersQuery);
  const ordersQueryRef = useRef(ordersQuery);
  const ordersLoadSeq = useRef(0);
  /** 从工作台入口进入订单页时已按入口条件加载过，避免挂载后重复请求。 */
  const ordersEntryLoadedRef = useRef(false);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [orderStats, setOrderStats] = useState<OrderListStats>();
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [productSaving, setProductSaving] = useState(false);
  const productSaveTask = useRef<Promise<void> | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyProfile, setCompanyProfile] = useState<CompanySnapshot>({ name: '', logoRelativePath: null, phone: '', address: '', defaultIssuer: '', wechatQrRelativePath: null });
  const [labelsByOrderId, setLabelsByOrderId] = useState<Record<string, CartonLabel[]>>({});
  const [customerProductsInitialCustomerId, setCustomerProductsInitialCustomerId] = useState<number | null>(null);
  const [financeInitialOrderId, setFinanceInitialOrderId] = useState<number>();
  const [financeInitialChannel, setFinanceInitialChannel] = useState<OrderChannel>();
  const [waterInitialChannel, setWaterInitialChannel] = useState<OrderChannel>();
  /** 从订单详情进入财务时记住来源订单，财务详情里可以一键返回并重新打开该订单。 */
  const [financeReturnOrderId, setFinanceReturnOrderId] = useState<number>();
  const [ordersInitialOrderId, setOrdersInitialOrderId] = useState<number | null>(null);
  const [ordersInitialStatus, setOrdersInitialStatus] = useState<OrderStatus>();
  const [ordersInitialChannel, setOrdersInitialChannel] = useState<OrderChannel>();
  const [ordersStartCreate, setOrdersStartCreate] = useState(false);
  const [quotationStartCreate, setQuotationStartCreate] = useState(false);
  const [productStartCreate, setProductStartCreate] = useState(false);
  const [waterInitialStatus, setWaterInitialStatus] = useState<PaymentProofStatus>();
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSectionKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileTabs, setMobileTabs] = useState<NavigationKey[]>(loadMobileTabs);

  const updateMobileTabs = useCallback((next: NavigationKey[]) => {
    setMobileTabs(next);
    saveMobileTabs(next);
  }, []);

  /** 切入某个模块的公共动作；返回键落回上一级菜单时也走这里，只是不再压历史。 */
  const applyNav = useCallback((next: NavigationKey) => {
    // The customer id is a one-time hand-off from quotation sync. Clear it
    // when leaving the customer product page so a later manual visit does
    // not unexpectedly jump back to the last synced customer.
    if (next !== 'customer-products') setCustomerProductsInitialCustomerId(null);
    if (next !== 'finance') { setFinanceInitialOrderId(undefined); setFinanceReturnOrderId(undefined); setFinanceInitialChannel(undefined); }
    if (next !== 'water-slips') setWaterInitialChannel(undefined);
    if (next !== 'orders') { setOrdersInitialOrderId(null); setOrdersInitialChannel(undefined); }
    if (next !== 'settings') setSettingsInitialSection(null);
    setActive(next);
    setMobileNavOpen(false);
    // 切换模块后回到列表顶部，避免手机上停留在上一个模块的滚动位置。
    // 真正滚动的是文档本身；.app-content 只是包裹层，两处都清一遍更稳。
    window.scrollTo({ top: 0, left: 0 });
    document.querySelector('.app-content')?.scrollTo({ top: 0 });
    // 记住当前模块，浏览器刷新后仍停留在原页面。
    try { window.localStorage.setItem(ACTIVE_NAV_STORAGE_KEY, next); } catch { /* 忽略存储失败 */ }
  }, []);

  const navigate = useCallback((next: NavigationKey) => {
    applyNav(next);
    // 压一格历史：手机返回键 / 浏览器后退能回到上一级菜单，而不是直接收起 App。
    pushPageKey(next);
  }, [applyNav]);

  // 安卓壳的返回键 = 浏览器后退：先关弹窗与「更多」抽屉（各组件在 navigation-history
  // 登记关闭层），再逐格回到上一级菜单；回到第一页后由壳负责收起 App。
  useEffect(() => initNavigationHistory({
    initialKey: initialActiveNav(),
    onNavigate: (key) => {
      if (!navigationKeys.includes(key as NavigationKey)) return;
      applyNav(key as NavigationKey);
      setCurrentPageKey(key);
    },
  }), [applyNav]);

  // 「更多」抽屉打开时登记为一层：返回键先关抽屉，页面不动。
  const mobileNavLayerId = useRef(Symbol('mobile-nav-layer'));
  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    registerCloseLayer(mobileNavLayerId.current, () => setMobileNavOpen(false));
    return () => unregisterCloseLayer(mobileNavLayerId.current);
  }, [mobileNavOpen]);

  const notify = useCallback((message: string, kind: ToastMessage['kind'] = 'info') => {
    // 同文案去重：并发请求同时失败时只弹一条，避免 toast 堆叠刷屏。
    setMessages((current) => {
      if (current.some((item) => item.message === message)) return current;
      const id = createId('toast');
      window.setTimeout(() => setMessages((current2) => current2.filter((item) => item.id !== id)), 4200);
      return [...current, { id, message, kind }];
    });
  }, []);

  const [backupAlert, setBackupAlert] = useState<string | null>(null);
  // App 壳里导出文件保存到手机失败时（写盘失败/权限被拒），原生会回调到这里提示；
  // 浏览器与旧壳不会回调，无事发生。
  useEffect(() => registerFileSaveFailureHandler((stage, message) => {
    console.warn('file save failed', stage, message);
    notify('导出文件保存失败，请重试或改用电脑端导出', 'error');
  }), [notify]);
  // 自动备份失败原先只在设置页显示一行，谁都不会没事去翻；而备份停摆恰恰是最不能错过的。
  // 所以开屏查一次状态，失败就常驻横幅，直到用户处理或手动关掉。
  useEffect(() => {
    let cancelled = false;
    getAutoBackupStatus()
      .then((status) => {
        if (cancelled || status.lastResult !== 'failed') return;
        const when = status.lastBackupAt ? new Date(status.lastBackupAt).toLocaleString('zh-CN', { hour12: false }) : '时间未知';
        setBackupAlert(`最近一次自动备份失败（${when}）：${status.lastError ?? '原因未知'}。这些数据目前没有新的备份兜底，请检查备份目录是否还能写、磁盘是否满了。`);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  // 后台上传队列：进度条、产品库标记、续传提示都读这一份状态。
  const uploadQueue = useSyncExternalStore(productUploadQueue.subscribe, productUploadQueue.getSnapshot);
  const uploadWasActive = useRef(false);
  // 手机端这几个页面的搜索框固定在视口顶部，进度条要自己让开它（见 app.css 的 is-below-floating-search）
  const floatingSearchPage = active === 'products' || active === 'orders' || active === 'finance';
  const uploadBarClass = floatingSearchPage ? ' is-below-floating-search' : '';

  const loadProducts = useCallback(async (): Promise<boolean> => {
    try { setProducts(await getProducts()); return true; } catch (error) { notify((error as { message?: string }).message ?? '产品库加载失败', 'error'); return false; }
  }, [notify]);

  // 后台上传每传完一张，就单独刷新那个产品（GET /api/products/:id，比整表刷新轻），
  // 让正式图片尽早顶掉图库里的上传占位；同一产品并发触发时合并成一次。
  const productRefreshState = useRef({ inFlight: new Set<string>(), dirty: new Set<string>() });
  const refreshProductById = useCallback(async (productId: string): Promise<void> => {
    const state = productRefreshState.current;
    if (state.inFlight.has(productId)) { state.dirty.add(productId); return; }
    state.inFlight.add(productId);
    try {
      do {
        state.dirty.delete(productId);
        const fresh = await getProduct(productId);
        setProducts((current) => current.map((item) => (String(item.id) === productId ? fresh : item)));
      } while (state.dirty.has(productId));
    } catch {
      // 单品刷新失败不打断上传；批次结束时还会整表刷新一次兜底。
    } finally {
      state.inFlight.delete(productId);
    }
  }, []);

  // 一个产品的文件传完（或最终失败）就刷新产品库，让图片立刻出现在列表里。
  useEffect(() => {
    productUploadQueue.setBatchSettledHandler(() => { void loadProducts(); });
    productUploadQueue.setFileUploadedHandler((productId) => { void refreshProductById(productId); });
    void productUploadQueue.initialize();
  }, [loadProducts, refreshProductById]);

  // 整轮上传结束时给一次结果提示；失败项必须说出来，不能让"已保存"掩盖"图少了"。
  useEffect(() => {
    if (uploadWasActive.current && !uploadQueue.active) {
      if (uploadQueue.failures.length) {
        notify(`有 ${uploadQueue.failures.length} 个文件没传成功，顶部提示里可以重试`, 'error');
      } else if (uploadQueue.done > 0) {
        notify('图片已全部上传完成', 'success');
      }
    }
    uploadWasActive.current = uploadQueue.active;
  }, [uploadQueue.active, uploadQueue.done, uploadQueue.failures.length, notify]);

  // 上传期间请手机壳把 App 保活（前台服务 + 通知栏进度）：安卓退到后台会把应用冻结、
  // 上传随之停住，挂着前台服务就能继续传；网页版里这些都是空操作。
  const uploadKeepAlive = useRef(false);
  useEffect(() => {
    if (uploadQueue.active) {
      const text = `正在后台上传 ${uploadQueue.done}/${uploadQueue.total} 个文件`;
      if (!uploadKeepAlive.current) {
        uploadKeepAlive.current = true;
        startUploadKeepAlive(text, uploadQueue.done, uploadQueue.total);
      } else {
        updateUploadKeepAlive(text, uploadQueue.done, uploadQueue.total);
      }
    } else if (uploadKeepAlive.current) {
      uploadKeepAlive.current = false;
      stopUploadKeepAlive();
    }
  }, [uploadQueue.active, uploadQueue.done, uploadQueue.total]);
  const loadCompanyProfile = useCallback(async () => {
    try { setCompanyProfile(await getCompanyProfile()); } catch { /* company branding is optional; keep the fallback */ }
  }, []);
  const loadCustomers = useCallback(async () => {
    try { setCustomers(await getCustomers(true)); } catch (error) { notify((error as { message?: string }).message ?? '客户档案加载失败', 'error'); }
  }, [notify]);
  const loadCompanies = useCallback(async () => {
    try { setCompanies((await listCompanies(true)).items); } catch (error) { notify((error as { message?: string }).message ?? '公司档案加载失败', 'error'); }
  }, [notify]);
  const loadOrders = useCallback(async (patch: Partial<OrdersListQuery> = {}) => {
    const query = { ...ordersQueryRef.current, ...patch };
    ordersQueryRef.current = query;
    setOrdersQuery(query);
    const seq = ++ordersLoadSeq.current;
    setOrdersLoading(true);
    try {
      let [result, stats] = await Promise.all([
        getOrders({ channel: query.channel, statuses: query.statuses, q: query.q, page: query.page, pageSize: query.pageSize }),
        // 统计失败不影响列表本身：徽标/状态数保持上一次的值即可。
        getOrderStats({ channel: query.channel }).catch(() => undefined),
      ]);
      if (seq !== ordersLoadSeq.current) return;
      // 删除/筛选后页码可能越界：回到最后一页重新取，避免停在空白页。
      if (!result.rows.length && result.total > 0 && query.page > 1) {
        const lastPage = Math.max(1, Math.ceil(result.total / query.pageSize));
        if (lastPage !== query.page) {
          const lastQuery = { ...query, page: lastPage };
          ordersQueryRef.current = lastQuery;
          setOrdersQuery(lastQuery);
          [result, stats] = await Promise.all([
            getOrders({ channel: lastQuery.channel, statuses: lastQuery.statuses, q: lastQuery.q, page: lastQuery.page, pageSize: lastQuery.pageSize }),
            getOrderStats({ channel: lastQuery.channel }).catch(() => undefined),
          ]);
          if (seq !== ordersLoadSeq.current) return;
        }
      }
      // 列表行不含明细与财务汇总，按当前页补详情；失败时退回列表行，至少保证列表可见。
      const details = await Promise.all(result.rows.map((row) => getOrderDetail(row.id).catch(() => row)));
      if (seq !== ordersLoadSeq.current) return;
      const mapped = details.map((row) => mapOrderDetail(row as ApiOrderDetail | ApiOrderRow));
      setOrders(mapped);
      setOrdersTotal(result.total);
      if (stats) setOrderStats(stats);
      setLabelsByOrderId((current) => {
        const next = { ...current };
        details.forEach((row, index) => {
          const rawLabels = Array.isArray((row as ApiOrderDetail).labels) ? (row as ApiOrderDetail).labels : [];
          if (rawLabels.length) next[orderKey(mapped[index])] = rawLabels.map((label) => labelFromApi(label as Record<string, unknown>, mapped[index]));
        });
        return next;
      });
    } catch (error) {
      // 已被更新请求取代的旧请求失败时不再打扰用户（典型：进入订单页会连续触发几次查询）。
      if (seq !== ordersLoadSeq.current) return;
      notify((error as { message?: string }).message ?? '订单加载失败', 'error');
    }
    finally { if (seq === ordersLoadSeq.current) setOrdersLoading(false); }
  }, [notify]);

  /** 深链/打印记录用：按 ID 取单条订单详情，不依赖当前分页。 */
  const fetchOrderById = useCallback(async (id: number | string): Promise<OrderDraft | undefined> => {
    try {
      const raw = await getOrderDetail(id);
      const order = mapOrderDetail(raw);
      // 深链订单可能不在当前页，loadOrders 不会为它补箱唛。这里顺手写入 labelsByOrderId，
      // 否则「打印箱唛 / 编辑箱唛」会退回自动装箱结果，保存时覆盖服务端的手工箱唛。
      const rawLabels = Array.isArray(raw.labels) ? raw.labels : [];
      if (rawLabels.length) {
        setLabelsByOrderId((current) => ({
          ...current,
          [orderKey(order)]: rawLabels.map((label) => labelFromApi(label, order)),
        }));
      }
      return order;
    } catch { return undefined; }
  }, []);

  const changeOrdersQuery = useCallback((patch: Partial<OrdersListQuery>) => { void loadOrders(patch); }, [loadOrders]);

  /**
   * 从工作台进入订单页：先清掉上次的状态/搜索/页码（「全部订单」必须回到全量），
   * 并在同一批里按入口条件发起查询；OrdersPage 挂载后不会再重复请求。
   */
  const openOrdersPage = useCallback((status?: OrderStatus, channel?: OrderChannel) => {
    setOrdersInitialStatus(status);
    setOrdersInitialChannel(channel);
    ordersEntryLoadedRef.current = true;
    void loadOrders({
      statuses: status ? [status] : [],
      q: '',
      page: 1,
      ...(channel ? { channel } : {}),
    });
    navigate('orders');
  }, [loadOrders, navigate]);

  useEffect(() => {
    // Workbench 只在 AuthGate 就绪后挂载，这里可以放心加载数据。
    // 订单列表改为进入订单页时按需加载，工作台统计走 /api/orders/stats，不再启动即拉全量。
    void Promise.all([loadProducts(), loadCustomers(), loadCompanies(), loadCompanyProfile()])
      .finally(() => setLoading(false));
  }, [loadProducts, loadCustomers, loadCompanies, loadCompanyProfile]);

  useEffect(() => {
    if (active !== 'orders') return;
    // 工作台入口已在 openOrdersPage 里带条件加载过，跳过这次重复刷新。
    if (ordersEntryLoadedRef.current) {
      ordersEntryLoadedRef.current = false;
      return;
    }
    void loadOrders();
  }, [active, loadOrders]);

  const toggleProductSaleStatus = async (product: ProductRecord, next: 'active' | 'discontinued') => {
    try {
      await setProductStatus(product.id, next);
      await loadProducts();
      const name = product.name || product.sku || '该产品';
      notify(next === 'discontinued' ? `「${name}」已停售，不会再出现在报价与销售开单的产品选择里` : `「${name}」已恢复在售`, 'success');
    } catch (error) {
      notify((error as { message?: string }).message ?? '产品状态修改失败', 'error');
    }
  };

  /**
   * 保存产品：连点两次会并发跑两遍图片差异同步，互相删掉对方刚上传的图，
   * 所以第二次点击复用第一次的任务，不再重跑。
   */
  const saveProductRecord = (draft: ProductRecord, mode: 'draft' | 'active', options?: { addToCatalogId?: number }) => {
    if (productSaveTask.current) return productSaveTask.current;
    setProductSaving(true);
    const task = syncProductFiles(draft, mode, options).finally(() => {
      productSaveTask.current = null;
      setProductSaving(false);
    });
    productSaveTask.current = task;
    return task;
  };

  const syncProductFiles = async (draft: ProductRecord, mode: 'draft' | 'active', options?: { addToCatalogId?: number }) => {
    try {
      const isExisting = /^\d+$/.test(draft.id);
      const previousProduct = products.find((item) => item.id === draft.id);
      // 停售产品编辑保存后仍是停售：只有「存为草稿」按钮能改成 draft，其余情况保留它当前的状态。
      const preservedStatus = previousProduct?.status === 'discontinued' ? 'discontinued' : 'active';
      // 「添加到产品图册」只随正式保存生效（草稿不进客户图册），服务端保存成功后追加进所选图册。
      const payload: ProductRecord & { addToCatalogId?: number } = {
        ...draft,
        status: mode === 'draft' ? 'draft' : preservedStatus,
        ...(options?.addToCatalogId ? { addToCatalogId: options.addToCatalogId } : {}),
      };
      const saved = isExisting ? await updateProduct(draft.id, payload) : await saveProduct(payload);
      const savedProductId = String((saved as { id?: number }).id);
      // 图片与附件的删除差异必须以这次保存返回的服务端现状为准。列表里的快照可能已经过期
      // （编辑器开着时手机上删过、或上一次保存失败留下的差量），照旧快照删就会对已经不存在的
      // id 发 DELETE，404 会把整个保存打断在「上传新图」之前，表现为图永远换不上。
      const serverImages = (Array.isArray(saved.images) ? saved.images : []).filter((image) => /^\d+$/.test(String(image.id)));
      const serverAttachments = (Array.isArray(saved.attachments) ? saved.attachments : []).filter((item) => /^\d+$/.test(String(item.id)));
      const draftImageIds = new Set(draft.images.filter((item) => !item.file && /^\d+$/.test(item.id)).map((item) => item.id));
      // 该产品还有文件在后台上传时，绝不能执行删除差异：此刻列表里看不到"刚传上去、还没进列表"的图，
      // 照旧快照删就会把它们当多余的删掉。宁可这次不处理删除，也不能误删。改完再存一次即可。
      const skipDeletes = productUploadQueue.hasPending(savedProductId);
      if (skipDeletes) {
        const pendingDeletes = serverImages.filter((image) => !draftImageIds.has(String(image.id))).length;
        if (pendingDeletes) {
          notify('该产品还有文件正在后台上传，这次没有处理图片删除；等上传完成后再保存一次即可', 'error');
        }
      }
      if (!skipDeletes) {
        for (const image of serverImages) {
          if (!draftImageIds.has(String(image.id))) await deleteIfStillThere(() => deleteProductImage(savedProductId, String(image.id)));
        }
      }
      // 已保存图片改分类/备注、附件改分类都是小请求，留在前台立即生效；
      // 真正耗时的是上传文件本身，交给后台队列。
      const savedImages = new Map(serverImages.map((image) => [String(image.id), image]));
      for (const image of draft.images) {
        if (image.file || !/^\d+$/.test(image.id)) continue;
        const previous = savedImages.get(image.id) as { category?: string; note?: string } | undefined;
        const category = image.category ?? '';
        const note = image.note ?? '';
        if (previous && (category !== (previous.category ?? '') || note !== (previous.note ?? ''))) {
          await updateProductImage(savedProductId, image.id, { category, note });
        }
      }
      const currentSavedAttachmentIds = new Set(
        draft.attachments.filter((item) => !item.file && /^\d+$/.test(item.id)).map((item) => item.id),
      );
      if (!skipDeletes) {
        for (const attachment of serverAttachments) {
          if (!currentSavedAttachmentIds.has(String(attachment.id))) {
            await deleteIfStillThere(() => deleteProductAttachment(savedProductId, String(attachment.id)));
          }
        }
      }
      // 视频删除差异：草稿里保留的视频才是要留下的；和删除图片同理，后台上传期间跳过。
      const draftVideoIds = new Set((draft.videos ?? []).filter((item) => !item.file && /^\d+$/.test(item.id)).map((item) => item.id));
      const serverVideos = Array.isArray((saved as { videos?: Array<Record<string, unknown>> }).videos)
        ? (saved as { videos: Array<Record<string, unknown>> }).videos
        : [];
      if (!skipDeletes) {
        for (const video of serverVideos) {
          const videoId = String(video.id ?? '');
          if (/^\d+$/.test(videoId) && !draftVideoIds.has(videoId)) {
            await deleteIfStillThere(() => deleteProductVideo(savedProductId, videoId));
          }
        }
      }
      for (const attachment of draft.attachments.filter((item) => !item.file && /^\d+$/.test(item.id))) {
        const previous = serverAttachments.find((item) => String(item.id) === attachment.id) as { category?: string } | undefined;
        if (previous && previous.category !== attachment.category) {
          await updateProductAttachmentCategory(savedProductId, attachment.id, attachment.category);
        }
      }

      // ===== 以下是耗时的文件上传，打包成一批交给后台队列 =====
      const productLabel = draft.name.trim() || draft.sku.trim() || `产品 ${savedProductId}`;
      const savedPackaging = Array.isArray(saved.packaging) ? saved.packaging : [];
      const batch: UploadBatch = { productId: savedProductId, productLabel, imageOrder: [], files: [] };
      const stamp = Date.now();
      let sequence = 0;
      const nextTaskId = (kind: string) => `up-${savedProductId}-${stamp}-${sequence++}-${kind}`;
      draft.images.forEach((image, index) => {
        if (image.file) {
          const taskId = nextTaskId('image');
          batch.imageOrder.push({ taskId });
          batch.files.push({
            meta: {
              id: taskId, productId: savedProductId, productLabel, kind: 'image',
              category: image.category ?? '', note: image.note ?? '', fileName: image.name || `图片-${index + 1}`,
            },
            file: image.file,
          });
        } else if (/^\d+$/.test(image.id)) {
          batch.imageOrder.push({ imageId: Number(image.id) });
        }
      });
      draft.packaging.forEach((packaging, index) => {
        const packagingId = savedPackaging[index] && String((savedPackaging[index] as Record<string, unknown>).id ?? '');
        for (const image of (packaging.images ?? []).filter((item) => item.file)) {
          if (!packagingId) continue;
          const taskId = nextTaskId('packaging');
          batch.files.push({
            meta: {
              id: taskId, productId: savedProductId, productLabel, kind: 'packaging-image',
              category: '', note: '', packagingId, fileName: image.file!.name,
            },
            file: image.file!,
          });
        }
      });
      for (const attachment of draft.attachments.filter((item) => item.file)) {
        const taskId = nextTaskId('attachment');
        batch.files.push({
          meta: {
            id: taskId, productId: savedProductId, productLabel, kind: 'attachment',
            category: attachment.category, note: '', fileName: attachment.name || attachment.file!.name,
          },
          file: attachment.file!,
        });
      }
      for (const video of (draft.videos ?? []).filter((item) => item.file)) {
        const taskId = nextTaskId('video');
        batch.files.push({
          meta: {
            id: taskId, productId: savedProductId, productLabel, kind: 'video',
            category: '', note: '', fileName: video.name || video.file!.name,
          },
          file: video.file!,
        });
      }

      const uploadCount = batch.files.length;
      await productUploadQueue.enqueue(batch);
      // 产品记录已经落库；列表刷新最多等 1.5 秒，避免刷新接口慢时保存按钮一直卡在「保存中」。
      // 新产品需要马上出现在列表里（带「图片上传中」标记），批次结束时队列还会再刷一次。
      await Promise.race([
        loadProducts(),
        new Promise<void>((resolve) => window.setTimeout(resolve, 1500)),
      ]);
      if (uploadCount) {
        notify(`${mode === 'draft' ? '草稿已保存' : '产品已保存'}，${uploadCount} 个文件正在后台上传，可以继续做别的`, 'success');
      } else {
        notify(mode === 'draft' ? '草稿已保存，可稍后继续编辑' : '产品已保存', 'success');
      }
    } catch (error) {
      notify((error as { message?: string }).message ?? '产品保存失败', 'error');
      // 抛出错误让产品库页面保持编辑器打开，避免未保存的内容丢失。
      throw error;
    }
  };
  const exportProductLibrary = async () => {
    try {
      const blob = await exportProducts();
      // App 壳里由原生写进手机「下载」并弹分享；浏览器里回退 blob 链接下载。
      await saveFileOrDownload(blob, `产品库-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`);
      notify('产品库已导出', 'success');
    } catch (error) { notify((error as { message?: string }).message ?? '产品库导出失败', 'error'); }
  };
  const downloadProductTemplate = async () => {
    try {
      const blob = await downloadProductImportTemplate();
      await saveFileOrDownload(blob, '产品库导入模板.xlsx');
      notify('产品库导入模板已下载', 'success');
    } catch (error) { notify((error as { message?: string }).message ?? '模板下载失败', 'error'); }
  };
  const importProductLibrary = async (file: File) => {
    try {
      const result = await importProducts(file);
      await loadProducts();
      notify(`产品库导入完成：新增 ${result.created} 个，更新 ${result.updated} 个`, 'success');
    } catch (error) { notify((error as { message?: string }).message ?? '产品库导入失败', 'error'); }
  };
  const saveOrderDraft = async (draft: OrderDraft) => {
    let orderId: number;
    try {
      const saved = await saveOrder(draft);
      orderId = Number(saved.id ?? draft.id);
      if (!Number.isSafeInteger(orderId) || orderId <= 0) throw new Error('订单保存成功但未返回有效订单 ID');
    } catch (error) {
      notify((error as { message?: string }).message ?? '订单保存失败', 'error');
      return;
    }
    // 附件是订单落库之后的追加步骤：单个失败不能报成「整单没保存」，也不能因此跳过列表刷新。
    const failed: string[] = [];
    const pendingUploads = [
      ...draft.paymentProofs.filter((item) => item.file).map((proof) => [proof.name || '付款凭证', () => uploadPaymentProof(orderId, proof.file!, proof.note ?? '')] as const),
      ...(draft.contracts ?? []).filter((item) => item.file).map((contract) => [contract.name || '订单附件', () => uploadOrderContract(orderId, contract.file!)] as const),
      ...(draft.orderDetailImages ?? []).filter((item) => item.file).map((image) => [image.name || '订单详情图片', () => uploadOrderDetailImage(orderId, image.file!)] as const),
    ];
    if (pendingUploads.length) notify(`正在上传 ${pendingUploads.length} 个附件，请稍候`, 'info');
    const upload = async (name: string, run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (error) {
        const reason = (error as { message?: string }).message ?? '未知错误';
        failed.push(`${name}（${reason}）`);
      }
    };
    for (const [name, run] of pendingUploads) await upload(name, run);
    for (const contractId of draft.deletedContractIds ?? []) await upload('删除附件', () => deleteOrderContract(contractId));
    await loadOrders();
    if (failed.length) {
      notify(`订单已保存，但 ${failed.length} 个附件处理失败：${failed.join('、')}。可先打开订单确认是否已上传，未上传的重新编辑该订单补传`, 'error');
      return;
    }
    notify(draft.status === 'draft' ? '草稿已保存，可稍后继续编辑' : '订单已保存', 'success');
  };
  // 草稿保存与正式保存共用持久化链路（附件上传等），仅提示语不同。
  const saveOrderAsDraft = async (draft: OrderDraft) => { await saveOrderDraft({ ...draft, status: 'draft' }); };
  const publishOrderDraft = async (order: OrderDraft) => {
    if (!order.id) return;
    try {
      await publishOrder(order.id);
      await loadOrders();
      notify(`草稿订单 ${order.orderNo} 已发布，进入待备货流程`, 'success');
    } catch (error) { notify((error as { message?: string }).message ?? '草稿发布失败，请补全订单信息后再试', 'error'); }
  };
  const saveOrderCustomerProduct = async (customerId: number, input: import('../shared/customers').CustomerProductSaveInput) => {
    try {
      const saved = await saveCustomerProduct(customerId, input);
      await loadCustomers();
      notify('客户产品已添加并加入订单', 'success');
      return saved;
    } catch (error) {
      notify((error as { message?: string }).message ?? '客户产品保存失败', 'error');
      throw error;
    }
  };
  const createCustomerProfile = async (input: import('../shared/customers').CustomerSaveInput) => {
    try {
      const saved = await createCustomer(input);
      await loadCustomers();
      notify(`客户“${saved.name}”已添加`, 'success');
      return saved;
    } catch (error) {
      notify((error as { message?: string }).message ?? '客户保存失败', 'error');
      throw error;
    }
  };
  const previewNextOrderNumber = async () => (await getNextOrderNumber()).number;
  const removeOrderContract = async (contractId: string) => {
    try {
      await deleteOrderContract(contractId);
      await loadOrders();
      notify('合同附件已删除', 'success');
    } catch (error) {
      notify((error as { message?: string }).message ?? '合同删除失败', 'error');
      throw error;
    }
  };
  const generateContract = async (order: OrderDraft) => {
    if (!order.id) return;
    try {
      const blob = await generateOrderContractPdf(order.id);
      // App 壳里由原生写进手机「下载」并弹分享；浏览器里回退 blob 链接下载。
      await saveFileOrDownload(blob, `${order.orderNo}-购销合同.pdf`);
      // 服务端已把 PDF 归档进订单附件，刷新后即可在详情里看到。
      await loadOrders();
      notify('购销合同已生成并归档', 'success');
    } catch (error) {
      notify((error as { message?: string }).message ?? '合同生成失败', 'error');
      throw error;
    }
  };
  const removeOrder = async (order: OrderDraft) => {
    if (!order.id) return;
    try {
      await deleteOrder(order.id);
      await loadOrders();
      notify('订单已删除', 'success');
    } catch (error) {
      notify((error as { message?: string }).message ?? '订单删除失败', 'error');
      throw error;
    }
  };
  // advance 只处理正式流程推进；草稿订单走 publishOrderDraft。
  const advance = async (order: OrderDraft, status: OrderStatus) => {
    if (status === 'draft' || order.status === 'draft') return;
    const enteringStock = (order.status === 'label_pending' && status === 'pending_stock') || (order.status === 'pending_stock' && status === 'stock_reported');
    if (enteringStock && !order.labelPrintedAt) {
      const targetLabel = status === 'pending_stock' ? '待备货' : '已备货';
      const proceed = window.confirm(`订单“${order.orderNo}”尚未打印箱唛，是否继续进入“${targetLabel}”？\n提示：打印箱唛仅作为提醒，不会阻止流程。`);
      if (!proceed) return;
    }
    // 完成打包：此前已扣减过标贴的订单，询问本次是否再次扣减（取消 = 照常打包但不扣）。
    let deductStickers: boolean | undefined;
    if (status === 'ship_pending' && (order.stickerConsumedCount ?? 0) > 0) {
      deductStickers = window.confirm(`订单“${order.orderNo}”此前完成过打包并扣减过标贴。\n本次完成打包是否再次扣减标贴？\n确定 = 再次扣减；取消 = 本次不扣减（仍完成打包）。`);
    }
    try {
      await advanceOrderStatus(Number(order.id), status, 'manual', deductStickers === false ? { deductStickers: false } : undefined);
      await loadOrders();
      notify(status === 'shipping' ? `订单 ${order.orderNo} 已进入发货中，可在发货中状态处理` : `订单 ${order.orderNo} 已推进到下一状态`, 'success');
    } catch (error) { notify((error as { message?: string }).message ?? '状态推进失败', 'error'); }
  };
  const rollback = async (order: OrderDraft, status: OrderStatus) => {
    if (!order.id) return;
    const action = getOrderRollbackAction(order.status);
    if (!action || action.target !== status) return;
    const undoShipping = order.status === 'shipped' && action.target === 'shipping';
    const message = undoShipping
      ? `确定撤销发货，把订单“${order.orderNo}”退回发货中吗？\n已确认的发货批次、物流单号和箱唛打印记录都会保留。`
      : `确定把订单“${order.orderNo}”${action.label}吗？\n物流单号、箱唛打印记录、订单附件和收款数据都会保留。`;
    if (!window.confirm(message)) return;
    try {
      await rollbackOrderStatus(Number(order.id), action.target);
      await loadOrders();
      notify(`订单 ${order.orderNo} 已${action.label}`, 'success');
    } catch (error) {
      notify((error as { message?: string }).message ?? '订单状态回退失败', 'error');
    }
  };
  // 批量推进：一键备货 / 一键打包 / 批量进入发货中，逐单推进、单单容错，结束后统一汇总。
  const batchAdvance = async (selected: OrderDraft[], action: BatchAdvanceAction) => {
    const actionLabels = { stock: '备货', pack: '打包', ship: '进入发货中' } as const;
    const plan = getBatchAdvancePlan(selected, action);
    if (!plan.targets.length) {
      const reason = plan.skipped.length ? plan.skipped[0].reason : '当前状态不支持该操作';
      notify(`所选订单没有可批量${actionLabels[action]}的订单（${reason}）`, 'error');
      return;
    }
    const unprintedCount = plan.targets.filter((target) => !target.order.labelPrintedAt).length;
    const lines: string[] = [];
    if (action === 'stock') lines.push(`确定对 ${plan.targets.length} 单执行“批量备货”吗？`, '备货：待备货 → 已备货');
    if (action === 'pack') lines.push(`确定对 ${plan.targets.length} 单执行“批量打包”吗？`, '打包：已备货/待打包 → 完成打包，推进到待发货');
    if (action === 'ship') lines.push(`确定对 ${plan.targets.length} 单执行“进入发货中”吗？`, '进入后到「发货中」回填物流单号并确认发货。');
    if (unprintedCount) lines.push(`注意：其中 ${unprintedCount} 单尚未打印箱唛（仅作提醒，不阻止流程）`);
    if (!window.confirm(lines.join('\n'))) return;
    let advanced = 0;
    const failed: string[] = [];
    for (const { order, steps } of plan.targets) {
      try {
        for (const step of steps) await advanceOrderStatus(Number(order.id), step);
        advanced += 1;
      } catch (error) {
        failed.push(`${order.orderNo}（${(error as { message?: string }).message ?? '推进失败'}）`);
      }
    }
    await loadOrders();
    const parts = [`批量${actionLabels[action]}完成：成功 ${advanced} 单`];
    if (plan.skipped.length) parts.push(`跳过 ${plan.skipped.length} 单`);
    if (failed.length) {
      notify(`${parts.join('，')}；失败 ${failed.length} 单：${failed.slice(0, 3).join('、')}${failed.length > 3 ? '等' : ''}`, 'error');
    } else {
      notify(parts.join('，'), 'success');
    }
  };
  const saveOrderLabels = async (order: OrderDraft, labels: CartonLabel[]) => {
    try {
      const result = await saveLabels(Number(order.id), labels);
      const savedLabels = Array.isArray((result as { labels?: unknown[] }).labels) ? (result as { labels: unknown[] }).labels.map((label) => labelFromApi(label as Record<string, unknown>, order)) : labels;
      setLabelsByOrderId((current) => ({ ...current, [orderKey(order)]: savedLabels }));
      notify('箱唛修改已保存', 'success');
      return savedLabels;
    } catch (error) { notify((error as { message?: string }).message ?? '箱唛保存失败', 'error'); throw error; }
  };
  const mergeOrderLabels = async (order: OrderDraft, labelIds: string[]) => {
    try {
      const result = await mergeLabels(Number(order.id), labelIds);
      const next = result.labels.map((label) => labelFromApi(label, order));
      setLabelsByOrderId((current) => ({ ...current, [orderKey(order)]: next }));
      notify('箱唛已合并并重新编号', 'success');
      return next;
    } catch (error) {
      notify((error as { message?: string }).message ?? '合箱失败', 'error');
      return undefined;
    }
  };
  const restoreAutoLabels = async (order: OrderDraft) => {
    try {
      const next = fallbackLabels(order);
      const result = await saveLabels(Number(order.id), next);
      const saved = Array.isArray((result as { labels?: unknown[] }).labels) ? (result as { labels: unknown[] }).labels.map((label) => labelFromApi(label as Record<string, unknown>, order)) : next;
      setLabelsByOrderId((current) => ({ ...current, [orderKey(order)]: saved }));
      notify('已恢复自动装箱方案', 'success');
      return saved;
    } catch (error) {
      notify((error as { message?: string }).message ?? '恢复自动方案失败', 'error');
      return undefined;
    }
  };
  const recordHistory = async (labels: CartonLabel[]) => {
    try {
      const orderIds = [...new Set(labels.map((label) => Number(label.orderId)).filter((id) => Number.isSafeInteger(id)))];
      const persistedLabelsByOrder = await Promise.all(orderIds.map(async (orderId) => {
        let order = orders.find((entry) => Number(entry.id) === orderId);
        const orderLabels = labels.filter((label) => Number(label.orderId) === orderId);
        if (!orderLabels.length) return [];
        const hasPersistedLabels = orderLabels.every((label) => /^\d+$/.test(label.id));
        // 列表改成服务端分页后，订单可能不在当前页：按 ID 取一次详情再持久化箱唛。
        if (!hasPersistedLabels && !order) order = await fetchOrderById(orderId);
        // 仍然取不到时无法先持久化箱唛，仍需原样上报，由服务端按提交内容记录。
        if (hasPersistedLabels || !order) return orderLabels;
        return await saveOrderLabels(order, orderLabels);
      }));
      const persistedLabels = persistedLabelsByOrder.flat();
      const persistedOrderIds = [...new Set(persistedLabels.map((label) => Number(label.orderId)).filter((id) => Number.isSafeInteger(id)))];
      await recordPrintHistory(persistedOrderIds, persistedLabels as unknown[], 'print');
      await loadOrders();
      notify('箱唛打印已记录，订单流程不受影响', 'success');
    } catch (error) { notify((error as { message?: string }).message ?? '打印记录失败', 'error'); throw error; }
  };

  // 发货中视图：单号失焦暂存，不推进状态；成功后同步本地订单，避免下次失焦重复保存。
  const saveShippingTracking = async (id: string, value: string) => {
    try {
      await updateOrderTracking(id, value);
      setOrders((current) => current.map((order) => orderKey(order) === id ? { ...order, trackingNo: value } : order));
      return true;
    } catch (error) {
      notify((error as { message?: string }).message ?? '物流单号保存失败', 'error');
      return false;
    }
  };
  const confirmShipping = async (entries: PartialShipmentEntryInput[]) => {
    if (!entries.length) {
      notify('还没有选择本次发货的产品数量', 'error');
      return;
    }
    try {
      const result = await confirmPartialShipments(entries);
      await loadOrders();
      notify(`已确认 ${entries.length} 单本次发货`, 'success');
      return result;
    } catch (error) {
      notify((error as { message?: string }).message ?? '发货确认失败', 'error');
      return undefined;
    }
  };

  const backup = async () => {
    try {
      const result = await createBackup();
      const anchor = document.createElement('a');
      anchor.href = result.downloadUrl;
      anchor.download = result.fileName;
      anchor.click();
      notify('备份已创建并开始下载', 'success');
    } catch (error) { notify((error as { message?: string }).message ?? '备份创建失败', 'error'); }
  };

  const restore = async (file: File) => {
    try {
      const manifest = await previewBackup(file);
      const attachmentCount = manifest.attachments.length;
      const confirmed = window.confirm(`备份时间：${manifest.createdAt}\n附件数量：${attachmentCount}\n恢复后会替换当前本机数据，并自动保留一份恢复前备份。确定继续吗？`);
      if (!confirmed) return;
      await restoreBackup(file);
      await Promise.all([loadProducts(), loadCustomers(), loadOrders()]);
      notify('数据已恢复，请重新检查订单与产品信息', 'success');
    } catch (error) { notify((error as { message?: string }).message ?? '数据恢复失败', 'error'); }
  };

  return <div className="app-layout"><Sidebar activeKey={active} onNavigate={navigate} companyName={companyProfile.name} logoUrl={companyProfile.logoRelativePath ? `/files/${companyProfile.logoRelativePath}` : undefined} mobileOpen={mobileNavOpen} onMobileOpenChange={setMobileNavOpen} user={user} onLogout={onLogout} /><main className="app-content">
    {backupAlert && <div className="backup-alert" role="alert">
      <span className="backup-alert-text">{backupAlert}</span>
      <span className="backup-alert-actions">
        <button type="button" className="button button-secondary" onClick={() => navigate('settings')}>去设置查看</button>
        <button type="button" className="button button-secondary" onClick={() => setBackupAlert(null)}>知道了</button>
      </span>
    </div>}
    {uploadQueue.resumableCount > 0 && <div className={`upload-notice${uploadBarClass}`} role="status">
      <span>上次有 {uploadQueue.resumableCount} 个文件没传完（可能是刷新或关掉了浏览器）。</span>
      <span className="upload-notice-actions">
        <button type="button" className="button button-primary" onClick={() => productUploadQueue.resume()}>继续上传</button>
        <button type="button" className="button button-secondary" onClick={() => void productUploadQueue.discardPending()}>丢弃</button>
      </span>
    </div>}
    {uploadQueue.active && <div className={`upload-progress${uploadBarClass}`} role="status">
      <span className="upload-progress-bar" style={{ width: `${uploadQueue.total ? Math.round((uploadQueue.done / uploadQueue.total) * 100) : 0}%` }} />
      <span className="upload-progress-text">正在后台上传文件 {uploadQueue.done}/{uploadQueue.total}…（可以继续做别的）</span>
    </div>}
    {uploadQueue.failures.length > 0 && <div className={`upload-notice upload-notice-error${uploadBarClass}`} role="alert">
      <span>
        有 {uploadQueue.failures.length} 个文件没传成功：{uploadQueue.failures.slice(0, 3).map((failure) => `${failure.productLabel} / ${failure.fileName}`).join('、')}
        {uploadQueue.failures.length > 3 ? ' 等' : ''}。产品资料已保存，缺的是这些图。
      </span>
      <span className="upload-notice-actions">
        <button type="button" className="button button-secondary" onClick={() => void productUploadQueue.retryFailures()}>重试</button>
      </span>
    </div>}
    {active === 'dashboard' && <DashboardPage onOpenOrders={openOrdersPage} onOpenFinance={(channel) => { setFinanceInitialChannel(channel); navigate('finance'); }} onOpenWaterSlips={(status, channel) => { setWaterInitialStatus(status); setWaterInitialChannel(channel); navigate('water-slips'); }} onNewOrder={(channel) => { setOrdersStartCreate(true); openOrdersPage(undefined, channel); }} onNewQuotation={() => { setQuotationStartCreate(true); navigate('quotations'); }} onNewProduct={() => { setProductStartCreate(true); navigate('products'); }} />}
    {active === 'finance' && <FinancePage onNotify={notify} initialOrderId={financeInitialOrderId} initialChannel={financeInitialChannel} returnOrderId={financeReturnOrderId} customers={customers} companies={companies} onCompaniesChanged={loadCompanies} onReturnToOrder={(orderId) => { setOrdersInitialOrderId(orderId); setFinanceReturnOrderId(undefined); navigate('orders'); }} />}
    {active === 'water-slips' && <WaterSlipPage onNotify={notify} initialStatus={waterInitialStatus} initialChannel={waterInitialChannel} onInitialFiltersConsumed={() => setWaterInitialStatus(undefined)} onOpenOrder={(orderId) => { setOrdersInitialOrderId(orderId); navigate('orders'); }} onOpenFinance={(orderId, channel) => { setFinanceInitialOrderId(orderId); setFinanceReturnOrderId(orderId); setFinanceInitialChannel(channel); navigate('finance'); }} />}
    {active === 'orders' && <OrdersPage orders={orders} ordersQuery={ordersQuery} ordersTotal={ordersTotal} ordersLoading={ordersLoading} orderStats={orderStats} onOrdersQueryChange={changeOrdersQuery} fetchOrderById={fetchOrderById} customers={customers} companies={companies} labelsByOrderId={labelsByOrderId} initialOrderId={ordersInitialOrderId} initialStatus={ordersInitialStatus} onInitialStatusConsumed={() => setOrdersInitialStatus(undefined)} initialChannel={ordersInitialChannel} onInitialChannelConsumed={() => setOrdersInitialChannel(undefined)} startCreate={ordersStartCreate} onStartCreateConsumed={() => setOrdersStartCreate(false)} onSaveOrder={(draft) => { void saveOrderDraft(draft); }} onSaveDraft={(draft) => { void saveOrderAsDraft(draft); }} onPublishOrder={(order) => { void publishOrderDraft(order); }} onDeleteOrder={(order) => { void removeOrder(order); }} onSaveCustomerProduct={saveOrderCustomerProduct} onCreateCustomer={createCustomerProfile} onGetNextOrderNumber={previewNextOrderNumber} onDeleteContract={removeOrderContract} onGenerateContract={generateContract} onAdvanceStatus={(order, status) => { void advance(order, status); }} onRollbackStatus={(order, status) => { void rollback(order, status); }} onBatchAdvance={(orders, action) => { void batchAdvance(orders, action); }} onSaveTracking={saveShippingTracking} onConfirmShipping={confirmShipping} onOpenFinance={(order) => { setFinanceInitialOrderId(Number(order.id)); setFinanceReturnOrderId(Number(order.id)); setFinanceInitialChannel(order.channel); navigate('finance'); }} onSaveLabels={(order, labels) => { void saveOrderLabels(order, labels); }} onMergeLabels={mergeOrderLabels} onRestoreAutoLabels={restoreAutoLabels} onPrintHistory={(labels) => recordHistory(labels).catch(() => undefined)} onRefreshOrders={async () => { await Promise.all([loadOrders(), loadCustomers()]); }} onNotify={notify} />}
    {active === 'stock' && <StockPage onNotify={notify} systemProducts={products} />}
    {active === 'quotations' && <QuotationPage onNotify={notify} startCreate={quotationStartCreate} onStartCreateConsumed={() => setQuotationStartCreate(false)} onOpenSalesDocument={() => navigate('sales-documents')} onOpenCustomerProducts={(customerId) => { setCustomerProductsInitialCustomerId(customerId); navigate('customer-products'); }} onSaveCustomerProduct={saveOrderCustomerProduct} onCreateCustomer={createCustomerProfile} />}
    {active === 'sales-documents' && <SalesDocumentsPage customers={customers} onNotify={notify} onSaveCustomerProduct={saveOrderCustomerProduct} onCreateCustomer={createCustomerProfile} onOpenOrder={(orderId) => { setOrdersInitialOrderId(orderId); navigate('orders'); }} />}
    {active === 'products' && <ProductsPage products={products} loading={loading} startCreate={productStartCreate} onStartCreateConsumed={() => setProductStartCreate(false)} onSave={saveProductRecord} saving={productSaving} onExport={exportProductLibrary} onOpenCatalog={() => navigate('product-catalog')} onDownloadTemplate={downloadProductTemplate} onImport={importProductLibrary} onRefresh={async () => { if (await loadProducts()) notify('产品库已刷新', 'success'); }} onReloadProducts={async () => { await loadProducts(); }} onManagePresets={() => { setSettingsInitialSection('packaging'); navigate('settings'); }} onManageProductOptions={() => { setSettingsInitialSection('product-options'); navigate('settings'); }} onUpdateSaleStatus={(product, next) => { void toggleProductSaleStatus(product, next); }} onDelete={async (product) => { try { await deleteProduct(product.id); await loadProducts(); notify('产品已删除', 'success'); } catch (error) { notify((error as { message?: string }).message ?? '删除失败', 'error'); } }} uploadingProductIds={uploadQueue.uploadingProductIds} uploadFiles={uploadQueue.files} onRetryUploadFile={(taskId) => productUploadQueue.retryFailure(taskId)} />}
    {active === 'product-catalog' && <CatalogPage products={products} loading={loading} onNotify={notify} />}
    {active === 'customer-products' && <CustomerProductsPage customers={customers} systemProducts={products} initialCustomerId={customerProductsInitialCustomerId ?? undefined} loading={loading} onCustomersChanged={loadCustomers} onNotify={notify} />}
    {active === 'library' && <LibraryPage customers={customers} onNotify={notify} />}
    {active === 'settings' && <SettingsPage onBackup={backup} onRestore={restore} onProfileChanged={setCompanyProfile} currentUser={user} mobileTabs={mobileTabs} onMobileTabsChange={updateMobileTabs} initialSection={settingsInitialSection ?? undefined} />}
  </main><MobileTabBar activeKey={active} tabs={mobileTabs} onNavigate={navigate} onOpenMore={() => setMobileNavOpen(true)} /><Toast messages={messages} onDismiss={(id) => setMessages((current) => current.filter((item) => item.id !== id))} /></div>;
}

/** 会话门卫在最外层：未登录只渲染登录页，登录成功才挂载工作台并开始加载数据。 */
export default function App() {
  return (
    <EnvironmentShell>
      <AuthGate>{({ user, onLogout }) => <Workbench key={user.id} user={user} onLogout={onLogout} />}</AuthGate>
    </EnvironmentShell>
  );
}
